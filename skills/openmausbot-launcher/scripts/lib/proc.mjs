// Orphaned sandbox processes: a test run that outlived its turn inside a
// deleted worktree (devpack EVIDENCE.md "pack 0.4.1 validation", item 5).
// Linux only; identity (pid, start ticks, cwd) is rechecked before every
// signal, and recorded server pids are never candidates.
import fs from "node:fs";
import path from "node:path";
import { procInfo, hasProc } from "./server.mjs";


function cwdIdentity(pid) {
  try {
    const link = fs.readlinkSync(`/proc/${pid}/cwd`);
    const stat = fs.statSync(`/proc/${pid}/cwd`);
    if (fs.readlinkSync(`/proc/${pid}/cwd`) !== link) return null;
    // The kernel suffix alone is ambiguous: a live directory can have that name.
    const deleted = stat.nlink === 0;
    return { cwd: deleted ? link.replace(/ \(deleted\)$/, "") : link, deleted };
  } catch { return null; }
}
const contained = (cwd, root) => cwd === root || cwd.startsWith(`${root}${path.sep}`);

/** Processes whose argv matches `pattern` and whose cwd is a deleted path under `worktreesDir`. */
export function scanOrphans({ pattern, worktreesDir, protectPids = [] }) {
  if (!hasProc()) return { supported: false, orphans: [] };
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  const root = path.resolve(worktreesDir);
  const orphans = [];
  for (const name of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    if (pid === process.pid || protectPids.includes(pid)) continue;
    const info = procInfo(pid);
    if (!info?.alive || !info.cmdline.length) continue;
    if (!re.test(info.cmdline.join(" "))) continue;
    const cwd = cwdIdentity(pid);
    if (!cwd || !contained(cwd.cwd, root)) continue;
    orphans.push({ pid, ppid: info.ppid, startTicks: info.startTicks, cwd: cwd.cwd, deleted: cwd.deleted, cmd: info.cmdline.slice(0, 6).join(" ") });
  }
  return { supported: true, orphans };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** SIGTERM, then SIGKILL after `graceMs`, rechecking identity before each signal. */
export async function killOrphan(orphan, { graceMs = 5000, worktreesDir, protectPids = () => [] } = {}) {
  const root = worktreesDir ? path.resolve(worktreesDir) : null;
  const sameProcess = () => { const info = procInfo(orphan.pid); return info?.alive && info.startTicks === orphan.startTicks; };
  const refusal = () => {
    const protectedIds = typeof protectPids === "function" ? protectPids() : protectPids;
    if (orphan.pid === process.pid || protectedIds.includes(orphan.pid)) return "a protected server or launcher process";
    const cwd = cwdIdentity(orphan.pid);
    if (!cwd || cwd.cwd !== orphan.cwd) return "its cwd changed or could not be verified";
    if (!root || !contained(cwd.cwd, root)) return "its cwd is outside the task worktrees";
    if (!cwd.deleted) return "its worktree still exists";
    return null;
  };
  const stopIfIneligible = () => {
    const why = refusal(); return why ? { pid: orphan.pid, killed: false, why } : null;
  };
  if (!sameProcess()) return { pid: orphan.pid, killed: false, why: "already gone or a different process" };
  let refused = stopIfIneligible(); if (refused) return refused;
  try { process.kill(orphan.pid, "SIGTERM"); } catch (e) { return { pid: orphan.pid, killed: false, why: e.message }; }
  const deadline = performance.now() + graceMs;
  while (performance.now() < deadline) {
    if (!sameProcess()) return { pid: orphan.pid, killed: true, signal: "SIGTERM" };
    // An exiting process can lose its cwd before /proc reports its death.
    // Observe exit through the grace period; eligibility gates signals below.
    await sleep(Math.min(100, Math.max(0, deadline - performance.now())));
  }
  if (!sameProcess()) return { pid: orphan.pid, killed: true, signal: "SIGTERM" };
  refused = stopIfIneligible(); if (refused) return { ...refused, signal: "SIGTERM" };
  try { process.kill(orphan.pid, "SIGKILL"); } catch (e) { return { pid: orphan.pid, killed: false, why: e.message }; }
  await sleep(100);
  return { pid: orphan.pid, killed: !sameProcess(), signal: "SIGKILL" };
}
