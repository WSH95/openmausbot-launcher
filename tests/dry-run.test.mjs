import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startFake, makeRepo, runOmb, ROOT, FAKE } from "./helpers.mjs";
import { statePaths, loadState, updateState, ensureExclude } from "../skills/openmausbot-launcher/scripts/lib/state.mjs";

const PKG = path.join(ROOT, "tests/fixtures/dev-team.package.json");
async function setup(t) {
  const f = await startFake(); t.after(() => f.close());
  const { dir, git } = makeRepo();
  const env = { OMB_TOKEN: "", OMB_DATA_DIR: f.dataDir, OMB_BIN: FAKE };
  const run = (args) => runOmb([...args, "--project", dir], { env });
  assert.equal((await run(["import", PKG, "--url", f.url])).code, 0);
  assert.equal((await run(["bind", "--default", "claude/claude-sonnet-5"])).code, 0);
  assert.equal((await run(["facts", "--test", "node -e \"require('node:fs').writeFileSync('tests-executed', 'bad')\""])).code, 0);
  const paths = statePaths(dir);
  const mutations = [];
  f.server.on("request", (req) => { if (req.method !== "GET" && !req.url.startsWith("/__fake")) mutations.push(`${req.method} ${req.url}`); });
  return { f, dir, git, paths, env, run, mutations };
}

test("reconcile --remove --dry-run preserves the worktree and task branch", async () => {
  const { dir, git } = makeRepo(); ensureExclude(dir, [".worktrees/", ".omb/"]);
  git("worktree", "add", "-q", "-b", "task/t1", ".worktrees/t1", "main");
  const r = await runOmb(["reconcile", "--project", dir, "--remove", "t1", "--dry-run"], { env: { OMB_TOKEN: "" } });
  assert.equal(fs.existsSync(path.join(dir, ".worktrees/t1")), true);
  assert.deepEqual(r.json.taskBranches, ["task/t1"]);
  assert.equal(r.json.removed[0].dryRun, true);
});

test("a reconcile preview never refreshes the Git index after a metadata-only touch", async () => {
  const { dir } = makeRepo();
  const index = path.join(dir, ".git", "index");
  const before = fs.readFileSync(index);
  const later = new Date(Date.now() + 2000);
  fs.utimesSync(path.join(dir, "README.md"), later, later);
  const r = await runOmb(["reconcile", "--project", dir, "--dry-run"], { env: { OMB_TOKEN: "" } });
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(fs.readFileSync(index), before);
});

test("import --adopt --dry-run leaves an uninitialized project untouched", async (t) => {
  const { f, mutations, env } = await setup(t);
  const { dir } = makeRepo();
  const r = await runOmb(["import", "--adopt", "Sudo", "--project", dir, "--url", f.url, "--dry-run"], { env });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(loadState(statePaths(dir)), null);
  assert.equal(fs.existsSync(statePaths(dir).dir), false);
  assert.deepEqual(mutations, []);
});

test("up --dry-run previews attachment without creating state or a lock database", async (t) => {
  const f = await startFake(); t.after(() => f.close()); const { dir } = makeRepo();
  const r = await runOmb(["up", "--project", dir, "--port", String(f.port), "--data-dir", f.dataDir, "--dry-run"], { env: { OMB_TOKEN: "", OMB_BIN: FAKE } });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.dryRun, true);
  assert.equal(fs.existsSync(statePaths(dir).dir), false);
});

test("task --resume --dry-run does not create threads or mark a preparing run dispatched", async (t) => {
  const { run, paths, mutations } = await setup(t);
  await updateState(paths, (d) => { d.task = { runId: "1234567890abcdef", status: "preparing", slug: "t1", title: "T1", tag: "oml:12345678", brief: "Do T1", sendId: "task-1234567890abcdef", sentAt: null, sentSha: "x", threads: {}, freshThreads: true, leadThreadId: null }; });
  const before = fs.readFileSync(paths.file, "utf8");
  const r = await run(["task", "--resume", "--dry-run"]);
  assert.equal(r.code, 0, r.stdout);
  assert.equal(fs.readFileSync(paths.file, "utf8"), before);
  assert.deepEqual(mutations, []);
});

test("watch --dry-run --nudge neither checkpoints nor sends", async (t) => {
  const { run, paths, mutations } = await setup(t);
  const task = await run(["task", "--todo", "T1"]); assert.equal(task.code, 0, task.stdout);
  mutations.length = 0;
  const before = fs.readFileSync(paths.file, "utf8");
  const r = await run(["watch", "--dry-run", "--nudge", "--max-seconds", "0.1", "--stall-minutes", "0"]);
  assert.equal(r.json.checkpointed, false, r.stdout);
  assert.equal(fs.readFileSync(paths.file, "utf8"), before);
  assert.deepEqual(mutations, []);
});

test("report --dry-run never executes the project test command or closes the run", async (t) => {
  const { run, dir, paths, mutations } = await setup(t);
  assert.equal((await run(["task", "--todo", "T1"])).code, 0);
  mutations.length = 0;
  const before = fs.readFileSync(paths.file, "utf8");
  const r = await run(["report", "--dry-run", "--close"]);
  assert.equal(r.code, 0, r.stdout);
  assert.equal(fs.existsSync(path.join(dir, "tests-executed")), false);
  assert.equal(r.json.tests.ran, false);
  assert.equal(fs.readFileSync(paths.file, "utf8"), before);
  assert.deepEqual(mutations, []);
});

test("bind, facts, send, answer and interrupt previews issue no mutations", async (t) => {
  const { run, f, paths, mutations } = await setup(t);
  const task = await run(["task", "--todo", "T1"]); assert.equal(task.code, 0, task.stdout);
  await f.control({ op: "card", threadId: task.json.leadThreadId, requestId: "dry-approval", kind: "approval" });
  mutations.length = 0;
  const before = fs.readFileSync(paths.file, "utf8");
  for (const args of [["bind", "--default", "codex/gpt-6-astra/high"], ["facts", "--test", "false"], ["send", "hello"], ["answer", "--allow", "--request", "dry-approval"], ["interrupt"]]) {
    const r = await run([...args, "--dry-run"]);
    assert.equal(r.code, 0, r.stdout);
    assert.equal(fs.readFileSync(paths.file, "utf8"), before);
  }
  assert.deepEqual(mutations, []);
});
