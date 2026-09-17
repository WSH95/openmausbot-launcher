import test from "node:test";
import assert from "node:assert/strict";
import { verb, run, VERBS } from "../skills/openmausbot-launcher/scripts/lib/cli.mjs";
import "../skills/openmausbot-launcher/scripts/lib/verbs/lifecycle.mjs";
import "../skills/openmausbot-launcher/scripts/lib/verbs/pair.mjs";
import "../skills/openmausbot-launcher/scripts/lib/verbs/repo.mjs";
import "../skills/openmausbot-launcher/scripts/lib/verbs/team.mjs";
import "../skills/openmausbot-launcher/scripts/lib/verbs/run.mjs";
import "../skills/openmausbot-launcher/scripts/lib/verbs/answer.mjs";
import "../skills/openmausbot-launcher/scripts/lib/verbs/state.mjs";

const REGISTERED = "answer, bind, cleanup, doctor, down, facts, import, interrupt, pair, reconcile, report, send, state, status, task, up, watch";

test("no verb, an unknown verb, and an unknown option are usage errors (exit 2) naming the sorted verbs", async () => {
  let r = await run([]);
  assert.equal(r.code, 2); assert.deepEqual(JSON.parse(r.output), { ok: false, error: "usage: omb.mjs <verb> [options]", hint: `verbs: ${REGISTERED}` });
  r = await run(["bogus"]);
  assert.equal(r.code, 2); assert.deepEqual(JSON.parse(r.output), { ok: false, error: "unknown verb bogus", hint: `verbs: ${REGISTERED}` });
  r = await run(["doctor", "--bogus"]);
  assert.equal(r.code, 2); const out = JSON.parse(r.output);
  assert.equal(out.ok, false); assert.equal(out.verb, "doctor"); assert.match(out.error, /^Unknown option '--bogus'/);
});

test("Node error codes produce an ordinary CLI failure without invalid exit codes", async (t) => {
  const name = "test-native-error";
  t.after(() => VERBS.delete(name));
  verb(name, { handler: () => { throw Object.assign(new Error("database is corrupt"), { code: "ERR_SQLITE_ERROR", errcode: 26 }); } });
  const r = await run([name]);
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.output).error, "database is corrupt");
});
