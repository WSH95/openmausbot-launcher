import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startFake, freePort, freePortPair, tmpDir, makeRepo, runOmb, sleep, FAKE } from "./helpers.mjs";
import net from "node:net";
import http from "node:http";
import { statePaths, loadState, updateState } from "../skills/openmausbot-launcher/scripts/lib/state.mjs";
import { procInfo, verifyOwned, proveOwnership, healthCheck } from "../skills/openmausbot-launcher/scripts/lib/server.mjs";

const linux = process.platform === "linux";
const healthOk = async (url) => { try { return (await (await fetch(`${url}/api/health`)).json()).app === "openmausbot"; } catch { return false; } };

// A real Codex workspace-write serve.log (review fixture codex-ww-data-20260908T110446-DLKtHf, 2026-09-08):
// `listen EPERM` on lines 3 (webhook port) and 10 (API port); lines 14-25 are the stack and Node's property dump.
const CODEX_WW_LOG = `${[
  "(node:16) ExperimentalWarning: SQLite is an experimental feature and might change at any time",
  "(Use `node --trace-warnings ...` to show where the warning was created)",
  "openmausbot webhook receiver unavailable: listen EPERM: operation not permitted 127.0.0.1:8906",
  "openmausbot open-source edition",
  "brand: default",
  "node:events:486",
  "      throw er; // Unhandled 'error' event",
  "      ^",
  "",
  "Error: listen EPERM: operation not permitted 127.0.0.1:8905",
  "    at Server.setupListenHandle [as _listen2] (node:net:1918:21)",
  "    at listenInCluster (node:net:1997:12)",
  "    at node:net:2206:7",
  "    at process.processTicksAndRejections (node:internal/process/task_queues:90:21)",
  "Emitted 'error' event on Server instance at:",
  "    at emitErrorNT (node:net:1976:8)",
  "    at process.processTicksAndRejections (node:internal/process/task_queues:90:21) {",
  "  code: 'EPERM',",
  "  errno: -1,",
  "  syscall: 'listen',",
  "  address: '127.0.0.1',",
  "  port: 8905",
  "}",
  "",
  "Node.js v24.11.0",
].join("\n")}\n`;

test("doctor: bootstrap checks on a plain repository", async () => {
  const { dir } = makeRepo();
  const r = await runOmb(["doctor", "--project", dir], { env: { OMB_BIN: FAKE, OMB_TOKEN: "" } });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const ids = r.json.checks.map((c) => c.id);
  assert.deepEqual(ids, ["node", "binary", "git", "project", "data-dir"]);
  assert.equal(r.json.checks.find((c) => c.id === "binary").ok, true);
  assert.equal(r.json.mode, "local");
  assert.equal(r.json.state.server, null);
  assert.deepEqual(r.json.state.runs, [], "the state summary counts runs, not one task");
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
  assert.match(r.json.checks.find((c) => c.id === "node").detail, /needs 24\+/);
});

test("up starts a detached server that outlives the driver, proves ownership, and down stops it", { skip: !linux && "needs /proc" }, async (t) => {
  const { dir } = makeRepo();
  const port = await freePortPair();
  const dataDir = path.join(tmpDir("oml-updata-"), "data");
  const env = { OMB_BIN: FAKE, OMB_TOKEN: "", ANTHROPIC_API_KEY: "sk-test-should-be-stripped" };
  const dry = await runOmb(["up", "--project", dir, "--port", String(port), "--data-dir", dataDir, "--dry-run"], { env });
  assert.equal(dry.code, 0); assert.equal(dry.json.dryRun, true); assert.ok(dry.json.command.includes("serve")); assert.equal(await healthOk(`http://127.0.0.1:${port}`), false);
  assert.deepEqual(dry.json.ports, [port, port + 1]);
  const up = await runOmb(["up", "--project", dir, "--port", String(port), "--data-dir", dataDir, "--ask-timeout-ms", "1234"], { env });
  t.after(async () => { const s = loadState(statePaths(dir))?.server; for (const pid of [s?.healthPid, s?.supervisorPid]) if (pid) { try { process.kill(pid, "SIGKILL"); } catch {} } });
  assert.equal(up.code, 0, up.stdout + up.stderr);
  assert.equal(up.json.status, "owned"); assert.equal(up.json.changed, true); assert.deepEqual(up.json.ports, [port, port + 1]);
  assert.notEqual(up.json.supervisorPid, up.json.healthPid);
  assert.equal(procInfo(up.json.healthPid).ppid, up.json.supervisorPid);
  assert.ok(up.json.environmentId); assert.equal(up.json.dataDir, dataDir); assert.equal(up.json.askTimeoutMs, 1234);
  assert.equal(await healthOk(`http://127.0.0.1:${port}`), true, "the server survives the driver's exit");
  const state = loadState(statePaths(dir));
  assert.equal(state.server.owned, true); assert.equal(state.server.healthPid, up.json.healthPid);
  const missingEnvironment = await verifyOwned(state.server, { get: async (url) => url === "/api/health" ? { app: "openmausbot", pid: up.json.healthPid } : null });
  assert.equal(missingEnvironment.ok, false, "missing live environment identity cannot authorize a signal");
  const missingRecordedEnvironment = await verifyOwned({ ...state.server, environmentId: null }, { get: async (url) => url === "/api/health" ? { app: "openmausbot", pid: up.json.healthPid } : { environmentId: up.json.environmentId } });
  assert.equal(missingRecordedEnvironment.ok, false, "missing recorded environment identity cannot authorize a signal");
  await assert.rejects(proveOwnership({ supervisorPid: up.json.supervisorPid, dataDir, url: up.json.url, client: { get: async (url) => url === "/api/health" ? { app: "openmausbot", pid: up.json.healthPid } : null } }), /environment.*verif|identity/i);
  assert.deepEqual(serveLogs(dataDir), [path.basename(up.json.log)], "the spawn's own log file, recorded as server.log");
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
  const env = { OMB_BIN: FAKE, OMB_TOKEN: "", OMB_DATA_DIR: f.dataDir };
  const up = await runOmb(["up", "--project", dir, "--port", String(f.port)], { env });
  assert.equal(up.code, 0, up.stdout); assert.equal(up.json.status, "attached"); assert.equal(up.json.owned, false); assert.equal(up.json.healthPid, process.pid);
  assert.equal(up.json.environmentId, f.environmentId);
  const fresh = await runOmb(["up", "--project", dir, "--port", String(f.port), "--fresh"], { env });
  assert.equal(fresh.code, 3); assert.match(fresh.json.error, /does not own/);
  const down = await runOmb(["down", "--project", dir], { env });
  assert.equal(down.code, 3); assert.match(down.json.error, /attached, not owned/);
});

test("up refuses attachment when the readable data directory belongs to another environment", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const other = await startFake(); t.after(() => other.close());
  const { dir } = makeRepo();
  const r = await runOmb(["up", "--project", dir, "--port", String(f.port), "--data-dir", other.dataDir], { env: { OMB_BIN: FAKE, OMB_TOKEN: "" } });
  assert.equal(r.code, 3, r.stdout);
  assert.equal(loadState(statePaths(dir)), null);
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

/**
 * Run `up` with its API port taken and the neighbour `port + 1` free, which is
 * what makes the spawned server die of EADDRINUSE. The rest of the suite opens
 * and closes servers in parallel, so a neighbour measured as free can be taken
 * before `up` runs — and `up` then refuses the pair before it ever spawns the
 * server these tests are about. Hold both until the last moment, and when the
 * race is lost anyway, take another pair instead of asserting through it.
 */
async function upWithPortTaken(t, { dir, dataDir, env = {} }) {
  // A reservation can lose the same race it exists to win: another test process
  // may take the port between the measurement and the listen, and an unhandled
  // 'error' there would be an uncaught exception rather than another attempt.
  const reserve = (p, s = net.createServer()) => new Promise((resolve) => {
    s.once("error", () => resolve(null));
    s.listen(p, "127.0.0.1", () => resolve(s));
  });
  // The blocker answers every request at once with `200 {}`, which `healthProbe`
  // reads as "not OpenMausBot" (server.mjs:75-80). A silent TCP socket instead
  // spends the client's whole timeout on the first probe, before waitHealthy
  // has begun, and `up` then loses the race against runOmb's kill.
  const answering = () => http.createServer((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); });
  for (let attempt = 1; ; attempt++) {
    const port = await freePortPair();
    const neighbour = await reserve(port + 1);
    const blocker = await reserve(port, answering());
    if (!neighbour || !blocker) {
      assert.ok(attempt < 5, `could not reserve ${port} and ${port + 1} in five attempts`);
      neighbour?.close(); blocker?.close();
      continue;
    }
    t.after(() => { blocker.closeAllConnections(); blocker.close(); });
    await new Promise((r) => neighbour.close(r));
    const r = await runOmb(["up", "--project", dir, "--port", String(port), "--data-dir", dataDir, "--timeout", "30"], { env: { OMB_BIN: FAKE, OMB_TOKEN: "", ...env }, timeoutMs: 60_000 });
    if (/is in use; OpenMausBot binds/.test(r.json?.error ?? "")) {
      assert.ok(attempt < 5, `the neighbour of ${port} was taken on every attempt: ${r.stdout}`);
      blocker.closeAllConnections(); blocker.close();
      continue;
    }
    return r;
  }
}

/** Kill whatever a test started, registered before its first assertion. */
function reaper(t) {
  const pids = [];
  t.after(() => { for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch {} } });
  return pids;
}
/** Wait for a process to be gone, on the fact and not on an estimate. */
async function gone(pid, budgetMs = 15_000) {
  const stop = Date.now() + budgetMs;
  while (Date.now() < stop) { if (!procInfo(pid)?.alive) return; await sleep(20); }
  throw new Error(`pid ${pid} is still alive after ${budgetMs} ms`);
}
const leaseOwner = (dataDir) => JSON.parse(fs.readFileSync(path.join(dataDir, "openmausbot-server.lease"), "utf8"));
const serveLogs = (dataDir) => fs.readdirSync(dataDir).filter((f) => /^serve\..*\.log$/.test(f));

test("up names the folders the other bots on a shared server are configured for, and persists none of them", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { dir } = makeRepo();
  const env = { OMB_BIN: FAKE, OMB_TOKEN: "", OMB_DATA_DIR: f.dataDir };
  const elsewhere = tmpDir("oml-elsewhere-");
  assert.equal((await runOmb(["import", "--adopt", "Nobody", "--project", dir, "--url", f.url], { env })).code, 3, "no team yet");
  await f.control({ op: "bot", name: "Sudo", section: "Dev team", cwd: elsewhere });
  await f.control({ op: "bot", name: "Nova", section: "Dev team", cwd: elsewhere });
  let up = await runOmb(["up", "--project", dir, "--port", String(f.port)], { env });
  assert.equal(up.code, 0, up.stdout);
  assert.equal(up.json.otherConfiguredFoldersKnown, true);
  assert.deepEqual(up.json.otherConfiguredFolders, [elsewhere], "with no team recorded, every bot is foreign");
  assert.equal(up.json.otherConfiguredFolderCount, 1, "distinct folders");
  assert.match(up.json.hint, /bots configured for other folders/);
  assert.equal(JSON.stringify(loadState(statePaths(dir))).includes(elsewhere), false, "no foreign folder reaches the state");
  const brief = await runOmb(["up", "--project", dir, "--port", String(f.port), "--brief"], { env });
  assert.match(brief.stdout.trim(), /· shared$/);
  assert.equal(brief.stdout.includes(elsewhere), false, "the brief never prints a path");
  assert.equal((await runOmb(["import", "--adopt", "Dev team", "--lead", "Sudo", "--project", dir, "--url", f.url], { env })).code, 0);
  up = await runOmb(["up", "--project", dir, "--port", String(f.port)], { env });
  assert.deepEqual(up.json.otherConfiguredFolders, [], "this team's own folders are not other folders");
  assert.equal(up.json.otherConfiguredFoldersKnown, true);
  assert.equal(up.json.hint, undefined);
  await f.control({ op: "newEnvironment" });
  up = await runOmb(["up", "--project", dir, "--port", String(f.port)], { env });
  assert.deepEqual(up.json.otherConfiguredFolders, [elsewhere], "a team recorded for another environment hides no bot");
  await f.control({ op: "failRoute", route: "^/api/bots", count: 1 });
  up = await runOmb(["up", "--project", dir, "--port", String(f.port)], { env });
  assert.equal(up.code, 0, up.stdout);
  assert.equal(up.json.otherConfiguredFoldersKnown, false, "a failed fleet read is unknown, not an unshared server");
  assert.equal(up.json.otherConfiguredFolders, undefined);
});

test("up refuses a data directory another OpenMausBot holds and leaves that server alone", { skip: !linux && "needs /proc" }, async (t) => {
  const a = makeRepo(); const b = makeRepo();
  const pids = reaper(t);
  const env = { OMB_BIN: FAKE, OMB_TOKEN: "" };
  const dataDir = path.join(tmpDir("oml-lease-"), "data");
  const first = await runOmb(["up", "--project", a.dir, "--port", String(await freePortPair()), "--data-dir", dataDir], { env });
  assert.equal(first.code, 0, first.stdout + first.stderr);
  pids.push(first.json.supervisorPid, first.json.healthPid);
  assert.equal(leaseOwner(dataDir).pid, first.json.healthPid, "the server child holds the lease, not its supervisor");
  const elsewhere = tmpDir("oml-elsewhere-");
  await fetch(`${first.json.url}/__fake`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "bot", name: "Stranger", section: "Other", cwd: elsewhere }) });
  const owned = await runOmb(["up", "--project", a.dir], { env });
  assert.equal(owned.code, 0, owned.stdout);
  assert.equal(owned.json.changed, false);
  assert.deepEqual(owned.json.otherConfiguredFolders, [elsewhere]);
  assert.match(owned.json.hint, /resolving this ownership first/);
  const second = await runOmb(["up", "--project", b.dir, "--port", String(await freePortPair()), "--data-dir", dataDir], { env });
  assert.equal(second.code, 3, second.stdout + second.stderr);
  assert.equal(second.json.error, `data directory ${dataDir} is in use by another OpenMausBot (process ${first.json.healthPid})`);
  assert.match(second.json.hint, /attach to that server with up --port/);
  assert.match(second.json.hint, /--data-dir/);
  assert.equal(loadState(statePaths(b.dir)), null, "nothing of the refused server is recorded");
  assert.equal(await healthOk(first.json.url), true, "the first server is untouched");
  assert.equal(leaseOwner(dataDir).pid, first.json.healthPid, "a refused contender never touches the owner's lease");
  assert.equal(serveLogs(dataDir).length, 2, "each spawn has its own log file");
  assert.equal(procInfo(second.json.supervisorPid ?? -1), null);
  assert.equal((await runOmb(["down", "--project", a.dir], { env })).code, 0);
  assert.equal(fs.existsSync(path.join(dataDir, "openmausbot-server.lease")), false, "a clean exit releases it");
});

test("a killed server's lease is recovered; a killed supervisor leaves its child holding the directory", { skip: !linux && "needs /proc" }, async (t) => {
  const a = makeRepo(); const b = makeRepo();
  const pids = reaper(t);
  const env = { OMB_BIN: FAKE, OMB_TOKEN: "" };
  const dataDir = path.join(tmpDir("oml-stale-"), "data");
  const port = await freePortPair();
  const first = await runOmb(["up", "--project", a.dir, "--port", String(port), "--data-dir", dataDir], { env });
  assert.equal(first.code, 0, first.stdout + first.stderr);
  pids.push(first.json.supervisorPid, first.json.healthPid);
  process.kill(first.json.healthPid, "SIGKILL"); process.kill(first.json.supervisorPid, "SIGKILL");
  await gone(first.json.healthPid); await gone(first.json.supervisorPid);
  assert.equal(fs.existsSync(path.join(dataDir, "openmausbot-server.lease")), true, "SIGKILL leaves the record behind");
  const restarted = await runOmb(["up", "--project", a.dir, "--port", String(port), "--data-dir", dataDir], { env });
  assert.equal(restarted.code, 0, restarted.stdout + restarted.stderr);
  pids.push(restarted.json.supervisorPid, restarted.json.healthPid);
  assert.equal(leaseOwner(dataDir).pid, restarted.json.healthPid, "a dead owner's lease is recovered");
  process.kill(restarted.json.supervisorPid, "SIGKILL");
  await gone(restarted.json.supervisorPid);
  assert.equal(procInfo(restarted.json.healthPid).alive, true, "killing only the supervisor leaves the child alive");
  const contender = await runOmb(["up", "--project", b.dir, "--port", String(await freePortPair()), "--data-dir", dataDir], { env });
  assert.equal(contender.code, 3, contender.stdout + contender.stderr);
  assert.equal(contender.json.error, `data directory ${dataDir} is in use by another OpenMausBot (process ${restarted.json.healthPid})`);
});

test("a lease refusal in the directory's history never explains another startup's death", { skip: !linux && "needs /proc" }, async (t) => {
  const a = makeRepo(); const b = makeRepo();
  const pids = reaper(t);
  const env = { OMB_BIN: FAKE, OMB_TOKEN: "" };
  const dataDir = path.join(tmpDir("oml-history-"), "data");
  const first = await runOmb(["up", "--project", a.dir, "--port", String(await freePortPair()), "--data-dir", dataDir], { env });
  assert.equal(first.code, 0, first.stdout + first.stderr);
  pids.push(first.json.supervisorPid, first.json.healthPid);
  const refused = await runOmb(["up", "--project", b.dir, "--port", String(await freePortPair()), "--data-dir", dataDir], { env });
  assert.equal(refused.code, 3, refused.stdout);
  assert.equal((await runOmb(["down", "--project", a.dir], { env })).code, 0);
  const dead = await upWithPortTaken(t, { dir: b.dir, dataDir });
  assert.equal(dead.code, 1, dead.stdout);
  assert.match(dead.json.error, /exited during startup/);
  assert.match(dead.json.log, /EADDRINUSE/);
  assert.doesNotMatch(dead.json.log, /data directory/, "it reads only its own attempt's log");
  assert.match(dead.json.hint, /see .*serve\..*\.log/);
});

test("a lease record from another machine is refused, and its path is printed without what follows the lease name", { skip: !linux && "needs /proc" }, async (t) => {
  const { dir } = makeRepo();
  const dataDir = path.join(tmpDir("oml-foreign-"), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "openmausbot-server.lease"), `${JSON.stringify({ version: 1, pid: process.pid, host: "another-machine", token: "00000000-0000-4000-8000-000000000000", createdAt: Date.now() })}\n`);
  const r = await runOmb(["up", "--project", dir, "--port", String(await freePortPair()), "--data-dir", dataDir], { env: { OMB_BIN: FAKE, OMB_TOKEN: "" } });
  assert.equal(r.code, 3, r.stdout + r.stderr);
  assert.equal(r.json.error, `data directory ${dataDir} is in use by a process on another machine`);
  assert.ok(r.json.log.includes("openmausbot-server.lease<redacted>"), r.json.log);
  assert.doesNotMatch(r.json.log, /openmausbot-server\.lease["'.\w-]/, "nothing that follows the lease name is printed");
  assert.equal(loadState(statePaths(dir)), null);
});

/** A server this launcher owns, with the fake's control route reachable. */
async function ownedServer(t, pids, project) {
  const env = { OMB_BIN: FAKE, OMB_TOKEN: "" };
  const dataDir = path.join(tmpDir("oml-owned-"), "data");
  const up = await runOmb(["up", "--project", project, "--port", String(await freePortPair()), "--data-dir", dataDir], { env });
  assert.equal(up.code, 0, up.stdout + up.stderr);
  pids.push(up.json.supervisorPid, up.json.healthPid);
  const control = async (op) => { const r = await fetch(`${up.json.url}/__fake`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(op), signal: AbortSignal.timeout(10_000) }); const b = await r.json(); if (!r.ok) throw new Error(b.error); return b; };
  const setCwd = (botId, cwd) => fetch(`${up.json.url}/api/bots/${botId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd }), signal: AbortSignal.timeout(10_000) });
  /** Wait for a fact about the server, never for a duration. */
  const until = async (matches, what, budgetMs = 15_000) => {
    const stop = Date.now() + budgetMs;
    while (Date.now() < stop) {
      const snapshot = await (await fetch(`${up.json.url}/__fake/state`, { signal: AbortSignal.timeout(10_000) })).json();
      if (matches(snapshot)) return snapshot;
      await sleep(20);
    }
    throw new Error(`waited ${budgetMs} ms for ${what}`);
  };
  return { env, url: up.json.url, dataDir, environmentId: up.json.environmentId, control, setCwd, until, down: (...args) => runOmb(["down", "--project", project, ...args], { env }) };
}
/** Another project's folder, with the state file the test wants in it. */
function foreignProject(doc) {
  const dir = tmpDir("oml-foreign-project-");
  if (doc !== undefined) { fs.mkdirSync(path.join(dir, ".omb")); fs.writeFileSync(path.join(dir, ".omb", "state.json"), typeof doc === "string" ? doc : JSON.stringify(doc)); }
  return dir;
}
const openRun = (environmentId) => ({ r1: { runId: "abcdef1234567890", status: "dispatched", slug: "t10", title: "T10", context: { server: { environmentId } } } });

test("down refuses a server under work it can observe, and --stop-others overrides exactly that", { skip: !linux && "needs /proc" }, async (t) => {
  const { dir } = makeRepo();
  const pids = reaper(t);
  const s = await ownedServer(t, pids, dir);
  const sudo = (await s.control({ op: "bot", name: "Sudo", section: "Dev team", chiefOfStaff: true })).bot;
  assert.equal((await runOmb(["import", "--adopt", "Dev team", "--project", dir, "--url", s.url], { env: s.env })).code, 0);
  const stranger = (await s.control({ op: "bot", name: "Stranger", section: "Other team" })).bot;
  await s.control({ op: "activity", botId: stranger.id, activity: "working" });
  const dry = await s.down("--dry-run");
  assert.equal(dry.code, 3, dry.stdout);
  assert.deepEqual(dry.json.others.busyBots, ["Stranger"]);
  let r = await s.down();
  assert.equal(r.code, 3, r.stdout);
  assert.match(r.json.error, /busy bot/);
  assert.deepEqual(r.json.others.busyBots, ["Stranger"]);
  assert.equal(r.json.others.counts.busyBots, 1);
  assert.match(r.json.hint, /--stop-others/);
  assert.equal(await healthOk(s.url), true, "nothing was signalled");
  await s.control({ op: "activity", botId: stranger.id, activity: "waiting-on-you" });
  r = await s.down();
  assert.equal(r.code, 3); assert.deepEqual(r.json.others.waitingBots, ["Stranger"]);
  await s.control({ op: "activity", botId: stranger.id, activity: "idle" });
  await s.control({ op: "queued", sourceBotId: stranger.id, targetBotId: sudo.id });
  r = await s.down();
  assert.equal(r.code, 3); assert.deepEqual(r.json.others.delegations, [{ state: "queued", source: "Stranger", target: "Sudo" }], "a foreign source with one of ours as target");
  await s.control({ op: "clearDelegations" });
  await s.control({ op: "running", sourceBotId: sudo.id, targetBotId: stranger.id });
  r = await s.down();
  assert.equal(r.code, 3); assert.deepEqual(r.json.others.delegations, [{ state: "running", source: "Sudo", target: "Stranger" }], "and one of ours delegating to a foreign bot");
  await s.control({ op: "clearDelegations" });
  const room = (await s.control({ op: "group", name: "Their Room", memberIds: [stranger.id] })).group;
  await s.control({ op: "roomWorking", groupId: room.id });
  r = await s.down();
  assert.equal(r.code, 3); assert.deepEqual(r.json.others.workingRooms, ["Their Room"]);
  await s.control({ op: "roomWorking", groupId: room.id, working: false });
  const theirs = foreignProject({ version: 2, rev: 3, project: { dir: "/elsewhere" }, server: { environmentId: s.environmentId }, runs: openRun(null), history: [] });
  await s.setCwd(stranger.id, theirs);
  r = await s.down();
  assert.equal(r.code, 3, r.stdout);
  assert.deepEqual(r.json.others.projects, [{ folder: theirs, runs: ["t10 (abcdef12, dispatched)"] }], "the file's own server names this environment");
  await s.control({ op: "failRoute", route: "^/api/team-map", count: 1 });
  await s.control({ op: "activity", botId: stranger.id, activity: "working" });
  r = await s.down();
  assert.equal(r.code, 3, r.stdout);
  assert.deepEqual(r.json.others.busyBots, ["Stranger"], "a failed source erases no positive another one found");
  assert.ok(r.json.others.unknown.some((u) => u.source === "team-map"), JSON.stringify(r.json.others.unknown));
  r = await s.down("--stop-others");
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.json.stopped, true);
  assert.deepEqual(r.json.others.busyBots, ["Stranger"], "the override lists what it overrode");
  assert.equal(await healthOk(s.url), false);
  const stale = await s.down("--stop-others");
  assert.equal(stale.code, 3, "--stop-others bypasses only the other-work guard");
  assert.match(stale.json.error, /attached, not owned/);
});

test("a dry run refuses where the real down would: ownership is proven again after the inspection", { skip: !linux && "needs /proc" }, async (t) => {
  const { dir } = makeRepo();
  const pids = reaper(t);
  const s = await ownedServer(t, pids, dir);
  // The team map is held open while the server's identity changes underneath
  // the inspection: a barrier, so the preview cannot pass on a stale record.
  await s.control({ op: "hold", route: "^/api/team-map" });
  const preview = s.down("--dry-run", "--stop-others");
  await s.until((snapshot) => snapshot.holdWaiting >= 1, "the inspection to reach the team map");
  await s.control({ op: "newEnvironment" });
  await s.control({ op: "release" });
  const r = await preview;
  assert.equal(r.code, 3, r.stdout);
  assert.match(r.json.error, /the environment id changed/);
  assert.equal(r.json.dryRun, undefined, "a refused preview is a refusal, not a preview");
  assert.equal(await healthOk(s.url), true, "and nothing was signalled");
});

test("down stops on known negatives, keeps what it could not read under unknown, and never treats this project as foreign", { skip: !linux && "needs /proc" }, async (t) => {
  const { dir } = makeRepo();
  const pids = reaper(t);
  const s = await ownedServer(t, pids, dir);
  await updateState(statePaths(dir), (d) => { d.runs = openRun(s.environmentId); return d; });
  const stranger = (await s.control({ op: "bot", name: "Stranger", section: "Other team" })).bot;
  const look = async (cwd, why) => {
    await s.setCwd(stranger.id, cwd);
    const r = await s.down("--dry-run");
    assert.equal(r.code, 0, `${why}: ${r.stdout}`);
    return r.json.others;
  };
  let others = await look(foreignProject(), "an idle foreign team with no launcher state");
  assert.deepEqual(others.sharedConfiguration.length, 1);
  assert.deepEqual(others.ownOpenRuns, ["t10 (abcdef12, dispatched)"], "this project's own open runs are listed and do not block");
  assert.deepEqual(others.projects, []);
  others = await look(foreignProject({ version: 1, rev: 1, task: { runId: "zz", status: "closed", title: "old" } }), "a closed version 1 task");
  assert.deepEqual(others.projects, []); assert.deepEqual(others.unknown, []);
  others = await look(foreignProject({ version: 2, rev: 1, server: { environmentId: "someone-else" }, runs: openRun(null) }), "another environment");
  assert.deepEqual(others.projects, []); assert.deepEqual(others.unknown, []);
  for (const [doc, why] of [
    [{ version: 2, rev: 1, server: { environmentId: s.environmentId }, runs: { x: "garbage" } }, "a run that is not an object"],
    [{ version: 3, rev: 1, runs: {} }, "an unsupported version"],
    [{ version: 2, rev: 1, server: { environmentId: null }, runs: openRun(null) }, "two null environment ids"],
    ["{not json", "a malformed file"],
  ]) {
    others = await look(foreignProject(doc), why);
    assert.deepEqual(others.projects, [], why);
    assert.equal(others.unknown.length, 1, `${why}: ${JSON.stringify(others.unknown)}`);
  }
  const oversized = foreignProject({ version: 2, rev: 1, runs: {} });
  fs.writeFileSync(path.join(oversized, ".omb", "state.json"), Buffer.alloc(9 * 1024 * 1024, 32));
  others = await look(oversized, "an oversized file");
  assert.match(others.unknown[0].why, /larger than/);
  const linked = foreignProject();
  fs.mkdirSync(path.join(linked, ".omb"));
  fs.symlinkSync(path.join(oversized, ".omb", "state.json"), path.join(linked, ".omb", "state.json"));
  others = await look(linked, "a symlinked state file");
  assert.match(others.unknown[0].why, /symlink/);
  const disguised = foreignProject();
  fs.mkdirSync(path.join(disguised, ".omb"));
  fs.symlinkSync(path.join(dir, ".omb", "state.json"), path.join(disguised, ".omb", "state.json"));
  others = await look(disguised, "a symlink to this project's own state file");
  assert.deepEqual(others.unknown, []); assert.deepEqual(others.projects, []);
  const blocked = foreignProject();
  fs.writeFileSync(path.join(blocked, "file"), ""); // a path through a file is unreadable, not absent
  others = await look(path.join(blocked, "file", "inner"), "an unreadable folder");
  assert.equal(others.unknown.length, 1, JSON.stringify(others));
  assert.deepEqual(others.sharedConfiguration, [], "what could not be read is never counted as absent");
  others = await look(dir, "a foreign bot configured for this project's own folder");
  assert.deepEqual(others.projects, []); assert.deepEqual(others.unknown, []); assert.deepEqual(others.sharedConfiguration, []);
  assert.deepEqual(others.ownOpenRuns, ["t10 (abcdef12, dispatched)"]);
  const r = await s.down();
  assert.equal(r.code, 0, r.stdout + r.stderr);
});

test("down counts a same-section helper as this team's, and a numbered section as another team", { skip: !linux && "needs /proc" }, async (t) => {
  const { dir } = makeRepo();
  const pids = reaper(t);
  const s = await ownedServer(t, pids, dir);
  const lead = (await s.control({ op: "bot", name: "Sudo", section: "Dev team", chiefOfStaff: true })).bot;
  assert.equal((await runOmb(["import", "--adopt", "Dev team", "--project", dir, "--url", s.url], { env: s.env })).code, 0);
  const helper = (await s.control({ op: "bot", name: "Helper", section: "Dev team" })).bot;
  const twin = (await s.control({ op: "bot", name: "Twin", section: "Dev team 2" })).bot;
  await s.control({ op: "activity", botId: helper.id, activity: "working" });
  let r = await s.down("--dry-run");
  assert.equal(r.code, 0, `a helper the lead created is this team's: ${r.stdout}`);
  await s.control({ op: "activity", botId: twin.id, activity: "working" });
  r = await s.down("--dry-run");
  assert.equal(r.code, 3, r.stdout);
  assert.deepEqual(r.json.others.busyBots, ["Twin"], "Dev team and Dev team 2 are two teams");
  // The live server is untouched; only the recorded team belongs elsewhere, so
  // membership itself has to decide, and no bot of that section is ours.
  await updateState(statePaths(dir), (d) => { d.team.environmentId = "an-environment-this-team-was-imported-on"; return d; });
  r = await s.down("--dry-run");
  assert.equal(r.code, 3, r.stdout);
  assert.deepEqual(r.json.others.busyBots.sort(), ["Helper", "Twin"], "a team recorded for another environment hides no bot");
  await updateState(statePaths(dir), (d) => { d.team.environmentId = s.environmentId; return d; });
  await s.control({ op: "newEnvironment" });
  r = await s.down();
  assert.equal(r.code, 3, "a changed live environment is refused by verification, before any of this");
  assert.match(r.json.error, /environment id changed/);
  assert.equal(r.json.others, undefined);
});

test("a refused down answers --brief in counts, and keeps the folders only in its JSON", { skip: !linux && "needs /proc" }, async (t) => {
  const { dir } = makeRepo();
  const pids = reaper(t);
  const s = await ownedServer(t, pids, dir);
  const stranger = (await s.control({ op: "bot", name: "Stranger", section: "Other team" })).bot;
  const secret = foreignProject({ version: 2, rev: 1, server: { environmentId: s.environmentId }, runs: openRun(null), history: [] });
  await s.setCwd(stranger.id, secret);
  await s.control({ op: "activity", botId: stranger.id, activity: "working" });
  await s.control({ op: "failRoute", route: "^/api/team-map", count: 1 });
  const brief = await s.down("--brief");
  assert.equal(brief.code, 3, brief.stdout + brief.stderr);
  assert.equal(brief.stdout.trim(), "down · refused · 1 busy, 1 other project(s) · 1 unknown");
  assert.equal(brief.stdout.includes(secret), false, "a brief never prints a folder");
  const json = await s.down();
  assert.equal(json.code, 3);
  assert.deepEqual(json.json.others.projects, [{ folder: secret, runs: ["t10 (abcdef12, dispatched)"] }], "the JSON form still names the project the operator has to visit");
  assert.equal((await s.down("--stop-others")).code, 0);
});

test("cleanup --down propagates a down refusal before it does any further work", { skip: !linux && "needs /proc" }, async (t) => {
  const { dir } = makeRepo();
  const pids = reaper(t);
  const s = await ownedServer(t, pids, dir);
  const stranger = (await s.control({ op: "bot", name: "Stranger", section: "Other team" })).bot;
  await s.control({ op: "activity", botId: stranger.id, activity: "working" });
  const r = await runOmb(["cleanup", "--down", "--project", dir], { env: s.env });
  assert.equal(r.code, 3, r.stdout);
  assert.match(r.json.error, /busy bot/);
  assert.match(r.json.hint, /down --stop-others/);
  assert.deepEqual(r.json.others.busyBots, ["Stranger"]);
  assert.equal(r.json.orphans, undefined, "no scan, no reconcile, no kill");
  assert.equal(await healthOk(s.url), true);
  assert.equal((await s.down("--stop-others")).code, 0);
});

test("up reports a server that dies at startup with the log tail and a sandbox hint", { skip: !linux && "needs /proc" }, async (t) => {
  const { dir } = makeRepo();
  const r = await upWithPortTaken(t, { dir, dataDir: path.join(tmpDir("oml-dead-"), "data") });
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.json.error, /exited during startup/);
  assert.match(r.json.log, /EADDRINUSE/);
  assert.match(r.json.hint, /see .*serve\.[\w.]+\.log/, "the hint names this attempt's own log file");
  assert.equal(loadState(statePaths(dir)), null, "nothing is recorded for a server that never answered");
});

test("up names the sandbox cause from anywhere in the attempt's own log, not only its 12-line tail", { skip: !linux && "needs /proc" }, async (t) => {
  const { dir } = makeRepo();
  const dataDir = path.join(tmpDir("oml-sandbox-"), "data");
  // The captured log is replayed by the spawned server itself: the signature has
  // to sit in this attempt's file, because no other file is read any more.
  const prelude = path.join(tmpDir("oml-prelude-"), "codex-ww.log");
  fs.writeFileSync(prelude, CODEX_WW_LOG);
  const r = await upWithPortTaken(t, { dir, dataDir, env: { OMB_FAKE_LOG_PRELUDE: prelude } });
  assert.equal(r.code, 1, r.stdout);
  assert.equal(r.json.log.split("\n").length, 12, "the display tail stays twelve lines");
  assert.doesNotMatch(r.json.log, /EPERM/, "the signature sits above the tail");
  assert.match(r.json.hint, /sandbox blocks listening sockets/);
  assert.match(r.json.hint, /serve\.[\w.]+\.log: openmausbot webhook receiver unavailable: listen EPERM: operation not permitted 127\.0\.0\.1:8906\)/, "the first matching line is named");
  assert.equal(serveLogs(dataDir).length, 1);
});

test("up refuses a port whose neighbour is taken before spawning, and names a webhook receiver's API port", { skip: !linux && "needs /proc" }, async (t) => {
  const { dir } = makeRepo();
  const port = await freePortPair();
  const blocker = net.createServer(); await new Promise((r) => blocker.listen(port + 1, "127.0.0.1", r));
  const dataDir = path.join(tmpDir("oml-neighbour-"), "data");
  let r = await runOmb(["up", "--project", dir, "--port", String(port), "--data-dir", dataDir], { env: { OMB_BIN: FAKE, OMB_TOKEN: "" } });
  assert.equal(r.code, 3, r.stdout);
  assert.equal(r.json.error, `port ${port + 1} is in use; OpenMausBot binds ${port}+1 for its webhook receiver (server/index.ts:320, cli.ts:438)`);
  assert.equal(r.json.hint, "choose a port whose neighbour is free");
  assert.equal(fs.existsSync(dataDir), false, "refused before the spawn: no data dir, no log file");
  assert.equal(loadState(statePaths(dir)), null);
  await new Promise((r) => blocker.close(r));
  const f = await startFake({ port, webhookPort: port + 1 }); t.after(() => f.close());
  r = await runOmb(["up", "--project", dir, "--port", String(port + 1)], { env: { OMB_BIN: FAKE, OMB_TOKEN: "", OMB_DATA_DIR: f.dataDir } });
  assert.equal(r.code, 3, r.stdout);
  assert.equal(r.json.error, `http://127.0.0.1:${port + 1} is an OpenMausBot webhook receiver; its API is on port ${port}`);
  assert.equal(r.json.hint, "servers occupy two consecutive ports; space them two apart");
  assert.equal(loadState(statePaths(dir)), null);
});

test("doctor reads the stop-hook exclude through git, so a linked worktree sees the main repository's exclude", async () => {
  const { dir, git } = makeRepo();
  fs.mkdirSync(path.join(dir, ".project-steward"));
  fs.writeFileSync(path.join(dir, ".project-steward", "config.toml"), "[session]\nauto_handoff_mode = \"off\"\n");
  git("add", "-A"); git("commit", "-q", "-m", "steward");
  fs.appendFileSync(path.join(dir, ".git", "info", "exclude"), ".project-steward/runtime/\n");
  const wt = path.join(tmpDir("oml-wt-"), "wt");
  git("worktree", "add", "-q", "-b", "wt", wt);
  const r = await runOmb(["doctor", "--project", wt], { env: { OMB_BIN: FAKE, OMB_TOKEN: "" } });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.checks.find((c) => c.id === "stop-hook").ok, true);
});

test("down after an environment change names the live pids and the manual recovery", { skip: !linux && "needs /proc" }, async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { dir } = makeRepo();
  const me = procInfo(process.pid);
  await updateState(statePaths(dir), (d) => { d.server = { url: f.url, owned: true, supervisorPid: process.pid, supervisorStart: me.startTicks, healthPid: process.pid, healthStart: me.startTicks, environmentId: f.environmentId, dataDir: f.dataDir }; return d; });
  await f.control({ op: "newEnvironment" });
  let r = await runOmb(["down", "--project", dir], { env: { OMB_TOKEN: "" } });
  assert.equal(r.code, 3, r.stdout);
  assert.match(r.json.error, /the environment id changed/);
  assert.match(r.json.hint, new RegExp(`ps -o pid,lstart,args -p ${process.pid},${process.pid}, then kill ${process.pid} yourself`));
  assert.equal(procInfo(process.pid).alive, true, "the test process was never signalled");
  await updateState(statePaths(dir), (d) => { d.server = { ...d.server, supervisorPid: 999999, supervisorStart: 1, healthPid: 999998, healthStart: 1 }; return d; });
  r = await runOmb(["down", "--project", dir], { env: { OMB_TOKEN: "" } });
  assert.equal(r.code, 3); assert.equal(r.json.hint, "if that server is gone, run up to record a new one");
});

test("up follows the data-dir precedence: a recorded state dir beats OMB_DATA_DIR", { skip: !linux && "needs /proc" }, async () => {
  const { dir } = makeRepo();
  const recorded = path.join(tmpDir("oml-recorded-"), "data");
  const ambient = path.join(tmpDir("oml-ambient-"), "data");
  await updateState(statePaths(dir), (d) => { d.server = { url: "http://127.0.0.1:1", owned: false, dataDir: recorded }; return d; });
  const r = await runOmb(["up", "--project", dir, "--port", String(await freePortPair()), "--dry-run"], { env: { OMB_BIN: FAKE, OMB_TOKEN: "", OMB_DATA_DIR: ambient } });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.dataDir, recorded);
});

test("doctor --server refuses plain http off loopback unless --allow-insecure-http is passed", async () => {
  const { dir } = makeRepo();
  const refused = await runOmb(["doctor", "--server", "--project", dir, "--url", "http://10.0.0.1:1"], { env: { OMB_TOKEN: "" } });
  assert.equal(refused.code, 3, refused.stdout); assert.match(refused.json.error, /is not loopback and not https/); assert.match(refused.json.hint, /--allow-insecure-http/);
  const allowed = await runOmb(["doctor", "--project", dir, "--url", "http://10.0.0.1:1", "--allow-insecure-http"], { env: { OMB_TOKEN: "" } });
  assert.equal(allowed.code, 0, allowed.stdout); assert.equal(allowed.json.mode, "remote"); assert.equal(allowed.json.url, "http://10.0.0.1:1", "the flag parses; without --server no request is made");
});

test("doctor --server reports a refused connection as a dead server, naming the cause", async () => {
  const { dir } = makeRepo();
  const closed = await freePort();
  const r = await runOmb(["doctor", "--server", "--project", dir, "--url", `http://127.0.0.1:${closed}`], { env: { OMB_BIN: FAKE, OMB_TOKEN: "" } });
  assert.equal(r.code, 3, r.stdout);
  const health = r.json.checks.find((c) => c.id === "health");
  assert.equal(health.ok, false);
  assert.equal(health.detail, `nothing answers at http://127.0.0.1:${closed} (ECONNREFUSED)`);
  assert.equal(health.hint, `nothing is listening at http://127.0.0.1:${closed}: run up, or check --url`);
});

test("the doctor health check names a blocked socket and keeps the sandbox hint", () => {
  const net = (message) => Object.assign(new Error(message), { network: true });
  const blocked = healthCheck("http://127.0.0.1:8905", { body: null, network: net("GET /api/health: EPERM") });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.detail, "cannot reach http://127.0.0.1:8905: EPERM");
  assert.equal(blocked.hint, "the shell's sandbox blocks outbound connections: run this command outside the sandbox (escalation), or use --remote against a reachable URL");
  assert.equal(healthCheck("http://127.0.0.1:8905", { body: null, network: net("GET /api/health: EACCES") }).hint, blocked.hint);
  const answered = healthCheck("http://127.0.0.1:8905", { body: { app: "openmausbot", pid: 42 } });
  assert.deepEqual(answered, { ok: true, detail: "http://127.0.0.1:8905 answers, pid 42" });
});
