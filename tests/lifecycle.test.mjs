import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startFake, freePort, tmpDir, makeRepo, runOmb, sleep, FAKE } from "./helpers.mjs";
import net from "node:net";
import { statePaths, loadState, updateState } from "../skills/openmausbot-launcher/scripts/lib/state.mjs";
import { procInfo } from "../skills/openmausbot-launcher/scripts/lib/server.mjs";

const linux = process.platform === "linux";
const healthOk = async (url) => { try { return (await (await fetch(`${url}/api/health`)).json()).app === "openmausbot"; } catch { return false; } };

test("doctor: bootstrap checks on a plain repository", async () => {
  const { dir } = makeRepo();
  const r = await runOmb(["doctor", "--project", dir], { env: { OMB_BIN: FAKE, OMB_TOKEN: "" } });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const ids = r.json.checks.map((c) => c.id);
  assert.deepEqual(ids, ["node", "binary", "git", "project", "data-dir"]);
  assert.equal(r.json.checks.find((c) => c.id === "binary").ok, true);
  assert.equal(r.json.mode, "local");
  assert.equal(r.json.state.server, null);
  const b = await runOmb(["doctor", "--project", dir, "--brief"], { env: { OMB_BIN: FAKE, OMB_TOKEN: "" } });
  assert.match(b.stdout, /^doctor · local · 5 checks, 0 failed/);
});

test("doctor: the Project Steward stop-hook check and the loopback token warning", async () => {
  const { dir } = makeRepo();
  fs.mkdirSync(path.join(dir, ".project-steward"));
  fs.writeFileSync(path.join(dir, ".project-steward", "config.toml"), "[session]\nauto_handoff_mode = \"block\"\n[git]\nnever_push = true\n");
  let r = await runOmb(["doctor", "--project", dir], { env: { OMB_BIN: FAKE, OMB_TOKEN: "" } });
  assert.equal(r.code, 3); assert.deepEqual(r.json.failed, ["stop-hook"]);
  assert.match(r.json.checks.find((c) => c.id === "stop-hook").detail, /auto_handoff_mode is block/);
  fs.writeFileSync(path.join(dir, ".project-steward", "config.toml"), "[session]\nauto_handoff_mode = \"off\" # ok\n");
  r = await runOmb(["doctor", "--project", dir], { env: { OMB_BIN: FAKE, OMB_TOKEN: "" } });
  assert.equal(r.code, 3, "runtime dir not excluded yet");
  fs.appendFileSync(path.join(dir, ".gitignore"), ".project-steward/runtime/\n");
  r = await runOmb(["doctor", "--project", dir], { env: { OMB_BIN: FAKE, OMB_TOKEN: "" } });
  assert.equal(r.code, 0); assert.equal(r.json.checks.find((c) => c.id === "stop-hook").ok, true);
  r = await runOmb(["doctor", "--project", dir], { env: { OMB_BIN: FAKE, OMB_TOKEN: "omb_sess_x" } });
  assert.equal(r.code, 0, "a warning does not fail doctor");
  assert.equal(r.json.checks.find((c) => c.id === "token").ok, false);
  r = await runOmb(["doctor", "--project", dir, "--url", "https://maus.example.com"], { env: { OMB_TOKEN: "" } });
  assert.equal(r.json.mode, "remote"); assert.ok(!r.json.checks.some((c) => c.id === "binary"), "remote mode needs no binary");
});

test("up starts a detached server that outlives the driver, proves ownership, and down stops it", { skip: !linux && "needs /proc" }, async (t) => {
  const { dir } = makeRepo();
  const port = await freePort();
  const dataDir = path.join(tmpDir("oml-updata-"), "data");
  const env = { OMB_BIN: FAKE, OMB_TOKEN: "", ANTHROPIC_API_KEY: "sk-test-should-be-stripped" };
  const dry = await runOmb(["up", "--project", dir, "--port", String(port), "--data-dir", dataDir, "--dry-run"], { env });
  assert.equal(dry.code, 0); assert.equal(dry.json.dryRun, true); assert.ok(dry.json.command.includes("serve")); assert.equal(await healthOk(`http://127.0.0.1:${port}`), false);
  const up = await runOmb(["up", "--project", dir, "--port", String(port), "--data-dir", dataDir, "--ask-timeout-ms", "1234"], { env });
  t.after(async () => { const s = loadState(statePaths(dir))?.server; if (s?.supervisorPid) { try { process.kill(s.supervisorPid, "SIGKILL"); } catch {} } });
  assert.equal(up.code, 0, up.stdout + up.stderr);
  assert.equal(up.json.status, "owned"); assert.equal(up.json.changed, true);
  assert.notEqual(up.json.supervisorPid, up.json.healthPid);
  assert.equal(procInfo(up.json.healthPid).ppid, up.json.supervisorPid);
  assert.ok(up.json.environmentId); assert.equal(up.json.dataDir, dataDir); assert.equal(up.json.askTimeoutMs, 1234);
  assert.equal(await healthOk(`http://127.0.0.1:${port}`), true, "the server survives the driver's exit");
  const state = loadState(statePaths(dir));
  assert.equal(state.server.owned, true); assert.equal(state.server.healthPid, up.json.healthPid);
  assert.ok(fs.existsSync(path.join(dataDir, "serve.log")));
  const again = await runOmb(["up", "--project", dir], { env });
  assert.equal(again.code, 0); assert.equal(again.json.status, "owned"); assert.equal(again.json.changed, false); assert.equal(again.json.healthPid, up.json.healthPid);
  const fresh = await runOmb(["up", "--project", dir, "--fresh"], { env });
  assert.equal(fresh.code, 3); assert.match(fresh.json.error, /owns is running/);
  const doc = await runOmb(["doctor", "--project", dir, "--server"], { env });
  assert.equal(doc.code, 0, doc.stdout);
  const byId = Object.fromEntries(doc.json.checks.map((c) => [c.id, c]));
  assert.equal(byId.health.ok, true); assert.equal(byId.session.ok, true); assert.equal(byId.engines.ok, true);
  assert.equal(byId["provider-keys"].ok, true, byId["provider-keys"].detail);
  assert.equal(byId.identity.ok, true);
  assert.ok(doc.json.engines.some((e) => e.id === "claude" && e.effortLevels.includes("max")));
  const down = await runOmb(["down", "--project", dir], { env });
  assert.equal(down.code, 0, down.stdout + down.stderr);
  assert.equal(down.json.stopped, true);
  await sleep(100);
  assert.equal(await healthOk(`http://127.0.0.1:${port}`), false);
  assert.equal(procInfo(up.json.supervisorPid), null); assert.equal(procInfo(up.json.healthPid), null);
  const after = loadState(statePaths(dir)).server;
  assert.equal(after.owned, false); assert.equal(after.healthPid, null); assert.equal(after.url, `http://127.0.0.1:${port}`);
  const downAgain = await runOmb(["down", "--project", dir], { env });
  assert.equal(downAgain.code, 3); assert.match(downAgain.json.error, /attached, not owned/);
  const restart = await runOmb(["up", "--project", dir], { env });
  assert.equal(restart.code, 0); assert.equal(restart.json.status, "owned"); assert.equal(restart.json.url, `http://127.0.0.1:${port}`);
  assert.equal(restart.json.environmentId, up.json.environmentId, "the same data dir keeps its environment id");
  await runOmb(["down", "--project", dir], { env });
});

test("up attaches to a server it did not start; down refuses it; --fresh refuses a busy port", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { dir } = makeRepo();
  const env = { OMB_BIN: FAKE, OMB_TOKEN: "" };
  const up = await runOmb(["up", "--project", dir, "--port", String(f.port)], { env });
  assert.equal(up.code, 0, up.stdout); assert.equal(up.json.status, "attached"); assert.equal(up.json.owned, false); assert.equal(up.json.healthPid, process.pid);
  assert.equal(up.json.environmentId, f.environmentId);
  const fresh = await runOmb(["up", "--project", dir, "--port", String(f.port), "--fresh"], { env });
  assert.equal(fresh.code, 3); assert.match(fresh.json.error, /does not own/);
  const down = await runOmb(["down", "--project", dir], { env });
  assert.equal(down.code, 3); assert.match(down.json.error, /attached, not owned/);
});

test("down refuses stale or reused identities", { skip: !linux && "needs /proc" }, async () => {
  const { dir } = makeRepo();
  const paths = statePaths(dir);
  const me = procInfo(process.pid);
  await updateState(paths, (d) => { d.server = { url: "http://127.0.0.1:1", owned: true, supervisorPid: 999999, supervisorStart: 1, healthPid: 999998, healthStart: 1, environmentId: "e" }; return d; });
  let r = await runOmb(["down", "--project", dir], { env: { OMB_TOKEN: "" } });
  assert.equal(r.code, 3); assert.match(r.json.error, /supervisor pid 999999 is not alive/); assert.match(r.json.error, /server pid 999998 is not alive/);
  await updateState(paths, (d) => { d.server = { url: "http://127.0.0.1:1", owned: true, supervisorPid: process.pid, supervisorStart: me.startTicks + 1, healthPid: process.pid, healthStart: me.startTicks, environmentId: "e" }; return d; });
  r = await runOmb(["down", "--project", dir], { env: { OMB_TOKEN: "" } });
  assert.equal(r.code, 3); assert.match(r.json.error, /was reused by another process/);
  assert.equal(procInfo(process.pid).alive, true, "the test process was never signalled");
});

test("up reports a server that dies at startup with the log tail and a sandbox hint", { skip: !linux && "needs /proc" }, async (t) => {
  const { dir } = makeRepo();
  const port = await freePort();
  const blocker = net.createServer(); await new Promise((r) => blocker.listen(port, "127.0.0.1", r)); t.after(() => blocker.close());
  const dataDir = path.join(tmpDir("oml-dead-"), "data");
  const r = await runOmb(["up", "--project", dir, "--port", String(port), "--data-dir", dataDir, "--timeout", "10"], { env: { OMB_BIN: FAKE, OMB_TOKEN: "" } });
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.json.error, /exited during startup/);
  assert.match(r.json.log, /EADDRINUSE/);
  assert.match(r.json.hint, /see .*serve\.log/);
  assert.equal(loadState(statePaths(dir)), null, "nothing is recorded for a server that never answered");
});
