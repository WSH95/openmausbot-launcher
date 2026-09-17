// The HTTP client: one timeout per request, bearer from the config, JSON
// errors mapped to HttpError, and a dry-run mode that reports mutations
// instead of sending them.
import { EXIT, Fail } from "./cli.mjs";
import { isLoopback } from "./config.mjs";

export class HttpError extends Error {
  constructor(method, path, status, body) {
    super(`${method} ${path} -> ${status}${body?.error ? `: ${body.error}` : ""}`);
    this.status = status; this.body = body; this.method = method; this.path = path;
  }
}

const SECRET_BODY = /^\/api\/config(\?|$)/;
const LOOPBACK_NO_PROXY = ["127.0.0.1", "localhost"];

function bypassProxyForLoopback(url, env = process.env) {
  if (!isLoopback(url)) return;
  const entries = [env.NO_PROXY, env.no_proxy]
    .flatMap((value) => typeof value === "string" ? value.split(",") : [])
    .map((value) => value.trim())
    .filter(Boolean);
  const seen = new Set();
  const merged = [];
  for (const entry of [...entries, ...LOOPBACK_NO_PROXY]) {
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  env.NO_PROXY = merged.join(",");
  env.no_proxy = env.NO_PROXY;
}

export function createClient({ url, token = null, dryRun = false, timeoutMs = 15_000, allowInsecureHttp = false }) {
  const u = new URL(url);
  if (u.protocol === "http:" && !isLoopback(url) && !allowInsecureHttp) {
    throw new Fail(EXIT.PRECONDITION, `${url} is not loopback and not https`, { hint: "use https, or pass --allow-insecure-http for a trusted tunnel" });
  }
  // Codex's network proxy enables Node's environment proxy and clears its
  // inherited bypass list. Restore only the launcher's exact loopback hosts
  // before the first request; remote servers continue through the proxy.
  bypassProxyForLoopback(url);
  const headers = { "content-type": "application/json", accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  async function request(method, path, body, opts = {}) {
    const perCall = opts.timeoutMs ?? timeoutMs;
    // A config write is the one request whose body is a credential. Its
    // preview says which route would be called and nothing else, so a dry run
    // cannot put a secret on stdout or into a transcript.
    if (dryRun && method !== "GET") return { dryRun: true, method, path, body: SECRET_BODY.test(path) ? "<redacted>" : body };
    // Voice validation can forward provider-supplied text (server/tts/elevenlabs.ts:42-55).
    // Keep those words, but never let the submitted credential enter an error
    // object, whose message and stack are both printable by the CLI.
    const values = SECRET_BODY.test(path)
      ? [body?.xai?.key, body?.box?.token, body?.opencodeGo?.apiKey, body?.tts?.key, body?.imageGen?.key]
        .filter((v) => typeof v === "string" && v.length).flatMap((v) => [v, v.trim()]).filter(Boolean)
      : [];
    const redact = (s) => values.reduce((text, value) => text.split(value).join("<redacted>"), s);
    let res; let text;
    try {
      const timeout = AbortSignal.timeout(Math.max(0, Math.floor(perCall)));
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
      res = await fetch(`${u.origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
      text = await res.text();
    } catch (e) {
      const cause = e.cause?.code ?? e.cause?.errors?.find((x) => x.code)?.code ?? /\b(E[A-Z]{3,})\b/.exec(String(e.cause?.message ?? ""))?.[1] ?? (e.name === "TimeoutError" ? "TimeoutError" : (e.cause?.message ?? e.message));
      const err = new Fail(EXIT.ERROR, redact(`${method} ${path}: ${cause === "TimeoutError" || e.name === "TimeoutError" ? `no answer within ${perCall} ms` : `${cause}`}`), { hint: cause === "ECONNREFUSED" ? `nothing is listening at ${u.origin}` : undefined });
      err.network = true; throw err;
    }
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
    if (values.length) parsed = JSON.parse(JSON.stringify(parsed), (_key, value) => typeof value === "string" ? redact(value) : value);
    if (!res.ok) throw new HttpError(method, path, res.status, parsed);
    return parsed;
  }
  return {
    url: u.origin, hasToken: Boolean(token), timeoutMs,
    get: (p, o) => request("GET", p, undefined, o), post: (p, b, o) => request("POST", p, b ?? {}, o), patch: (p, b, o) => request("PATCH", p, b ?? {}, o), put: (p, b, o) => request("PUT", p, b ?? {}, o), del: (p, o) => request("DELETE", p, undefined, o),
    /** A raw fetch for the event stream: same auth, caller-managed lifetime. */
    stream: (p, signal) => fetch(`${u.origin}${p}`, { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), accept: "text/event-stream" }, signal }),
  };
}

/** Turn a 409 (or any HttpError) into a precondition failure with the server's words. */
export function precondition(e, hint) {
  if (e instanceof HttpError) return new Fail(e.status === 409 ? EXIT.PRECONDITION : EXIT.ERROR, e.body?.error ?? e.message, { status: e.status, hint });
  return e;
}

/** A 403 this launcher cannot argue with: the session's scope, or a change the
 * server only accepts from the app. S: request-auth.ts:344-347,369. */
const NEEDS_A_HUMAN = /lacks the .+ scope|desktop app or a paired device/;

/**
 * How a card route's refusal is reported. The server validates each card kind
 * itself — a stale hash, a routine that moved, a connection that is not
 * finished — and its own words are the instruction the user acts on, so they
 * are passed through unchanged with the status kept beside them.
 */
export function refused(e, hint) {
  if (!(e instanceof HttpError)) return e;
  const text = e.body?.error ?? e.message;
  if (e.status === 403 && NEEDS_A_HUMAN.test(text)) return new Fail(EXIT.NEEDS_USER, text, { status: 403, hint });
  if ([400, 404, 409, 422, 429].includes(e.status)) return new Fail(EXIT.PRECONDITION, text, { status: e.status, hint });
  return precondition(e, hint);
}
