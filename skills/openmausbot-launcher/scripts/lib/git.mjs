// Git helpers: reconcile checks and task worktree removal.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** Run git and return trimmed stdout; throws with stderr on failure. */
export function git(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }).trim();
  } catch (e) {
    const err = new Error(`git ${args.join(" ")}: ${(e.stderr || e.message || "").toString().trim()}`);
    err.status = e.status; throw err;
  }
}

export function gitTopLevel(cwd) {
  try { return git(["rev-parse", "--show-toplevel"], cwd); } catch { return null; }
}

/** Where git keeps `rel` for this checkout, absolute. A linked worktree's `.git` is a gitfile and shared files such as info/exclude live under the main repository; `--git-path` answers relative to cwd (git 2.43). Null when git fails. */
export function gitPath(cwd, rel) {
  try { return path.resolve(cwd, git(["rev-parse", "--git-path", rel], cwd)); } catch { return null; }
}

export function gitAvailable() {
  try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
}

export function currentBranch(cwd) { return git(["branch", "--show-current"], cwd); }

/** The project's default branch and where it came from: Project facts, origin/HEAD, an existing main or master, or, as a last resort, the current branch. */
export function defaultBranchInfo(cwd, facts) {
  if (facts?.defaultBranch) return { branch: facts.defaultBranch, source: "facts" };
  try { const ref = git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd); if (ref) return { branch: ref.replace(/^origin\//, ""), source: "origin" }; } catch {}
  for (const b of ["main", "master"]) { try { git(["rev-parse", "--verify", "--quiet", `refs/heads/${b}`], cwd); return { branch: b, source: b }; } catch {} }
  return { branch: currentBranch(cwd) || "main", source: "current" };
}
export function defaultBranch(cwd, facts) { return defaultBranchInfo(cwd, facts).branch; }

export function worktrees(cwd) {
  const out = git(["worktree", "list", "--porcelain"], cwd);
  const list = []; let cur = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) { cur = { path: line.slice(9), head: null, branch: null }; list.push(cur); }
    else if (cur && line.startsWith("HEAD ")) cur.head = line.slice(5);
    else if (cur && line.startsWith("branch ")) cur.branch = line.slice(7).replace(/^refs\/heads\//, "");
  }
  return list;
}

export function taskBranches(cwd, prefix = "task/") {
  const out = git(["branch", "--list", `${prefix}*`, "--format=%(refname:short)"], cwd);
  return out ? out.split("\n").filter(Boolean) : [];
}

export function dirtyEntries(cwd) {
  const out = git(["--no-optional-locks", "status", "--porcelain", "--untracked-files=normal"], cwd);
  return out ? out.split("\n").filter(Boolean) : [];
}

/**
 * The root check the lead's playbook uses between tasks. A run owns
 * `.worktrees/<slug>` on `task/<slug>` for as long as it is open, so with
 * `runs` passed in, those are not leftovers; anything else in `.worktrees/` or
 * on a `task/` branch has no owner and blocks the next dispatch.
 */
export function reconcileCheck(cwd, facts, { runs = [] } = {}) {
  const branch = currentBranch(cwd);
  const { branch: def, source } = defaultBranchInfo(cwd, facts);
  const branches = taskBranches(cwd);
  const dirty = dirtyEntries(cwd);
  // A run owns one exact pair: `.worktrees/<slug>` checked out on its branch.
  // Matching the name alone would adopt a worktree of the same name somewhere
  // else, or one in the right place on a different branch, and call a malformed
  // leftover clean.
  const owner = new Map();
  for (const run of runs) {
    const pairs = [[run.slug, run.branch ?? (run.slug ? `task/${run.slug}` : null)], ...(run.claimedSlugs ?? []).map((s) => [s, `task/${s}`])];
    for (const [slug, branch] of pairs) if (slug && branch && !owner.has(slug)) owner.set(slug, { run, branch });
  }
  const expectedPath = (slug) => {
    const p = path.join(cwd, ".worktrees", slug);
    try { return [p, fs.realpathSync(p)]; } catch { return [p]; }
  };
  const ownerOf = (t) => {
    const slug = path.basename(t.path);
    const want = owner.get(slug);
    if (!want || t.branch !== want.branch) return null;
    return expectedPath(slug).includes(t.path) ? want.run.runId : null;
  };
  const trees = worktrees(cwd).map((t, i) => (i === 0 ? { ...t, slug: null, run: null } : { ...t, slug: path.basename(t.path), run: ownerOf(t) }));
  const owned = new Set(trees.filter((t) => t.run).map((t) => t.branch));
  const unownedWorktrees = trees.slice(1).filter((t) => !t.run).map((t) => t.path);
  const unownedBranches = branches.filter((b) => !owned.has(b));
  const problems = [];
  if (branch !== def) problems.push(`the root is on ${branch || "a detached HEAD"}, not ${def}`);
  if (unownedWorktrees.length) problems.push(`${unownedWorktrees.length} extra worktree(s) with no owner: ${unownedWorktrees.join(", ")}`);
  if (unownedBranches.length) problems.push(`task branches with no owner: ${unownedBranches.join(", ")}`);
  if (dirty.length) problems.push(`${dirty.length} modified or untracked path(s)`);
  return { clean: problems.length === 0, branch, defaultBranch: def, defaultBranchSource: source, worktrees: trees, taskBranches: branches, dirty, problems, unownedWorktrees, unownedBranches };
}

/** Does this repository already have the worktree or the branch a slug names? */
export function slugTaken(cwd, slug) {
  const taken = [];
  if (worktrees(cwd).some((t) => path.basename(t.path) === slug)) taken.push(`.worktrees/${slug}`);
  if (taskBranches(cwd).includes(`task/${slug}`)) taken.push(`task/${slug}`);
  return taken;
}

/** Remove one task worktree and its branch, never with --force on the worktree. */
export function removeTask(cwd, slug) {
  const result = { slug, worktreeRemoved: false, branchDeleted: false, errors: [] };
  const wt = `.worktrees/${slug}`;
  try { git(["worktree", "remove", wt], cwd); result.worktreeRemoved = true; } catch (e) { result.errors.push(e.message); }
  try { git(["branch", "-D", `task/${slug}`], cwd); result.branchDeleted = true; } catch (e) { result.errors.push(e.message); }
  return result;
}
