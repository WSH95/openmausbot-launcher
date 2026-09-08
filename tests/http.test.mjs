import test from "node:test";
import assert from "node:assert/strict";
import { startFake, freePort } from "./helpers.mjs";
import { createClient, HttpError, precondition } from "../skills/openmausbot-launcher/scripts/lib/http.mjs";
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
