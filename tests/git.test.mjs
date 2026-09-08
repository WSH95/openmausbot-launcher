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
  assert.deepEqual({ ...c, worktrees: c.worktrees.map((w) => w.branch) }, { clean: true, branch: "main", defaultBranch: "main", defaultBranchSource: "main", worktrees: ["main"], taskBranches: [], dirty: [], problems: [] });
  git("worktree", "add", "-q", "-b", "task/t1", ".worktrees/t1", "main");
  fs.writeFileSync(path.join(dir, "stray.txt"), "x");
  git("switch", "-q", "-c", "other");
  c = reconcileCheck(dir, { defaultBranch: "main" });
  assert.equal(c.clean, false); assert.equal(c.branch, "other"); assert.deepEqual(c.taskBranches, ["task/t1"]); assert.deepEqual(c.dirty, ["?? stray.txt"]);
  assert.equal(c.worktrees.length, 2); assert.equal(c.worktrees[1].path, fs.realpathSync(path.join(dir, ".worktrees", "t1"))); assert.equal(c.worktrees[1].branch, "task/t1"); assert.match(c.worktrees[1].head, /^[0-9a-f]{40}$/);
  assert.deepEqual(c.problems, ["the root is on other, not main", `1 extra worktree(s): ${c.worktrees[1].path}`, "task branches remain: task/t1", "1 modified or untracked path(s)"]);
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
