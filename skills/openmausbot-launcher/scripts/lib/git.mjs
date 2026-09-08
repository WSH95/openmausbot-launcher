// Git helpers (extended in step 5 with reconcile and cleanup).
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

export function gitAvailable() {
  try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
}

export function currentBranch(cwd) { return git(["branch", "--show-current"], cwd); }

/** The project's default branch: Project facts first, then origin/HEAD, then main or master if they exist. */
export function defaultBranch(cwd, facts) {
  if (facts?.defaultBranch) return facts.defaultBranch;
  try { const ref = git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd); if (ref) return ref.replace(/^origin\//, ""); } catch {}
  for (const b of ["main", "master"]) { try { git(["rev-parse", "--verify", "--quiet", `refs/heads/${b}`], cwd); return b; } catch {} }
  return currentBranch(cwd) || "main";
}

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

/** The root check the lead's playbook uses between tasks. */
export function reconcileCheck(cwd, facts) {
  const branch = currentBranch(cwd);
  const def = defaultBranch(cwd, facts);
  const trees = worktrees(cwd);
  const branches = taskBranches(cwd);
  const dirty = dirtyEntries(cwd);
  const problems = [];
  if (branch !== def) problems.push(`the root is on ${branch || "a detached HEAD"}, not ${def}`);
  if (trees.length !== 1) problems.push(`${trees.length - 1} extra worktree(s): ${trees.slice(1).map((t) => t.path).join(", ")}`);
  if (branches.length) problems.push(`task branches remain: ${branches.join(", ")}`);
  if (dirty.length) problems.push(`${dirty.length} modified or untracked path(s)`);
  return { clean: problems.length === 0, branch, defaultBranch: def, worktrees: trees, taskBranches: branches, dirty, problems };
}

/** Remove one task worktree and its branch, never with --force on the worktree. */
export function removeTask(cwd, slug) {
  const result = { slug, worktreeRemoved: false, branchDeleted: false, errors: [] };
  const wt = `.worktrees/${slug}`;
  try { git(["worktree", "remove", wt], cwd); result.worktreeRemoved = true; } catch (e) { result.errors.push(e.message); }
  try { git(["branch", "-D", `task/${slug}`], cwd); result.branchDeleted = true; } catch (e) { result.errors.push(e.message); }
  return result;
}
