// reconcile and cleanup (design: the verb table; lib/git.mjs, lib/proc.mjs).
import path from "node:path";
import { verb, EXIT, Fail, VERBS } from "../cli.mjs";
import { resolveConfig } from "../config.mjs";
import { reconcileCheck, removeTask } from "../git.mjs";
import { loadState, updateState, assertOpenRun } from "../state.mjs";
import { openRuns, selectRun, runLabel } from "../runs.mjs";
import { scanOrphans, killOrphan } from "../proc.mjs";

export const DEFAULT_ORPHAN_PATTERN = "codex-linux-sandbox";

verb("reconcile", {
  options: { remove: { type: "string", multiple: true }, claim: { type: "string", multiple: true }, run: { type: "string" } },
  handler: async ({ flags }) => {
    const cfg = resolveConfig(flags);
    if (cfg.mode === "remote") throw new Fail(EXIT.PRECONDITION, "reconcile needs the project checkout", { hint: "run it on the machine that has the repository" });
    const removed = [];
    for (const slug of flags.remove ?? []) {
      if (!/^[\w.-]+$/.test(slug)) throw new Fail(EXIT.USAGE, `bad slug ${slug}`);
      removed.push(cfg.dryRun ? { slug, dryRun: true, worktreeRemoved: false, branchDeleted: false, errors: [] } : removeTask(cfg.projectDir, slug));
    }
    // A worktree or branch nobody owns blocks the next dispatch. Either it goes
    // (--remove) or an open run answers for it (--claim), which is what the
    // lead's own `git worktree add` under another name leaves behind.
    const claimed = [];
    for (const slug of flags.claim ?? []) {
      if (!/^[\w.-]+$/.test(slug)) throw new Fail(EXIT.USAGE, `bad slug ${slug}`);
      const present = reconcileCheck(cfg.projectDir, cfg.state?.facts);
      if (!present.worktrees.some((w) => w.slug === slug) && !present.taskBranches.includes(`task/${slug}`)) {
        throw new Fail(EXIT.PRECONDITION, `nothing named ${slug} to claim`, { hint: `no .worktrees/${slug} and no task/${slug} in this repository` });
      }
      const run = selectRun(cfg.state, flags.run);
      if (cfg.dryRun) { claimed.push({ slug, run: run.runId, dryRun: true }); continue; }
      await updateState(cfg.paths, (d) => {
        const live = assertOpenRun(d, run.runId);
        // One owner per slug: two runs answering for one worktree is how
        // ownership flips when the first of them closes.
        const held = openRuns(d).find((r) => r.runId !== run.runId && (r.slug === slug || (r.claimedSlugs ?? []).includes(slug)));
        if (held) throw new Fail(EXIT.PRECONDITION, `${slug} already belongs to ${runLabel(held)}`, { hint: "a slug has one owner: remove it with --remove, or claim it for that run" });
        if (live.slug !== slug && !(live.claimedSlugs ?? []).includes(slug)) live.claimedSlugs = [...(live.claimedSlugs ?? []), slug];
        return d;
      });
      cfg.state = loadState(cfg.paths);
      claimed.push({ slug, run: run.runId });
    }
    const runs = openRuns(cfg.state);
    const check = reconcileCheck(cfg.projectDir, cfg.state?.facts, { runs });
    const errors = removed.flatMap((r) => r.errors);
    const code = check.clean && errors.length === 0 ? EXIT.OK : EXIT.PRECONDITION;
    const hints = [
      check.clean ? null : "the lead cleans up after its gate; a stopped task keeps its worktree until you pass --remove <slug>",
      check.unownedWorktrees?.length || check.unownedBranches?.length ? "a leftover an open run should answer for is claimed with --claim <slug> --run <ref>" : null,
      check.defaultBranchSource === "current" ? `the default branch ${check.defaultBranch} is inferred from the current branch (no Project facts, origin/HEAD, main, or master): record it with facts --default-branch ${check.defaultBranch}` : null,
    ].filter(Boolean);
    return {
      code, ok: code === EXIT.OK,
      result: { ...check, openRuns: runs.map((r) => ({ runId: r.runId, slug: r.slug ?? null, status: r.status, branch: r.branch ?? null })), dryRun: cfg.dryRun, removed, claimed, hint: hints.length ? hints.join("; ") : undefined },
      brief: `reconcile · ${check.clean ? "clean" : check.problems.join("; ")}${runs.length ? ` · ${runs.length} open run(s)` : ""}${removed.length ? ` · ${cfg.dryRun ? "would remove" : "removed"} ${removed.map((r) => r.slug).join(", ")}` : ""}${claimed.length ? ` · ${cfg.dryRun ? "would claim" : "claimed"} ${claimed.map((c) => c.slug).join(", ")}` : ""}`,
    };
  },
});

verb("cleanup", {
  options: { kill: { type: "boolean" }, pattern: { type: "string" }, down: { type: "boolean" } },
  handler: async ({ flags }) => {
    const cfg = resolveConfig(flags);
    if (cfg.mode === "remote") throw new Fail(EXIT.PRECONDITION, "cleanup needs the project machine");
    let down = null;
    if (flags.down) {
      const out = await VERBS.get("down").handler({ flags: { ...flags, down: undefined }, positionals: [], verb: "down" });
      down = out.result;
    }
    const server = cfg.state?.server;
    const protectPids = [server?.supervisorPid, server?.healthPid].filter(Number.isInteger);
    const scan = scanOrphans({ pattern: flags.pattern ?? DEFAULT_ORPHAN_PATTERN, worktreesDir: path.join(cfg.projectDir, ".worktrees"), protectPids });
    const killed = [];
    if (flags.kill && scan.supported) {
      for (const o of scan.orphans) {
        if (!o.deleted) { killed.push({ pid: o.pid, killed: false, why: "its worktree still exists" }); continue; }
        if (cfg.dryRun) { killed.push({ pid: o.pid, killed: false, why: "dry run" }); continue; }
        killed.push(await killOrphan(o, { worktreesDir: path.join(cfg.projectDir, ".worktrees"), protectPids: () => { const current = loadState(cfg.paths)?.server; return [current?.supervisorPid, current?.healthPid].filter(Number.isInteger); } }));
      }
    }
    const check = reconcileCheck(cfg.projectDir, cfg.state?.facts, { runs: openRuns(cfg.state) });
    return {
      result: { supported: scan.supported, pattern: flags.pattern ?? DEFAULT_ORPHAN_PATTERN, orphans: scan.orphans, killed, reconcile: check, down },
      brief: `cleanup · ${scan.orphans.length} orphan(s)${flags.kill ? `, ${killed.filter((k) => k.killed).length} killed` : ""} · ${check.clean ? "root clean" : check.problems.join("; ")}`,
    };
  },
});
