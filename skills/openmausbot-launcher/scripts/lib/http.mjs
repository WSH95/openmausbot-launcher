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

export function createClient({ url, token = null, dryRun = false, timeoutMs = 15_000, allowInsecureHttp = false }) {
  const u = new URL(url);
  if (u.protocol === "http:" && !isLoopback(url) && !allowInsecureHttp) {
    throw new Fail(EXIT.PRECONDITION, `${url} is not loopback and not https`, { hint: "use https, or pass --allow-insecure-http for a trusted tunnel" });
  }
  const headers = { "content-type": "application/json", accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  async function request(method, path, body, opts = {}) {
    const perCall = opts.timeoutMs ?? timeoutMs;
    if (dryRun && method !== "GET") return { dryRun: true, method, path, body };
    let res; let text;
    try {
      const timeout = AbortSignal.timeout(Math.max(0, Math.floor(perCall)));
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
      res = await fetch(`${u.origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
      text = await res.text();
    } catch (e) {
      const cause = e.cause?.code ?? e.cause?.errors?.find((x) => x.code)?.code ?? /\b(E[A-Z]{3,})\b/.exec(String(e.cause?.message ?? ""))?.[1] ?? (e.name === "TimeoutError" ? "TimeoutError" : (e.cause?.message ?? e.message));
      const err = new Fail(EXIT.ERROR, `${method} ${path}: ${cause === "TimeoutError" || e.name === "TimeoutError" ? `no answer within ${perCall} ms` : `${cause}`}`, { hint: cause === "ECONNREFUSED" ? `nothing is listening at ${u.origin}` : undefined });
      err.network = true; throw err;
    }
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
    if (!res.ok) throw new HttpError(method, path, res.status, parsed);
    return parsed;
  }
  return {
    url: u.origin, hasToken: Boolean(token), timeoutMs,
    get: (p, o) => request("GET", p, undefined, o), post: (p, b, o) => request("POST", p, b ?? {}, o), patch: (p, b, o) => request("PATCH", p, b ?? {}, o), del: (p, o) => request("DELETE", p, undefined, o),
    /** A raw fetch for the event stream: same auth, caller-managed lifetime. */
    stream: (p, signal) => fetch(`${u.origin}${p}`, { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), accept: "text/event-stream" }, signal }),
  };
}

/** Turn a 409 (or any HttpError) into a precondition failure with the server's words. */
export function precondition(e, hint) {
  if (e instanceof HttpError) return new Fail(e.status === 409 ? EXIT.PRECONDITION : EXIT.ERROR, e.body?.error ?? e.message, { status: e.status, hint });
  return e;
}
