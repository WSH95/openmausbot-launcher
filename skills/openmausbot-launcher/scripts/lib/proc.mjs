// Orphaned sandbox processes: a test run that outlived its turn inside a
// deleted worktree (devpack EVIDENCE.md "pack 0.4.1 validation", item 5).
// Linux only; identity (pid, start ticks, cwd) is rechecked before every
// signal, and recorded server pids are never candidates.
import fs from "node:fs";
import path from "node:path";
import { procInfo, hasProc } from "./server.mjs";

export function procCwd(pid) {
  try { return fs.readlinkSync(`/proc/${pid}/cwd`); } catch { return null; }
}

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
    const cwd = procCwd(pid);
    if (!cwd) continue;
    const bare = cwd.replace(/ \(deleted\)$/, "");
    if (bare !== root && !bare.startsWith(`${root}${path.sep}`)) continue;
    const deleted = cwd.endsWith(" (deleted)") || !fs.existsSync(bare);
    orphans.push({ pid, ppid: info.ppid, startTicks: info.startTicks, cwd: bare, deleted, cmd: info.cmdline.slice(0, 6).join(" ") });
  }
  return { supported: true, orphans };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** SIGTERM, then SIGKILL after `graceMs`, rechecking identity before each signal. */
export async function killOrphan(orphan, { graceMs = 5000 } = {}) {
  const same = () => { const i = procInfo(orphan.pid); return i?.alive && i.startTicks === orphan.startTicks ? i : null; };
  if (!same()) return { pid: orphan.pid, killed: false, why: "already gone or a different process" };
  try { process.kill(orphan.pid, "SIGTERM"); } catch (e) { return { pid: orphan.pid, killed: false, why: e.message }; }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) { if (!same()) return { pid: orphan.pid, killed: true, signal: "SIGTERM" }; await sleep(100); }
  if (!same()) return { pid: orphan.pid, killed: true, signal: "SIGTERM" };
  try { process.kill(orphan.pid, "SIGKILL"); } catch (e) { return { pid: orphan.pid, killed: false, why: e.message }; }
  await sleep(100);
  return { pid: orphan.pid, killed: !same(), signal: "SIGKILL" };
}
