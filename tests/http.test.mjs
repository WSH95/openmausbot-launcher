import test from "node:test";
import assert from "node:assert/strict";
import { startFake, freePort } from "./helpers.mjs";
import { createClient, HttpError, precondition, refused } from "../skills/openmausbot-launcher/scripts/lib/http.mjs";
import { Fail } from "../skills/openmausbot-launcher/scripts/lib/cli.mjs";

test("get, bearer, errors, dry run, timeout, insecure refusal", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const c = createClient({ url: f.url });
  assert.equal((await c.get("/api/health")).app, "openmausbot");
  await assert.rejects(c.get("/api/nope"), (e) => e instanceof HttpError && e.status === 404 && /no route/.test(e.body.error));
  await f.control({ op: "token", token: "omb_sess_c", scopes: ["client"] });
  const withToken = createClient({ url: f.url, token: "omb_sess_c" });
  assert.deepEqual(await withToken.get("/api/auth/session"), { kind: "session", scopes: ["client"] });
  await assert.rejects(withToken.post("/api/teams/import?mode=add", {}), (e) => e instanceof HttpError && e.status === 403);
  const dry = createClient({ url: f.url, dryRun: true });
  assert.deepEqual(await dry.patch("/api/bots/x", { cwd: "/tmp" }), { dryRun: true, method: "PATCH", path: "/api/bots/x", body: { cwd: "/tmp" } });
  assert.equal((await dry.get("/api/health")).app, "openmausbot", "reads still happen in dry-run mode");
  await f.control({ op: "delay", count: 1, ms: 400 });
  const fast = createClient({ url: f.url, timeoutMs: 100 });
  await assert.rejects(fast.get("/api/health"), (e) => e instanceof Fail && /no answer within 100 ms/.test(e.message));
  assert.throws(() => createClient({ url: "http://10.0.0.5:8799" }), (e) => e instanceof Fail && e.code === 3);
  assert.doesNotThrow(() => createClient({ url: "http://10.0.0.5:8799", allowInsecureHttp: true }));
  assert.doesNotThrow(() => createClient({ url: "https://maus.example.com" }));
  const refused = createClient({ url: `http://127.0.0.1:${await freePort()}` });
  await assert.rejects(refused.get("/api/health"), (e) => e.network === true && /ECONNREFUSED/.test(e.message));
  const p = precondition(new HttpError("PATCH", "/x", 409, { error: "the bot is working" }), "wait");
  assert.ok(p instanceof Fail); assert.equal(p.code, 3); assert.equal(p.message, "the bot is working"); assert.equal(p.hint, "wait");
});

test("a config PUT carries a value, so its dry run previews the route and never the body", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const live = createClient({ url: f.url });
  assert.deepEqual(await live.put("/api/config", { tts: { key: "a-real-key" } }), {
    xai: { configured: false }, box: { configured: false }, opencodeGo: { configured: false },
    tts: { configured: true }, imageGen: { configured: false }, features: { skillRecorder: false },
  }, "the server answers with booleans, never the value");
  const dry = createClient({ url: f.url, dryRun: true });
  assert.deepEqual(await dry.put("/api/config", { xai: { key: "a-real-key" } }), { dryRun: true, method: "PUT", path: "/api/config", body: "<redacted>" });
  assert.deepEqual(await dry.post("/api/bots/x/messages", { text: "hello" }), { dryRun: true, method: "POST", path: "/api/bots/x/messages", body: { text: "hello" } }, "every other preview still shows what would be sent");
});

test("refused maps a card route's refusals: the server's words at exit 3, a scope refusal at exit 5", () => {
  const at = (status, error) => refused(new HttpError("POST", "/x", status, { error }), "try again");
  for (const status of [400, 404, 409, 422, 429]) {
    const f = at(status, "finish connecting every requested app first");
    assert.ok(f instanceof Fail); assert.equal(f.code, 3); assert.equal(f.status, status);
    assert.equal(f.message, "finish connecting every requested app first"); assert.equal(f.hint, "try again");
  }
  let f = at(403, "forbidden: this session lacks the admin scope");
  assert.equal(f.code, 5, "a scope refusal is a human step, not a precondition this launcher can fix");
  f = at(403, "forbidden: this change must come from the desktop app or a paired device");
  assert.equal(f.code, 5);
  f = at(403, "connected apps are not enabled for this bot");
  assert.equal(f.code, 1, "any other 403 stays an ordinary HTTP failure");
  assert.equal(at(503, "cloud computer inventory is unavailable").code, 1);
  const plain = new Error("not an HttpError");
  assert.equal(refused(plain), plain);
});

test("an already aborted mutation never reaches the server", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const mutations = [];
  f.server.on("request", (r) => { if (r.method === "POST") mutations.push(r.url); });
  const client = createClient({ url: f.url });
  const ctrl = new AbortController(); ctrl.abort();
  await assert.rejects(client.post("/api/bots", { name: "must not be created" }, { signal: ctrl.signal }), (e) => e.network === true);
  assert.deepEqual(mutations, []);
});

test("request cancellation covers a response body after headers arrive", async (t) => {
  const { createServer } = await import("node:http");
  const server = createServer((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.write('{"ok":'); const timer = setTimeout(() => res.end('true}'), 300); res.once('close', () => clearTimeout(timer)); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = createClient({ url: `http://127.0.0.1:${server.address().port}` });
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 30); t.after(() => clearTimeout(timer));
  const start = performance.now();
  await assert.rejects(client.get("/", { signal: ctrl.signal }), (e) => e.network === true);
  assert.ok(performance.now() - start < 200);
});
