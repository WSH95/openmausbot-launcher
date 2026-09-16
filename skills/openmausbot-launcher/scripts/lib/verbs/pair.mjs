// pair: turn a pairing code into this launcher's session token for one server
// (design: the verb table, "Configuration"). It is the only verb that writes
// the token table, and the token it receives goes from the response straight
// into that 0600 file — never into argv, stdout, the state file, or a log.
//
// The exchange is the one route OpenMausBot serves before its auth gate
// (index.ts:7318-7341): JSON only, single use, five-minute codes.
import { randomBytes } from "node:crypto";
import { verb, EXIT, Fail } from "../cli.mjs";
import { resolveConfig, tokenFilePath, readTokenTable, storeToken } from "../config.mjs";
import { createClient, HttpError } from "../http.mjs";

/** The CLI mints codes on the port it serves; 8799 is its default (cli.ts:71-74). */
const mintPort = (url) => new URL(url).port || "8799";

/**
 * The three answers the pair route refuses with are the operator's problem,
 * not the launcher's: report them in the server's own words (sessions.ts:278-286,
 * index.ts:7322-7324) with what to do next. Any other status is an ordinary
 * HTTP failure and stays one.
 */
export function exchangeRefusal(e, url) {
  if (!(e instanceof HttpError) || ![415, 401, 429].includes(e.status)) return e;
  const text = e.body?.error ?? e.message;
  const seconds = /try again in (\d+)s/.exec(text)?.[1];
  const hint = e.status === 401 ? `mint a new code on the server: openmausbot pair --port ${mintPort(url)} [--client]`
    : e.status === 429 ? `wait ${seconds ?? "as long as the server says"} s and pair again; the server counts failed codes per source address`
    : `something between this launcher and ${url} rewrote the request's content type`;
  return new Fail(EXIT.PRECONDITION, text, { status: e.status, hint });
}

/**
 * One exchange, retried exactly once when the answer never arrives. The server
 * replays its own result for the same attempt id within EXCHANGE_REPLAY_MS
 * (sessions.ts:31-35, 274-276, 302), so a lost response costs a round trip
 * rather than a second code.
 */
async function exchange(client, body) {
  try { return await client.post("/api/auth/pair", body); }
  catch (e) {
    if (!e?.network) throw exchangeRefusal(e, client.url);
    try { return await client.post("/api/auth/pair", body); }
    catch (again) { throw again?.network ? again : exchangeRefusal(again, client.url); }
  }
}

verb("pair", {
  options: { code: { type: "string" }, label: { type: "string" }, replace: { type: "boolean" } },
  handler: async ({ flags }) => {
    if (!flags.code) throw new Fail(EXIT.USAGE, "pair needs a pairing code: --code XXXX-XXXX-XXXX", { hint: "mint one on the server's machine with openmausbot pair [--label NAME] [--client]" });
    const cfg = resolveConfig(flags);
    const origin = cfg.url; // resolveConfig already normalized --url > state > OMB_URL > default
    const tokenFile = tokenFilePath(cfg.env);
    // The whole preflight runs before any request, so a refusal never spends
    // the code: a five-minute single-use code is expensive to replace.
    const { table } = readTokenTable(tokenFile);
    const replaced = Object.hasOwn(table, origin);
    if (replaced && !flags.replace) {
      throw new Fail(EXIT.PRECONDITION, `${tokenFile} already holds a token for ${origin}`, { hint: "pass --replace to overwrite it, after revoking the old session with openmausbot sessions" });
    }
    const client = createClient({ url: origin, allowInsecureHttp: cfg.allowInsecureHttp });
    if (cfg.dryRun) return { result: { dryRun: true, url: origin, tokenFile, label: flags.label ?? null }, brief: `pair · dry run · ${origin} · ${tokenFile}` };

    const attemptId = randomBytes(8).toString("hex"); // 16 hex chars: /^[\w-]{8,64}$/ (sessions.ts:273)
    const answer = await exchange(client, { code: flags.code, ...(flags.label ? { label: flags.label } : {}), attemptId });
    const session = answer.session ?? {};
    await storeToken(tokenFile, origin, answer.token);
    const scopes = session.scopes ?? [];
    return {
      result: {
        url: origin, tokenFile, replaced,
        session: { id: session.id ?? null, label: session.label ?? null, scopes, expiresAt: session.expiresAt ?? null },
        environmentId: answer.environment?.environmentId ?? null,
      },
      brief: `pair · ${origin} · ${session.label} · scopes ${scopes.join(",")} · expires ${Number.isFinite(session.expiresAt) ? new Date(session.expiresAt).toISOString() : "unknown"} · ${tokenFile}`,
    };
  },
});
