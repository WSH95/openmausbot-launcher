// `pair` turns a pairing code into this launcher's token for one server. The
// token is the credential for every later remote command, so these tests watch
// where it goes as closely as they watch that it works.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startFake, makeRepo, runOmb, tmpDir } from "./helpers.mjs";
import { statePaths, updateState } from "../skills/openmausbot-launcher/scripts/lib/state.mjs";
import { exchangeRefusal } from "../skills/openmausbot-launcher/scripts/lib/verbs/pair.mjs";
import { HttpError } from "../skills/openmausbot-launcher/scripts/lib/http.mjs";

const mode = (p) => (fs.statSync(p).mode & 0o777).toString(8);
const tableIn = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const openCodes = async (f) => (await (await fetch(`${f.url}/api/auth/pairing`)).json()).pairings;
const sessionsOf = async (f) => (await (await fetch(`${f.url}/api/auth/sessions`)).json()).sessions;
/** A token file the verb must create itself, inside a directory it must create too. */
const freshFile = () => path.join(tmpDir("oml-pair-"), "openmausbot-launcher", "tokens.json");
/** Every non-control POST the fake saw, so a refusal can be shown to spend nothing. */
function watchPosts(f) {
  const posts = [];
  f.server.on("request", (r) => { if (r.method === "POST" && !r.url.startsWith("/__fake")) posts.push(r.url); });
  return posts;
}

test("pair exchanges a code into a 0600 token file keyed by the origin, and prints no token", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { dir } = makeRepo();
  const file = freshFile();
  const env = { OMB_TOKEN: "", OMB_TOKEN_FILE: file };
  const { pairing } = await f.control({ op: "pairing", label: "from the server", scopes: ["admin", "client"] });
  const r = await runOmb(["pair", "--code", pairing.code, "--label", "laptop", "--url", f.url, "--project", dir, "--verbose"], { env });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.json.url, f.url);
  assert.equal(r.json.tokenFile, file);
  assert.equal(r.json.replaced, false);
  assert.equal(r.json.environmentId, f.environmentId);
  assert.deepEqual(Object.keys(r.json.session).sort(), ["expiresAt", "id", "label", "scopes"]);
  assert.equal(r.json.session.label, "laptop");
  assert.deepEqual(r.json.session.scopes, ["admin", "client"]);
  assert.equal(`${r.stdout}${r.stderr}`.includes("omb_sess_"), false, "the token is never printed, not even with --verbose");
  assert.equal(fs.existsSync(path.join(dir, ".omb", "state.json")), false, "pairing is not project state");

  const table = tableIn(file);
  assert.deepEqual(Object.keys(table), [f.url], "keyed by the origin, as resolveToken looks it up");
  assert.match(table[f.url], /^omb_sess_[A-Za-z0-9_-]{43}$/);
  assert.equal(mode(file), "600");
  assert.equal(mode(path.dirname(file)), "700");
  assert.equal(fs.existsSync(`${file}.lock`), false, "the lock is released");
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["tokens.json"], "no temp file is left behind");

  // The stored token drives the next command: loopback alone would answer
  // `loopback`, so `session` proves the bearer was read from the file and sent.
  const doc = await runOmb(["doctor", "--server", "--remote", "--url", f.url, "--project", dir], { env });
  assert.equal(doc.json.checks.find((c) => c.id === "health").ok, true, doc.stdout);
  assert.equal(doc.json.checks.find((c) => c.id === "session").detail, "session with scopes admin,client");
});

test("a client-scope token is exactly a client: the server's scope refusal reaches the operator", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { dir } = makeRepo();
  const file = freshFile();
  const env = { OMB_TOKEN: "", OMB_TOKEN_FILE: file };
  const { pairing } = await f.control({ op: "pairing", label: "phone", scopes: ["client"] });
  const r = await runOmb(["pair", "--code", pairing.code, "--url", f.url, "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(r.json.session.scopes, ["client"]);
  assert.equal(r.json.session.label, "phone", "the code's own label names the device when --label is absent");
  const doc = await runOmb(["doctor", "--server", "--remote", "--url", f.url, "--project", dir], { env });
  assert.equal(doc.code, 1, doc.stdout);
  assert.equal(doc.json.status, 403);
  assert.match(doc.json.error, /forbidden: this session lacks the admin scope$/);
});

test("a second pair for the same origin is refused before any request unless --replace", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { dir } = makeRepo();
  const file = freshFile();
  const env = { OMB_TOKEN: "", OMB_TOKEN_FILE: file };
  const first = await f.control({ op: "pairing", scopes: ["client"] });
  assert.equal((await runOmb(["pair", "--code", first.pairing.code, "--url", f.url, "--project", dir], { env })).code, 0);
  const stored = tableIn(file)[f.url];

  const second = await f.control({ op: "pairing", scopes: ["client"] });
  const posts = watchPosts(f);
  const refused = await runOmb(["pair", "--code", second.pairing.code, "--url", f.url, "--project", dir], { env });
  assert.equal(refused.code, 3, refused.stdout);
  assert.equal(refused.json.error, `${file} already holds a token for ${f.url}`);
  assert.match(refused.json.hint, /pass --replace to overwrite it, after revoking the old session with openmausbot sessions/);
  assert.deepEqual(posts, [], "a refused pair spends no code");
  assert.equal(tableIn(file)[f.url], stored, "and leaves the stored token alone");
  assert.equal((await openCodes(f)).length, 1, "the second code is still open");

  const replaced = await runOmb(["pair", "--code", second.pairing.code, "--replace", "--label", "phone", "--url", f.url, "--project", dir, "--brief"], { env });
  assert.equal(replaced.code, 0, replaced.stdout + replaced.stderr);
  const now = tableIn(file);
  assert.deepEqual(Object.keys(now), [f.url]);
  assert.notEqual(now[f.url], stored, "--replace overwrites the entry");
  assert.equal(replaced.stdout.includes("omb_sess_"), false);
  const line = replaced.stdout.trim().split(" · ");
  assert.equal(line[0], "pair");
  assert.equal(line[1], f.url);
  assert.equal(line[2], "phone");
  assert.equal(line[3], "scopes client");
  assert.match(line[4], /^expires \d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  assert.equal(line[5], file);
});

test("a token file that is not 0600, or not an object, is refused before any request", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { dir } = makeRepo();
  const { pairing } = await f.control({ op: "pairing" });
  const posts = watchPosts(f);
  const base = tmpDir("oml-pair-");
  const run = (file) => runOmb(["pair", "--code", pairing.code, "--url", f.url, "--project", dir], { env: { OMB_TOKEN: "", OMB_TOKEN_FILE: file } });

  const loose = path.join(base, "loose.json");
  fs.writeFileSync(loose, "{}\n"); fs.chmodSync(loose, 0o644);
  const lax = await run(loose);
  assert.equal(lax.code, 3, lax.stdout);
  assert.equal(lax.json.error, `${loose} is mode 644; make it 0600`);

  const corrupt = path.join(base, "corrupt.json");
  fs.writeFileSync(corrupt, "{not json"); fs.chmodSync(corrupt, 0o600);
  const bad = await run(corrupt);
  assert.equal(bad.code, 3, bad.stdout);
  assert.equal(bad.json.error, `${corrupt} is not valid JSON`);
  assert.match(bad.json.hint, /move it aside/);

  const list = path.join(base, "list.json");
  fs.writeFileSync(list, "[]"); fs.chmodSync(list, 0o600);
  assert.equal((await run(list)).json.error, `${list} is not valid JSON`, "a table has to be an object");

  assert.deepEqual(posts, [], "no preflight failure spends the code");
  assert.equal((await openCodes(f)).length, 1);
});

test("the pair route's refusals are reported in the server's own words, exit 3", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { dir } = makeRepo();
  const file = freshFile();
  const env = { OMB_TOKEN: "", OMB_TOKEN_FILE: file };
  const wrong = await runOmb(["pair", "--code", "AAAA-BBBB-CCCC", "--url", f.url, "--project", dir], { env });
  assert.equal(wrong.code, 3, wrong.stdout);
  assert.equal(wrong.json.error, "pairing code is wrong or has expired; create a new one on the server");
  assert.equal(wrong.json.hint, `mint a new code on the server: openmausbot pair --port ${new URL(f.url).port} [--client]`);
  assert.equal(fs.existsSync(file), false, "a refused exchange writes no table");

  // That was the first failure from this source; nine more lock it out (S: sessions.ts:29).
  for (let i = 0; i < 9; i++) {
    await fetch(`${f.url}/api/auth/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: `ZZZZ-ZZZZ-ZZZ${i}` }) });
  }
  const locked = await runOmb(["pair", "--code", "AAAA-BBBB-CCCC", "--url", f.url, "--project", dir], { env });
  assert.equal(locked.code, 3, locked.stdout);
  assert.equal(locked.json.error, "too many failed pairing attempts from your address; try again in 60s");
  assert.match(locked.json.hint, /^wait 60 s and pair again/);
});

test("415, 401 and 429 carry the server's text; every other status stays an ordinary HTTP failure", () => {
  const refusal = (status, error, url = "https://maus.example.com") => exchangeRefusal(new HttpError("POST", "/api/auth/pair", status, { error }), url);
  const unsupported = refusal(415, "send the pairing code as JSON (content-type: application/json)");
  assert.equal(unsupported.code, 3);
  assert.equal(unsupported.message, "send the pairing code as JSON (content-type: application/json)");
  assert.match(unsupported.hint, /rewrote the request's content type/);
  const stale = refusal(401, "pairing code is wrong or has expired; create a new one on the server");
  assert.equal(stale.code, 3);
  assert.equal(stale.hint, "mint a new code on the server: openmausbot pair --port <the server's loopback port> [--client]",
    "a bare https host says nothing about the loopback port the CLI mints on, so ask rather than guess 8799");
  assert.equal(refusal(401, "x", "https://maus.example.com:8899").hint, "mint a new code on the server: openmausbot pair --port 8899 [--client]");
  assert.equal(refusal(401, "x", "http://127.0.0.1:8899").hint, "mint a new code on the server: openmausbot pair --port 8899 [--client]");
  const locked = refusal(429, "too many failed pairing attempts from your address; try again in 42s");
  assert.equal(locked.code, 3);
  assert.equal(locked.message, "too many failed pairing attempts from your address; try again in 42s");
  assert.match(locked.hint, /^wait 42 s and pair again/);
  const broken = new HttpError("POST", "/api/auth/pair", 500, { error: "boom" });
  assert.equal(exchangeRefusal(broken, "https://maus.example.com"), broken, "an unexpected status is not a precondition");
});

test("an answer lost after the exchange is recovered by one retry with the same attempt id", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { dir } = makeRepo();
  const file = freshFile();
  const { pairing } = await f.control({ op: "pairing", label: "laptop", scopes: ["client"] });
  await f.control({ op: "dropNext", count: 1 }); // the server acts, then the answer never arrives
  const r = await runOmb(["pair", "--code", pairing.code, "--url", f.url, "--project", dir], { env: { OMB_TOKEN: "", OMB_TOKEN_FILE: file } });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const sessions = await sessionsOf(f);
  assert.equal(sessions.length, 1, "the retry replayed the first answer instead of spending a second code");
  assert.equal(r.json.session.id, sessions[0].id);
  assert.match(tableIn(file)[f.url], /^omb_sess_/);
});

test("two pairs for two servers land side by side in one table", async (t) => {
  const a = await startFake(); t.after(() => a.close());
  const b = await startFake(); t.after(() => b.close());
  const { dir } = makeRepo();
  const file = freshFile();
  const env = { OMB_TOKEN: "", OMB_TOKEN_FILE: file };
  const codes = await Promise.all([a, b].map((f) => f.control({ op: "pairing", scopes: ["client"] })));
  const [ra, rb] = await Promise.all([a, b].map((f, i) => runOmb(["pair", "--code", codes[i].pairing.code, "--url", f.url, "--project", dir], { env })));
  assert.equal(ra.code, 0, ra.stdout + ra.stderr);
  assert.equal(rb.code, 0, rb.stdout + rb.stderr);
  const table = tableIn(file);
  assert.deepEqual(Object.keys(table).sort(), [a.url, b.url].sort(), "neither write was lost");
  assert.notEqual(table[a.url], table[b.url]);
  assert.equal(fs.existsSync(`${file}.lock`), false);
});

test("--dry-run names the destination without spending the code or writing the file", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { dir } = makeRepo();
  const file = freshFile();
  const { pairing } = await f.control({ op: "pairing" });
  const posts = watchPosts(f);
  const r = await runOmb(["pair", "--code", pairing.code, "--label", "laptop", "--url", f.url, "--project", dir, "--dry-run"], { env: { OMB_TOKEN: "", OMB_TOKEN_FILE: file } });
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(r.json, { ok: true, verb: "pair", dryRun: true, url: f.url, tokenFile: file, label: "laptop" });
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(path.dirname(file)), false, "not even the directory");
  assert.deepEqual(posts, []);
  assert.equal((await openCodes(f)).length, 1);
});

test("pair without --code is a usage error, and an insecure remote URL is refused before the exchange", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const file = freshFile();
  const missing = await runOmb(["pair", "--url", f.url], { env: { OMB_TOKEN: "", OMB_TOKEN_FILE: file } });
  assert.equal(missing.code, 2, missing.stdout);
  assert.match(missing.json.error, /--code/);
  const insecure = await runOmb(["pair", "--code", "AAAA-BBBB-CCCC", "--url", "http://10.0.0.1:8899"], { env: { OMB_TOKEN: "", OMB_TOKEN_FILE: file } });
  assert.equal(insecure.code, 3, insecure.stdout);
  assert.match(insecure.json.error, /is not loopback and not https/);
  assert.equal(fs.existsSync(file), false);
});

test("a tokenless remote command names the missing token instead of an unverifiable server", async (t) => {
  // The tunnel's view of the server: every request arrives with a non-loopback
  // Host, so the server does not trust it. `/api/health` then answers 200
  // `{app}` with no pid (S: index.ts:7351-7357) while the environment route
  // stays public (`index.ts:7315`) — which reads exactly like a server whose
  // identity cannot be verified, when the only thing missing is the token.
  const f = await startFake({ host: "127.0.0.2" }); t.after(() => f.close());
  const origin = `http://127.0.0.2:${f.port}`;
  assert.deepEqual(await (await fetch(`${origin}/api/health`)).json(), { app: "openmausbot" });

  const { dir } = makeRepo();
  const file = freshFile();
  const env = { OMB_TOKEN: "", OMB_TOKEN_FILE: file };
  await updateState(statePaths(dir), (d) => {
    d.server = { url: origin, owned: false, environmentId: f.environmentId, healthPid: process.pid, healthStart: null };
    d.team = { section: "Dev team", environmentId: f.environmentId, lead: { id: "lead", name: "Sudo" }, bots: [], rooms: [] };
    return d;
  });
  const args = ["status", "--remote", "--url", origin, "--allow-insecure-http", "--project", dir];
  const tokenless = await runOmb(args, { env });
  assert.equal(tokenless.code, 3, tokenless.stdout);
  assert.equal(tokenless.json.error, `no token for ${origin}: pair this device first`);
  assert.equal(tokenless.json.hint, `pair --code XXXX-XXXX-XXXX --url ${origin}`);

  const { pairing } = await f.apply({ op: "pairing", label: "laptop", scopes: ["admin", "client"] });
  const paired = await runOmb(["pair", "--code", pairing.code, "--url", origin, "--allow-insecure-http", "--project", dir], { env });
  assert.equal(paired.code, 0, paired.stdout + paired.stderr);
  const withToken = await runOmb(args, { env });
  assert.equal(withToken.code, 0, withToken.stdout, "the same command works once the device is paired");
});
