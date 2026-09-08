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
