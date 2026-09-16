import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { makeRepo, tmpDir } from "./helpers.mjs";
import { defaultBranch, defaultBranchInfo, gitPath, reconcileCheck, removeTask, worktrees, taskBranches } from "../skills/openmausbot-launcher/scripts/lib/git.mjs";

const gitIn = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).toString().trim();

test("defaultBranch: Project facts, then origin/HEAD, then main or master, then the current branch", () => {
  const { dir } = makeRepo({ branch: "trunk" });
  assert.equal(defaultBranch(dir, { defaultBranch: "release" }), "release");
  const bare = path.join(tmpDir("oml-git-bare-"), "origin.git");
  gitIn(path.dirname(bare), "clone", "-q", "--bare", dir, bare);
  const clone = path.join(tmpDir("oml-git-clone-"), "clone");
  gitIn(path.dirname(clone), "clone", "-q", bare, clone);
  gitIn(clone, "branch", "main");
  assert.equal(gitIn(clone, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"), "origin/trunk");
  assert.equal(defaultBranch(clone, null), "trunk", "origin/HEAD beats a local main");
  assert.equal(defaultBranch(makeRepo().dir, null), "main");
  assert.equal(defaultBranch(makeRepo({ branch: "master" }).dir, null), "master");
  assert.equal(defaultBranch(makeRepo({ branch: "dev" }).dir, null), "dev", "no remote and no main or master: the current branch");
  assert.deepEqual(defaultBranchInfo(dir, { defaultBranch: "release" }), { branch: "release", source: "facts" });
  assert.deepEqual(defaultBranchInfo(clone, null), { branch: "trunk", source: "origin" });
  assert.deepEqual(defaultBranchInfo(makeRepo().dir, null), { branch: "main", source: "main" });
  assert.deepEqual(defaultBranchInfo(makeRepo({ branch: "master" }).dir, null), { branch: "master", source: "master" });
  assert.deepEqual(defaultBranchInfo(makeRepo({ branch: "dev" }).dir, null), { branch: "dev", source: "current" });
  assert.equal(gitPath(dir, "info/exclude"), path.join(dir, ".git", "info", "exclude"));
  assert.equal(gitPath(clone, "HEAD"), path.join(clone, ".git", "HEAD"));
});

test("reconcileCheck reports the branch, the default branch, worktrees, task branches, dirty paths, and problems", () => {
  const { dir, git } = makeRepo();
  fs.appendFileSync(path.join(dir, ".git", "info", "exclude"), ".worktrees/\n");
  let c = reconcileCheck(dir, null);
  assert.deepEqual({ ...c, worktrees: c.worktrees.map((w) => w.branch) }, { clean: true, branch: "main", defaultBranch: "main", defaultBranchSource: "main", worktrees: ["main"], taskBranches: [], dirty: [], problems: [], unownedWorktrees: [], unownedBranches: [] });
  git("worktree", "add", "-q", "-b", "task/t1", ".worktrees/t1", "main");
  fs.writeFileSync(path.join(dir, "stray.txt"), "x");
  git("switch", "-q", "-c", "other");
  c = reconcileCheck(dir, { defaultBranch: "main" });
  assert.equal(c.clean, false); assert.equal(c.branch, "other"); assert.deepEqual(c.taskBranches, ["task/t1"]); assert.deepEqual(c.dirty, ["?? stray.txt"]);
  assert.equal(c.worktrees.length, 2); assert.equal(c.worktrees[1].path, fs.realpathSync(path.join(dir, ".worktrees", "t1"))); assert.equal(c.worktrees[1].branch, "task/t1"); assert.match(c.worktrees[1].head, /^[0-9a-f]{40}$/);
  assert.deepEqual(c.problems, ["the root is on other, not main", `1 extra worktree(s) with no owner: ${c.worktrees[1].path}`, "task branches with no owner: task/t1", "1 modified or untracked path(s)"]);
  assert.equal(c.worktrees[1].slug, "t1"); assert.equal(c.worktrees[1].run, null);
  assert.deepEqual(c.unownedWorktrees, [c.worktrees[1].path]); assert.deepEqual(c.unownedBranches, ["task/t1"]);
});

test("a worktree and a branch an open run owns by name are not problems; anything else still is", () => {
  const { dir, git } = makeRepo();
  fs.appendFileSync(path.join(dir, ".git", "info", "exclude"), ".worktrees/\n");
  git("worktree", "add", "-q", "-b", "task/t1", ".worktrees/t1", "main");
  git("worktree", "add", "-q", "-b", "task/t2", ".worktrees/t2", "main");
  const runs = [{ runId: "run1", slug: "t1", branch: "task/t1", status: "dispatched" }];
  let c = reconcileCheck(dir, null, { runs });
  assert.equal(c.clean, false, "t2 belongs to nobody");
  assert.deepEqual(c.unownedWorktrees, [c.worktrees.find((w) => w.slug === "t2").path]);
  assert.deepEqual(c.unownedBranches, ["task/t2"]);
  assert.equal(c.worktrees.find((w) => w.slug === "t1").run, "run1");
  assert.deepEqual(c.taskBranches, ["task/t1", "task/t2"], "the raw list still names every task branch");
  c = reconcileCheck(dir, null, { runs: [...runs, { runId: "run2", slug: "other", claimedSlugs: ["t2"], status: "dispatched" }] });
  assert.equal(c.clean, true, "a claimed slug is owned");
  assert.equal(c.worktrees.find((w) => w.slug === "t2").run, "run2");
  assert.equal(reconcileCheck(dir, null).clean, false, "with no runs to match, both are unowned again");
});

test("a run owns the exact pair .worktrees/<slug> on task/<slug>, and nothing that merely looks like it", () => {
  const { dir, git } = makeRepo();
  fs.appendFileSync(path.join(dir, ".git", "info", "exclude"), ".worktrees/\n");
  git("worktree", "add", "-q", "-b", "task/t1", ".worktrees/t1", "main");
  const elsewhere = path.join(tmpDir("oml-wt-elsewhere-"), "t2");
  git("worktree", "add", "-q", "-b", "task/t2", elsewhere, "main");
  git("worktree", "add", "-q", "-b", "wip/t3", ".worktrees/t3", "main");
  const runs = [{ runId: "r1", slug: "t1", branch: "task/t1", status: "dispatched" },
    { runId: "r2", slug: "t2", branch: "task/t2", status: "dispatched" },
    { runId: "r3", slug: "t3", branch: "task/t3", status: "dispatched" }];
  const c = reconcileCheck(dir, null, { runs });
  const byName = (slug) => c.worktrees.find((w) => w.slug === slug);
  assert.equal(byName("t1").run, "r1");
  assert.equal(byName("t2").run, null, "the right name in the wrong place is not this run's worktree");
  assert.equal(byName("t3").run, null, "the right place on the wrong branch is not either");
  assert.deepEqual(c.unownedWorktrees.map((p) => path.basename(p)).sort(), ["t2", "t3"]);
  assert.deepEqual(c.unownedBranches, ["task/t2"], "the branch a run recorded is only its own where its worktree is");
  assert.equal(c.clean, false);
  assert.match(c.problems.join(" "), /with no owner/);
});

test("removeTask never forces: a worktree holding an untracked file and its checked-out branch both survive", () => {
  const { dir, git } = makeRepo();
  fs.appendFileSync(path.join(dir, ".git", "info", "exclude"), ".worktrees/\n");
  git("worktree", "add", "-q", "-b", "task/t2", ".worktrees/t2", "main");
  fs.writeFileSync(path.join(dir, ".worktrees", "t2", "scratch.txt"), "keep me\n");
  const r = removeTask(dir, "t2");
  assert.deepEqual([r.worktreeRemoved, r.branchDeleted], [false, false]);
  assert.equal(r.errors.length, 2); assert.match(r.errors[0], /modified or untracked files, use --force/); assert.match(r.errors[1], /used by worktree|checked out/);
  assert.equal(fs.existsSync(path.join(dir, ".worktrees", "t2", "scratch.txt")), true);
  fs.rmSync(path.join(dir, ".worktrees", "t2", "scratch.txt"));
  assert.deepEqual(removeTask(dir, "t2"), { slug: "t2", worktreeRemoved: true, branchDeleted: true, errors: [] });
  assert.deepEqual(taskBranches(dir), []); assert.equal(worktrees(dir).length, 1);
});
