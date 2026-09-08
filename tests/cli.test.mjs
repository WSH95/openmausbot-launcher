import test from "node:test";
import assert from "node:assert/strict";
import { verb, run, VERBS } from "../skills/openmausbot-launcher/scripts/lib/cli.mjs";

test("Node error codes produce an ordinary CLI failure without invalid exit codes", async (t) => {
  const name = "test-native-error";
  t.after(() => VERBS.delete(name));
  verb(name, { handler: () => { throw Object.assign(new Error("database is corrupt"), { code: "ERR_SQLITE_ERROR", errcode: 26 }); } });
  const r = await run([name]);
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.output).error, "database is corrupt");
});
