// reconcile and cleanup (design: the verb table; lib/git.mjs, lib/proc.mjs).
import path from "node:path";
import { verb, EXIT, Fail, VERBS } from "../cli.mjs";
import { resolveConfig } from "../config.mjs";
import { reconcileCheck, removeTask } from "../git.mjs";
import { scanOrphans, killOrphan } from "../proc.mjs";

export const DEFAULT_ORPHAN_PATTERN = "codex-linux-sandbox";

verb("reconcile", {
  options: { check: { type: "boolean" }, remove: { type: "string", multiple: true } },
  handler: async ({ flags }) => {
    const cfg = resolveConfig(flags);
    if (cfg.mode === "remote") throw new Fail(EXIT.PRECONDITION, "reconcile needs the project checkout", { hint: "run it on the machine that has the repository" });
    const removed = [];
    for (const slug of flags.remove ?? []) {
      if (!/^[\w.-]+$/.test(slug)) throw new Fail(EXIT.USAGE, `bad slug ${slug}`);
      removed.push(removeTask(cfg.projectDir, slug));
    }
    const check = reconcileCheck(cfg.projectDir, cfg.state?.facts);
    const errors = removed.flatMap((r) => r.errors);
    const code = check.clean && errors.length === 0 ? EXIT.OK : EXIT.PRECONDITION;
    return {
      code, ok: code === EXIT.OK,
      result: { ...check, removed, hint: check.clean ? undefined : "the lead cleans up after its gate; a stopped task keeps its worktree until you pass --remove <slug>" },
      brief: `reconcile · ${check.clean ? "clean" : check.problems.join("; ")}${removed.length ? ` · removed ${removed.map((r) => r.slug).join(", ")}` : ""}`,
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
        killed.push(await killOrphan(o));
      }
    }
    const check = reconcileCheck(cfg.projectDir, cfg.state?.facts);
    return {
      result: { supported: scan.supported, pattern: flags.pattern ?? DEFAULT_ORPHAN_PATTERN, orphans: scan.orphans, killed, reconcile: check, down },
      brief: `cleanup · ${scan.orphans.length} orphan(s)${flags.kill ? `, ${killed.filter((k) => k.killed).length} killed` : ""} · ${check.clean ? "root clean" : check.problems.join("; ")}`,
    };
  },
});
