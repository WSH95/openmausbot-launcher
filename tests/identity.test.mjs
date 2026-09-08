import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startFake, makeRepo, runOmb, ROOT, FAKE, freePort, sleep } from "./helpers.mjs";
import { statePaths, loadState, updateState, withLock, commitState } from "../skills/openmausbot-launcher/scripts/lib/state.mjs";
import { procInfo, freshDataDir, unreachable } from "../skills/openmausbot-launcher/scripts/lib/server.mjs";
import { serverIdentity } from "../skills/openmausbot-launcher/scripts/lib/session.mjs";
import { Fail } from "../skills/openmausbot-launcher/scripts/lib/cli.mjs";
import { createClient } from "../skills/openmausbot-launcher/scripts/lib/http.mjs";

const PKG = path.join(ROOT, "tests/fixtures/dev-team.package.json");
async function setup(t) {
  const f = await startFake(); t.after(() => f.close()); const { dir } = makeRepo();
  const env = { OMB_TOKEN: "", OMB_DATA_DIR: f.dataDir, OMB_BIN: FAKE };
  const run = (args) => runOmb([...args, "--project", dir], { env });
  assert.equal((await run(["import", PKG, "--url", f.url])).code, 0);
  assert.equal((await run(["bind", "--default", "claude/claude-sonnet-5"])).code, 0);
  assert.equal((await run(["facts", "--test", "true"])).code, 0);
  const task = await run(["task", "--todo", "T1"]); assert.equal(task.code, 0, task.stdout);
  return { f, dir, env, run, task: task.json, paths: statePaths(dir) };
}

test("all live run verbs reject a changed environment without mutating the server", async (t) => {
  const { f, run, paths, task } = await setup(t);
  await f.control({ op: "card", threadId: task.leadThreadId, kind: "approval", requestId: "one" });
  await f.control({ op: "newEnvironment" });
  const posts = []; f.server.on("request", (r) => { if (r.method !== "GET" && !r.url.startsWith("/__fake")) posts.push(r.url); });
  const before = fs.readFileSync(paths.file, "utf8");
  for (const args of [["status"], ["watch", "--max-seconds", "5"], ["send", "hello"], ["answer", "--allow", "--request", "one"], ["interrupt"], ["report", "--no-tests"]]) {
    const r = await run(args); assert.equal(r.code, 3, r.stdout); assert.match(r.json.error, /not the one|identity/i);
  }
  assert.equal(fs.readFileSync(paths.file, "utf8"), before); assert.deepEqual(posts, []);
});

test("same environment with a different server process invalidates the binding", async (t) => {
  const { run, paths } = await setup(t);
  await updateState(paths, (d) => { d.server.healthPid = process.pid; d.server.healthStart = procInfo(process.pid).startTicks + 1; });
  const r = await run(["status"]); assert.equal(r.code, 3, r.stdout);
});

test("remote status never reads receipts from an unverified local data directory", async (t) => {
  const { run, task } = await setup(t);
  const other = await startFake(); t.after(() => other.close());
  await other.control({ op: "receipt", id: "foreign", sourceThreadId: task.leadThreadId, toBotName: "ForeignBot", status: "failed" });
  const r = await run(["status", "--remote", "--data-dir", other.dataDir]);
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.receipts.supported, false);
  assert.equal(r.json.outcomes.some((o) => o.id === "receipt:foreign"), false);
});

test("server identity requests retain the client timeout within a longer watch deadline", async () => {
  const seen = [];
  const client = { timeoutMs: 15000, get: async (url, opts) => {
    seen.push(opts.timeoutMs);
    return url === "/api/health" ? { app: "openmausbot", pid: 1 } : { environmentId: "remote-env" };
  } };
  await serverIdentity({ mode: "remote" }, client, { timeoutMs: 1800000 });
  assert.deepEqual(seen, [15000, 15000]);
  seen.length = 0;
  await serverIdentity({ mode: "remote" }, client, { timeoutMs: 12 });
  assert.deepEqual(seen, [12, 12]);
});

test("an absent environment identity never authorizes a run command", async (t) => {
  const { run, paths } = await setup(t);
  await updateState(paths, (d) => { d.team.environmentId = null; d.server.environmentId = null; });
  const r = await run(["send", "hello"]); assert.equal(r.code, 3, r.stdout);
});

test("local data capabilities refuse missing or mismatched server files", async (t) => {
  const { run, dir, f } = await setup(t);
  const missing = path.join(dir, "absent-data");
  for (const args of [["task", "--resume"], ["bind"], ["facts"], ["report", "--no-tests"]]) {
    const r = await run([...args, "--data-dir", missing]); assert.equal(r.code, 3, r.stdout); assert.match(r.json.error, /data|readable/);
  }
  const other = makeRepo();
  const r = await runOmb(["import", PKG, "--project", other.dir, "--url", f.url, "--data-dir", missing], { env: { OMB_TOKEN: "" } });
  assert.equal(r.code, 3, r.stdout); assert.equal(loadState(statePaths(other.dir)), null);
  const wrong = await startFake(); t.after(() => wrong.close());
  const mismatch = await run(["facts", "--data-dir", wrong.dataDir]); assert.equal(mismatch.code, 3, mismatch.stdout);
  const preview = await runOmb(["up", "--project", other.dir, "--port", String(await freePort()), "--data-dir", missing, "--dry-run"], { env: { OMB_TOKEN: "", OMB_BIN: FAKE } });
  assert.equal(preview.code, 0, preview.stdout); assert.equal(fs.existsSync(missing), false);
});

test("unverifiable live ownership prevents import and up from overwriting the server record", async (t) => {
  const { f, run, paths } = await setup(t);
  assert.equal((await run(["task", "--abandon"])).code, 0);
  const other = await startFake(); t.after(() => other.close());
  const ticks = procInfo(process.pid).startTicks;
  await updateState(paths, (d) => { d.server = { ...d.server, owned: true, supervisorPid: process.pid, supervisorStart: ticks, healthPid: process.pid, healthStart: ticks }; });
  const before = fs.readFileSync(paths.file, "utf8");
  const posts = []; other.server.on("request", (r) => { if (r.method === "POST") posts.push(r.url); });
  const r = await run(["import", PKG, "--url", other.url, "--data-dir", other.dataDir]); assert.equal(r.code, 3, r.stdout);
  assert.equal(fs.readFileSync(paths.file, "utf8"), before); assert.deepEqual(posts, []);
  const up = await run(["up", "--port", String(other.port), "--data-dir", other.dataDir]); assert.equal(up.code, 3, up.stdout);
  assert.equal(fs.readFileSync(paths.file, "utf8"), before);
  assert.equal((await fetch(`${f.url}/api/health`)).status, 200);
});

test("proven stopped ownership is replaced together with the selected team", async (t) => {
  const { run, paths } = await setup(t); await run(["task", "--abandon"]);
  const other = await startFake(); t.after(() => other.close());
  await updateState(paths, (d) => { d.server = { ...d.server, owned: true, supervisorPid: 99999999, supervisorStart: 1, healthPid: 99999998, healthStart: 1 }; });
  const r = await run(["import", PKG, "--url", other.url, "--data-dir", other.dataDir]); assert.equal(r.code, 0, r.stdout);
  const d = loadState(paths); assert.equal(d.server.url, other.url); assert.equal(d.server.owned, false); assert.equal(d.team.environmentId, other.environmentId);
});

test("fresh data allocation reserves distinct directories atomically", () => {
  const { dir } = makeRepo(); const base = path.join(dir, "data");
  const a = freshDataDir(base), b = freshDataDir(base);
  assert.notEqual(a, b); assert.equal(fs.statSync(a).isDirectory(), true); assert.equal(fs.statSync(b).isDirectory(), true);
});

test("abandon refuses a run replaced while it waits for the state lock", async (t) => {
  const { run, paths } = await setup(t);
  let release; const held = withLock(paths, () => new Promise((r) => { release = r; }));
  while (!release) await sleep(5);
  const pending = run(["task", "--abandon"]);
  await sleep(250);
  const doc = loadState(paths); doc.task = { ...doc.task, runId: "replacement", title: "Replacement" }; commitState(paths, doc);
  release(); await held;
  const r = await pending;
  assert.equal(r.code, 3, r.stdout); assert.equal(loadState(paths).task.runId, "replacement");
});

test("watch checkpoints wait at most one second for another writer", async (t) => {
  const { run, paths } = await setup(t);
  let release; const held = withLock(paths, () => new Promise((r) => { release = r; }));
  while (!release) await sleep(5);
  const timer = setTimeout(() => release(), 2500);
  t.after(async () => { clearTimeout(timer); release(); await held; });
  const start = performance.now();
  const r = await run(["watch", "--max-seconds", "0.2"]);
  assert.equal(r.json.checkpointed, false, r.stdout);
  assert.ok(performance.now() - start < 1800);
});

test("a closed port is a network failure, exit 1 with the cause, not an identity failure", async (t) => {
  const { run } = await setup(t);
  const closed = await freePort();
  const r = await run(["status", "--url", `http://127.0.0.1:${closed}`]);
  assert.equal(r.code, 1, r.stdout);
  assert.equal(r.json.error, `cannot reach http://127.0.0.1:${closed}: ECONNREFUSED`);
  assert.equal(r.json.hint, `nothing is listening at http://127.0.0.1:${closed}: run up, or check --url`);
});

test("unreachable maps the syscall code to the operator's hint", () => {
  const net = (message) => Object.assign(new Error(message), { network: true });
  const eperm = unreachable("http://127.0.0.1:8905", net("GET /api/health: EPERM"));
  assert.ok(eperm instanceof Fail); assert.equal(eperm.code, 1);
  assert.equal(eperm.message, "cannot reach http://127.0.0.1:8905: EPERM");
  assert.equal(eperm.hint, "the shell's sandbox blocks outbound connections: run this command outside the sandbox (escalation), or use --remote against a reachable URL");
  assert.equal(unreachable("http://127.0.0.1:8905", net("GET /api/health: EACCES")).hint, eperm.hint);
  assert.equal(unreachable("http://127.0.0.1:1", net("GET /api/health: ECONNREFUSED")).hint, "nothing is listening at http://127.0.0.1:1: run up, or check --url");
  assert.equal(unreachable("http://127.0.0.1:1", net("GET /api/health: no answer within 12 ms")).message, "cannot reach http://127.0.0.1:1: no answer within 12 ms");
  assert.equal(unreachable("http://127.0.0.1:1", net("GET /api/health: no answer within 12 ms")).hint, "the server did not answer within 12 ms");
});

test("status --remote keeps the binding without /proc: identity has healthStart null, the same url and pid", async (t) => {
  const { f, run, task } = await setup(t);
  const identity = await serverIdentity({ mode: "remote", dataDirReadable: false }, createClient({ url: f.url }));
  assert.equal(identity.healthStart, null); assert.equal(identity.healthPid, process.pid); assert.equal(identity.environmentId, f.environmentId);
  const r = await run(["status", "--remote", "--url", f.url]);
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.run.runId, task.runId); assert.equal(r.json.receipts.supported, false, "no data dir is read remotely");
  const other = await startFake(); t.after(() => other.close());
  const elsewhere = await run(["status", "--remote", "--url", other.url]);
  assert.equal(elsewhere.code, 3, elsewhere.stdout); assert.match(elsewhere.json.error, /not the one this team was imported on/);
});
