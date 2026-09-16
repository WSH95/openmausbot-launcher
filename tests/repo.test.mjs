import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { makeRepo, runOmb, sleep } from "./helpers.mjs";
import { ensureExclude, statePaths, updateState, loadState } from "../skills/openmausbot-launcher/scripts/lib/state.mjs";
import { scanOrphans } from "../skills/openmausbot-launcher/scripts/lib/proc.mjs";
import { defaultBranchInfo } from "../skills/openmausbot-launcher/scripts/lib/git.mjs";

const linux = process.platform === "linux";
const env = { OMB_TOKEN: "" };

test("reconcile: clean root, then a task worktree, a task branch, a dirty file, and --remove", async () => {
  const { dir, git } = makeRepo();
  ensureExclude(dir, [".worktrees/", ".omb/"]);
  let r = await runOmb(["reconcile", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.clean, true); assert.equal(r.json.branch, "main"); assert.equal(r.json.defaultBranch, "main");
  git("worktree", "add", "-q", "-b", "task/t1", ".worktrees/t1", "main");
  r = await runOmb(["reconcile", "--project", dir], { env });
  assert.equal(r.code, 3); assert.equal(r.json.clean, false);
  assert.equal(r.json.worktrees.length, 2); assert.deepEqual(r.json.taskBranches, ["task/t1"]);
  assert.match(r.json.problems.join(" "), /1 extra worktree/); assert.match(r.json.problems.join(" "), /task branches with no owner: task\/t1/);
  fs.writeFileSync(path.join(dir, "stray.txt"), "x");
  r = await runOmb(["reconcile", "--project", dir, "--brief"], { env });
  assert.match(r.stdout, /modified or untracked/);
  fs.rmSync(path.join(dir, "stray.txt"));
  git("switch", "-q", "-c", "other");
  r = await runOmb(["reconcile", "--project", dir], { env });
  assert.match(r.json.problems.join(" "), /the root is on other, not main/);
  git("switch", "-q", "main");
  r = await runOmb(["reconcile", "--project", dir, "--remove", "t1"], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.clean, true);
  assert.equal(r.json.removed[0].worktreeRemoved, true); assert.equal(r.json.removed[0].branchDeleted, true);
  assert.equal(fs.existsSync(path.join(dir, ".worktrees", "t1")), false);
  r = await runOmb(["reconcile", "--project", dir, "--remove", "nope"], { env });
  assert.equal(r.code, 3); assert.ok(r.json.removed[0].errors.length >= 1);
  r = await runOmb(["reconcile", "--project", dir, "--remove", "../x"], { env });
  assert.equal(r.code, 2);
  r = await runOmb(["reconcile", "--project", dir, "--check"], { env });
  assert.equal(r.code, 2, "the never-read --check flag is gone"); assert.match(r.json.error, /^Unknown option '--check'/);
  const proc = await import("../skills/openmausbot-launcher/scripts/lib/proc.mjs");
  assert.deepEqual(Object.keys(proc).sort(), ["killOrphan", "scanOrphans"]);
});

test("reconcile matches each worktree to the run that owns it and claims an orphan for a run", async () => {
  const { dir, git } = makeRepo();
  ensureExclude(dir, [".worktrees/", ".omb/"]);
  await updateState(statePaths(dir), (d) => { d.runs.run1 = { runId: "run1", status: "dispatched", slug: "t1", branch: "task/t1", title: "T1", createdAt: "2026-09-16T01:00:00.000Z" }; return d; });
  git("worktree", "add", "-q", "-b", "task/t1", ".worktrees/t1", "main");
  let r = await runOmb(["reconcile", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.clean, true, "the open run's own worktree is not a leftover");
  assert.deepEqual(r.json.openRuns, [{ runId: "run1", slug: "t1", status: "dispatched", branch: "task/t1" }]);
  assert.equal(r.json.worktrees.find((w) => w.slug === "t1").run, "run1");
  assert.equal(r.json.worktrees[0].run, null, "the root belongs to no run");
  git("worktree", "add", "-q", "-b", "task/stray", ".worktrees/stray", "main");
  r = await runOmb(["reconcile", "--project", dir], { env });
  assert.equal(r.code, 3); assert.match(r.json.problems.join(" "), /with no owner/);
  assert.match(r.json.unownedWorktrees.join(" "), /stray/);
  r = await runOmb(["reconcile", "--project", dir, "--claim", "stray", "--dry-run"], { env });
  assert.equal(r.code, 3, "nothing was claimed, so the leftover still has no owner"); assert.equal(r.json.claimed[0].dryRun, true);
  assert.equal(loadState(statePaths(dir)).runs.run1.claimedSlugs, undefined, "a dry run claims nothing");
  r = await runOmb(["reconcile", "--project", dir, "--claim", "stray", "--run", "t1"], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.clean, true);
  assert.deepEqual(loadState(statePaths(dir)).runs.run1.claimedSlugs, ["stray"]);
  assert.equal(r.json.worktrees.find((w) => w.slug === "stray").run, "run1");
  r = await runOmb(["reconcile", "--project", dir, "--claim", "stray", "--run", "t1"], { env });
  assert.equal(r.code, 0, "claiming the same slug for the same run again changes nothing");
  assert.deepEqual(loadState(statePaths(dir)).runs.run1.claimedSlugs, ["stray"]);
  await updateState(statePaths(dir), (d) => { d.runs.run9 = { runId: "run9", status: "dispatched", slug: "t9", title: "T9", createdAt: "2026-09-16T03:00:00.000Z" }; return d; });
  r = await runOmb(["reconcile", "--project", dir, "--claim", "stray", "--run", "t9"], { env });
  assert.equal(r.code, 3, r.stdout); assert.match(r.json.error, /stray already belongs to t1/);
  r = await runOmb(["reconcile", "--project", dir, "--claim", "t1", "--run", "t9"], { env });
  assert.equal(r.code, 3, r.stdout); assert.match(r.json.error, /t1 already belongs to t1/, "a run's own slug is not claimable by another");
  assert.deepEqual(loadState(statePaths(dir)).runs.run9.claimedSlugs, undefined);
  await updateState(statePaths(dir), (d) => { delete d.runs.run9; return d; });
  r = await runOmb(["reconcile", "--project", dir, "--claim", "nothing-here"], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /nothing named nothing-here/);
  await updateState(statePaths(dir), (d) => { d.runs.run2 = { runId: "run2", status: "dispatched", slug: "t2", title: "T2", createdAt: "2026-09-16T02:00:00.000Z" }; return d; });
  r = await runOmb(["reconcile", "--project", dir, "--claim", "stray"], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /2 runs are open; pass --run/);
});

test("reconcile honours the default branch from Project facts", async () => {
  const { dir, git } = makeRepo({ branch: "trunk" });
  await updateState(statePaths(dir), (d) => { d.facts = { defaultBranch: "trunk" }; return d; });
  ensureExclude(dir, [".omb/"]);
  const r = await runOmb(["reconcile", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.defaultBranch, "trunk");
  git("switch", "-q", "-c", "main");
  const r2 = await runOmb(["reconcile", "--project", dir], { env });
  assert.equal(r2.code, 3); assert.match(r2.json.problems[0], /on main, not trunk/);
});

test("cleanup finds a matching process in a deleted worktree, protects the server pids, and kills only on --kill", { skip: !linux && "needs /proc" }, async (t) => {
  const { dir } = makeRepo();
  ensureExclude(dir, [".worktrees/", ".omb/"]);
  const gone = path.join(dir, ".worktrees", "gone");
  fs.mkdirSync(gone, { recursive: true });
  const marker = `oml-orphan-${process.pid}`;
  const orphan = spawn("sh", ["-c", "sleep 300", marker], { cwd: gone, stdio: "ignore" });
  t.after(() => { try { orphan.kill("SIGKILL"); } catch {} });
  const alive = path.join(dir, ".worktrees", "alive"); fs.mkdirSync(alive, { recursive: true });
  const notOrphan = spawn("sh", ["-c", "sleep 300", marker], { cwd: alive, stdio: "ignore" });
  t.after(() => { try { notOrphan.kill("SIGKILL"); } catch {} });
  const elsewhere = spawn("sh", ["-c", "sleep 300", marker], { cwd: dir, stdio: "ignore" });
  t.after(() => { try { elsewhere.kill("SIGKILL"); } catch {} });
  await sleep(150);
  fs.rmSync(gone, { recursive: true, force: true });
  const scan = scanOrphans({ pattern: marker, worktreesDir: path.join(dir, ".worktrees") });
  assert.deepEqual(scan.orphans.map((o) => [o.pid, o.deleted]).sort((a, b) => a[0] - b[0]), [[orphan.pid, true], [notOrphan.pid, false]].sort((a, b) => a[0] - b[0]));
  let r = await runOmb(["cleanup", "--project", dir, "--pattern", marker], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.orphans.length, 2); assert.deepEqual(r.json.killed, []);
  assert.equal(fs.existsSync(`/proc/${orphan.pid}`), true, "no --kill, nothing signalled");
  await updateState(statePaths(dir), (d) => { d.server = { url: "http://127.0.0.1:1", owned: true, supervisorPid: orphan.pid, healthPid: 1 }; return d; });
  r = await runOmb(["cleanup", "--project", dir, "--pattern", marker, "--kill"], { env });
  assert.equal(r.json.orphans.some((o) => o.pid === orphan.pid), false, "a recorded server pid is never a candidate");
  assert.equal(fs.existsSync(`/proc/${orphan.pid}`), true);
  await updateState(statePaths(dir), (d) => { d.server = null; return d; });
  r = await runOmb(["cleanup", "--project", dir, "--pattern", marker, "--kill", "--dry-run"], { env });
  assert.equal(r.json.killed.find((k) => k.pid === orphan.pid).why, "dry run");
  r = await runOmb(["cleanup", "--project", dir, "--pattern", marker, "--kill"], { env });
  assert.equal(r.code, 0, r.stdout);
  const k = Object.fromEntries(r.json.killed.map((x) => [x.pid, x]));
  assert.equal(k[orphan.pid].killed, true, r.stdout); assert.equal(k[notOrphan.pid].killed, false); assert.match(k[notOrphan.pid].why, /still exists/);
  await sleep(100);
  assert.equal(fs.existsSync(`/proc/${orphan.pid}`) && fs.readFileSync(`/proc/${orphan.pid}/stat`, "utf8").split(") ")[1][0] !== "Z", false, "the orphan is gone");
  assert.equal(fs.existsSync(`/proc/${notOrphan.pid}`), true); assert.equal(fs.existsSync(`/proc/${elsewhere.pid}`), true);
});

test("cleanup treats a live directory literally named (deleted) as live", { skip: !linux }, async (t) => {
  const { dir } = makeRepo(); const worktreesDir = path.join(dir, ".worktrees");
  const cwd = path.join(worktreesDir, "literal (deleted)"); fs.mkdirSync(cwd, { recursive: true });
  const marker = `oml-literal-${process.pid}`;
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", marker], { cwd, stdio: "ignore" });
  t.after(() => child.kill("SIGKILL")); await sleep(100);
  const scan = scanOrphans({ pattern: marker, worktreesDir });
  const rec = scan.orphans.find((o) => o.pid === child.pid);
  assert.equal(rec.cwd, cwd); assert.equal(rec.deleted, false);
});

test("cleanup observes process exit even when its cwd disappears while SIGTERM takes effect", { skip: !linux }, async (t) => {
  const { killOrphan } = await import("../skills/openmausbot-launcher/scripts/lib/proc.mjs");
  const { procInfo } = await import("../skills/openmausbot-launcher/scripts/lib/server.mjs");
  const { dir } = makeRepo(); const worktreesDir = path.join(dir, ".worktrees");
  const cwd = path.join(worktreesDir, "exiting"); fs.mkdirSync(cwd, { recursive: true });
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => setTimeout(() => process.exit(0), 50)); process.send('ready'); setInterval(() => {}, 1000)"], { cwd, stdio: ["ignore", "ignore", "ignore", "ipc"] });
  t.after(() => child.kill("SIGKILL")); await new Promise((resolve) => child.once("message", resolve));
  const record = { pid: child.pid, startTicks: procInfo(child.pid).startTicks, cwd, deleted: true };
  fs.rmdirSync(cwd);
  const readlink = fs.readlinkSync; let reads = 0;
  t.mock.method(fs, "readlinkSync", (file, ...args) => {
    if (file === `/proc/${child.pid}/cwd` && ++reads > 2) throw Object.assign(new Error("cwd vanished during exit"), { code: "ENOENT" });
    return readlink(file, ...args);
  });
  const result = await killOrphan(record, { worktreesDir, graceMs: 500 });
  assert.equal(result.killed, true, JSON.stringify(result)); assert.equal(result.signal, "SIGTERM");
});

test("killOrphan rechecks cwd before the first signal", { skip: !linux }, async (t) => {
  const { killOrphan } = await import("../skills/openmausbot-launcher/scripts/lib/proc.mjs");
  const { procInfo } = await import("../skills/openmausbot-launcher/scripts/lib/server.mjs");
  const { dir } = makeRepo(); const worktreesDir = path.join(dir, ".worktrees");
  const cwd = path.join(worktreesDir, "live"); fs.mkdirSync(cwd, { recursive: true });
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd, stdio: "ignore" });
  t.after(() => child.kill("SIGKILL")); await sleep(100);
  const result = await killOrphan({ pid: child.pid, startTicks: procInfo(child.pid).startTicks, cwd: path.join(worktreesDir, "other"), deleted: true }, { worktreesDir, graceMs: 50 });
  assert.equal(result.killed, false); assert.match(result.why, /cwd/); assert.equal(procInfo(child.pid)?.alive, true);
});

test("a process that changes cwd after SIGTERM is not escalated or reported dead", { skip: !linux }, async (t) => {
  const { killOrphan } = await import("../skills/openmausbot-launcher/scripts/lib/proc.mjs");
  const { procInfo } = await import("../skills/openmausbot-launcher/scripts/lib/server.mjs");
  const { dir } = makeRepo(); const worktreesDir = path.join(dir, ".worktrees");
  const cwd = path.join(worktreesDir, "gone"); fs.mkdirSync(cwd, { recursive: true });
  const ready = path.join(dir, "ready");
  const child = spawn(process.execPath, ["-e", `require('node:fs').writeFileSync(${JSON.stringify(ready)}, 'ready'); process.on('SIGTERM', () => process.chdir(${JSON.stringify(dir)})); setInterval(() => {}, 1000);`], { cwd, stdio: "ignore" });
  t.after(() => child.kill("SIGKILL"));
  const until = Date.now() + 2000; while (!fs.existsSync(ready) && Date.now() < until) await sleep(10);
  assert.ok(fs.existsSync(ready)); fs.rmdirSync(cwd);
  const result = await killOrphan({ pid: child.pid, startTicks: procInfo(child.pid).startTicks, cwd, deleted: true }, { worktreesDir, graceMs: 100 });
  assert.equal(result.killed, false); assert.match(result.why, /cwd/); assert.equal(procInfo(child.pid)?.alive, true);
});

test("reconcile names where the default branch came from and hints when it is only the current branch", async () => {
  const { dir } = makeRepo({ branch: "trunk" });
  ensureExclude(dir, [".omb/"]);
  const r = await runOmb(["reconcile", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.defaultBranch, "trunk"); assert.equal(r.json.defaultBranchSource, "current");
  assert.equal(r.json.hint, "the default branch trunk is inferred from the current branch (no Project facts, origin/HEAD, main, or master): record it with facts --default-branch trunk");
  assert.deepEqual(defaultBranchInfo(dir, { defaultBranch: "trunk" }), { branch: "trunk", source: "facts" });
  const { dir: main } = makeRepo();
  assert.deepEqual(defaultBranchInfo(main, null), { branch: "main", source: "main" });
  const plain = await runOmb(["reconcile", "--project", main], { env });
  assert.equal(plain.json.defaultBranchSource, "main"); assert.equal(plain.json.hint, undefined);
});
