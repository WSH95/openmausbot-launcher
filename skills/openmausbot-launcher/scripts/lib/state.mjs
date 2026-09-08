// The per-project state file and its lock.
//
// <project>/.omb/state.json holds ids only, never tokens. Every write is a
// read-modify-write transaction under <project>/.omb/lock/, a directory:
// mkdir is atomic and fails with EEXIST. A stale lock (dead owner, or no
// owner record and older than the stale window) is reclaimed by RENAME, not
// removal: exactly one reclaimer's rename succeeds, so two reclaimers can
// never remove a newer owner's lock (design, "State file").
import fs from "node:fs";
import path from "node:path";
import { EXIT, Fail } from "./cli.mjs";

export { Fail };
export const STATE_VERSION = 1;

export function statePaths(projectDir, override) {
  const file = override ? path.resolve(override) : path.join(path.resolve(projectDir), ".omb", "state.json");
  const dir = path.dirname(file);
  return { dir, file, lock: path.join(dir, "lock") };
}

export function initState(projectDir) {
  return { version: STATE_VERSION, rev: 0, project: { dir: path.resolve(projectDir) }, server: null, team: null, facts: null, task: null, history: [] };
}

/** A fresh read. Returns null when there is no state yet. */
export function loadState(paths) {
  let text;
  try { text = fs.readFileSync(paths.file, "utf8"); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
  let doc;
  try { doc = JSON.parse(text); } catch { throw new Fail(EXIT.PRECONDITION, `state file is not valid JSON: ${paths.file}`, { hint: "move it aside and re-import or adopt the team" }); }
  if (doc.version !== STATE_VERSION) throw new Fail(EXIT.PRECONDITION, `state file version ${doc.version} is not ${STATE_VERSION}`, { hint: "move it aside and re-import or adopt the team" });
  return doc;
}

function writeState(paths, doc) {
  const tmp = `${paths.file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, paths.file);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

function lockIsStale(lockDir, { staleMs, hardStaleMs }) {
  let record = null;
  try { record = JSON.parse(fs.readFileSync(path.join(lockDir, "owner.json"), "utf8")); } catch {}
  const now = Date.now();
  if (record && Number.isInteger(record.pid)) {
    if (!alive(record.pid)) return { stale: true, why: `owner pid ${record.pid} is dead` };
    if (now - (record.startedAt ?? now) > hardStaleMs) return { stale: true, why: `owner pid ${record.pid} has held it for more than ${Math.round(hardStaleMs / 1000)} s` };
    return { stale: false, record };
  }
  let mtime = now;
  try { mtime = fs.statSync(lockDir).mtimeMs; } catch (e) { if (e.code === "ENOENT") return { stale: false, gone: true }; throw e; }
  if (now - mtime > staleMs) return { stale: true, why: "no owner record and older than the stale window" };
  return { stale: false, record: null };
}

/** Rename-to-claim: exactly one caller wins the rename; the winner removes what it renamed. */
function reclaim(lockDir) {
  const target = `${lockDir}.stale.${process.pid}.${Date.now()}`;
  try { fs.renameSync(lockDir, target); } catch (e) { if (e.code === "ENOENT") return false; throw e; }
  fs.rmSync(target, { recursive: true, force: true });
  return true;
}

/** Run `fn` while holding the project lock. */
export async function withLock(paths, fn, opts = {}) {
  const waitMs = opts.waitMs ?? Number(process.env.OMB_LOCK_WAIT_MS || 60_000);
  const retryMs = opts.retryMs ?? 100;
  const staleMs = opts.staleMs ?? 60_000;
  const hardStaleMs = opts.hardStaleMs ?? 10 * 60_000;
  fs.mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  const deadline = Date.now() + waitMs;
  let holder = null;
  let ino = null;
  for (;;) {
    try {
      fs.mkdirSync(paths.lock);
      fs.writeFileSync(path.join(paths.lock, "owner.json"), JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
      ino = fs.statSync(paths.lock).ino;
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const s = lockIsStale(paths.lock, { staleMs, hardStaleMs });
      if (s.stale) { reclaim(paths.lock); continue; }
      if (s.gone) continue;
      holder = s.record;
      if (Date.now() >= deadline) {
        throw new Fail(EXIT.PRECONDITION, holder ? `the state lock is held by pid ${holder.pid}` : "the state lock is held", { hint: `waited ${Math.round(waitMs / 1000)} s for ${paths.lock}; if no launcher is running, remove that directory` });
      }
      await sleep(retryMs);
    }
  }
  try {
    return await fn();
  } finally {
    // Release only what we created: a reclaimer that took our lock (only
    // possible after hardStaleMs) has renamed it away, so the path now
    // belongs to someone else.
    try { if (fs.statSync(paths.lock).ino === ino) fs.rmSync(paths.lock, { recursive: true, force: true }); } catch {}
  }
}

/**
 * Read-modify-write under the lock. `mutate(doc)` returns the new document
 * (or mutates in place and returns it). `expectRev` fails the write when the
 * document moved since the caller's read.
 */
export async function updateState(paths, mutate, opts = {}) {
  return withLock(paths, async () => {
    const doc = loadState(paths) ?? initState(path.dirname(paths.dir));
    if (opts.expectRev !== undefined && doc.rev !== opts.expectRev) {
      throw new Fail(EXIT.PRECONDITION, `state rev moved from ${opts.expectRev} to ${doc.rev} since it was read`, { hint: "re-read the state and retry" });
    }
    const next = (await mutate(doc)) ?? doc;
    next.rev = (doc.rev ?? 0) + 1;
    next.version = STATE_VERSION;
    writeState(paths, next);
    return next;
  }, opts);
}

/** The current run must be the one the caller observed. */
export function assertRun(doc, runId) {
  if (!doc?.task || doc.task.runId !== runId) {
    throw new Fail(EXIT.PRECONDITION, `the state's current run is ${doc?.task?.runId ?? "none"}, not ${runId}`, { hint: "another launcher replaced the run; re-read the state" });
  }
}

/** Persistent environment id plus the live server process identity. */
export function identityMatches(recorded, live) {
  if (!recorded || !live) return false;
  return recorded.environmentId === live.environmentId && recorded.healthPid === live.healthPid && recorded.healthStart === live.healthStart;
}

/** Append entries to .git/info/exclude once; returns the entries added. */
export function ensureExclude(projectDir, entries) {
  const file = path.join(projectDir, ".git", "info", "exclude");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  const present = new Set(text.split("\n").map((l) => l.trim()));
  const added = entries.filter((e) => !present.has(e));
  if (added.length) fs.appendFileSync(file, `${text.length && !text.endsWith("\n") ? "\n" : ""}${added.join("\n")}\n`);
  return added;
}

/** Write a document while the caller already holds the lock (checkpoints inside a long transaction). */
export function commitState(paths, doc) {
  doc.rev = (doc.rev ?? 0) + 1;
  doc.version = STATE_VERSION;
  writeState(paths, doc);
  return doc;
}
