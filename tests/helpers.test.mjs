import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ROOT, FAKE, makeRepo, runOmb } from "./helpers.mjs";

const HELPERS = pathToFileURL(path.join(ROOT, "tests", "helpers.mjs")).href;
/** Run an ESM snippet in a fresh node process and return its trimmed stdout. */
const node = (code, env) => new Promise((resolve) => {
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "inherit"] });
  let out = ""; child.stdout.on("data", (c) => { out += c; });
  child.on("close", () => resolve(out.trim()));
});

test("tmpDir directories vanish when their process exits, unless OML_KEEP_TMP=1", async () => {
  // node --test runs each file in its own process, so an exit hook in helpers.mjs cleans that file's directories.
  const code = `import { tmpDir } from ${JSON.stringify(HELPERS)}; console.log(tmpDir("oml-helpers-"));`;
  const removed = await node(code, { OML_KEEP_TMP: "" });
  assert.match(removed, /oml-helpers-/); assert.equal(fs.existsSync(removed), false, `${removed} should be gone`);
  const kept = await node(code, { OML_KEEP_TMP: "1" });
  assert.equal(fs.existsSync(kept), true, `${kept} should survive`); fs.rmSync(kept, { recursive: true, force: true });
});

test("runOmb strips ambient OMB_* variables from the driver's environment and still applies opts.env", async (t) => {
  const { dir } = makeRepo();
  const previous = process.env.OMB_URL; process.env.OMB_URL = "http://127.0.0.1:1";
  t.after(() => { if (previous === undefined) delete process.env.OMB_URL; else process.env.OMB_URL = previous; });
  const r = await runOmb(["doctor", "--project", dir], { env: { OMB_BIN: FAKE } });
  assert.equal(r.code, 0, r.stdout + r.stderr); assert.equal(r.json.url, "http://127.0.0.1:8799", "the test process's OMB_URL did not reach the driver");
  const explicit = await runOmb(["doctor", "--project", dir], { env: { OMB_BIN: FAKE, OMB_URL: "http://127.0.0.1:1" } });
  assert.equal(explicit.json.url, "http://127.0.0.1:1");
});
