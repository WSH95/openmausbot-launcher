// pair: turn a pairing code into this launcher's session token for one server
// (design: the verb table, "Configuration"). It is the only verb that writes
// the token table, and the token it receives goes from the response straight
// into that 0600 file — never into argv, stdout, the state file, or a log.
//
// The exchange is the one route OpenMausBot serves before its auth gate
// (index.ts:7318-7341): JSON only, single use, five-minute codes.
import { randomBytes } from "node:crypto";
import { verb, EXIT, Fail } from "../cli.mjs";
import { resolveConfig, tokenFilePath, readTokenTable, withTokenFile } from "../config.mjs";
import { createClient, HttpError } from "../http.mjs";

/**
 * `openmausbot pair` runs on the server and mints on the port it serves
 * (cli.ts:223-229), which is a loopback port the endpoint URL does not know:
 * an SSH tunnel maps `localhost:9999` onto a server serving 8799, a reverse
 * proxy answers on 443, and a bare `https://host` names no port at all. The
 * URL's port is the endpoint's, so the hint asks for the server's rather than
 * print a number that would not work.
 */
const MINT_PORT = "<the server's loopback port>";

/**
 * How long a second `pair` waits for the token table's lock.
 *
 * That lock is held across the exchange, so the wait has to outlast one:
 * `exchange()` allows two attempts at the client's timeout. A shorter wait
 * would refuse a pair that holds a valid code for a free origin merely
 * because another origin's server was slow, so no flag shortens it.
 * `OMB_PAIR_LOCK_WAIT_MS` is read only by the tests that need contention to
 * resolve in milliseconds rather than half a minute; it is deliberately
 * undocumented outside this comment.
 */
export function lockWaitMs(client, env = process.env) {
  const raw = env.OMB_PAIR_LOCK_WAIT_MS;
  const override = raw === undefined || raw === "" ? NaN : Number(raw);
  if (Number.isFinite(override) && override >= 0) return override;
  return 2 * (client.timeoutMs ?? 15_000) + 5_000;
}

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
  const hint = e.status === 401 ? `mint a new code on the server: openmausbot pair --port ${MINT_PORT} [--client]`
    : e.status === 429 ? `wait ${seconds ?? "as long as the server says"} s and pair again; the server counts failed codes per source address`
    : `something between this launcher and ${url} rewrote the request's content type`;
  return new Fail(EXIT.PRECONDITION, text, { status: e.status, hint });
}

/** One origin, one token: replacing it is a deliberate act, because the session it replaces stays alive on the server until it is revoked. */
const alreadyHeld = (file, origin) => new Fail(EXIT.PRECONDITION, `${file} already holds a token for ${origin}`, { hint: "pass --replace to overwrite it, after revoking the old session with openmausbot sessions" });

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
    if (Object.hasOwn(readTokenTable(tokenFile).table, origin) && !flags.replace) throw alreadyHeld(tokenFile, origin);
    const client = createClient({ url: origin, allowInsecureHttp: cfg.allowInsecureHttp });
    if (cfg.dryRun) return { result: { dryRun: true, url: origin, tokenFile, label: flags.label ?? null }, brief: `pair · dry run · ${origin} · ${tokenFile}` };

    // The lock is a reservation taken before the code is spent and held
    // through the write, so an unwritable destination or a concurrent pair
    // costs a round trip instead of a code and a 30-day session with nowhere
    // to live. The preflight above was not serialized against another pair,
    // so the decision is made again here, on the table under the lock.
    const attemptId = randomBytes(8).toString("hex"); // 16 hex chars: /^[\w-]{8,64}$/ (sessions.ts:273)
    const { answer, replaced } = await withTokenFile(tokenFile, async ({ table, write }) => {
      const held = Object.hasOwn(table, origin);
      if (held && !flags.replace) throw alreadyHeld(tokenFile, origin);
      const got = await exchange(client, { code: flags.code, ...(flags.label ? { label: flags.label } : {}), attemptId });
      write(origin, got.token);
      return { answer: got, replaced: held };
    }, { waitMs: lockWaitMs(client, cfg.env) });
    const session = answer.session ?? {};
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
