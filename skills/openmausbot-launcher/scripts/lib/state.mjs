// The per-project state file and its lock.
//
// JSON remains the source of truth. A persistent SQLite file is only a
// mutex: BEGIN IMMEDIATE serializes writers, including across processes,
// and process death releases the OS lock. Never unlink or rotate that file.
import fs from "node:fs";
import path from "node:path";
import { EXIT, Fail } from "./cli.mjs";
import { gitPath } from "./git.mjs";

export { Fail };
export const STATE_VERSION = 2;

export function statePaths(projectDir, override) {
  const file = override ? path.resolve(override) : path.join(path.resolve(projectDir), ".omb", "state.json");
  const dir = path.dirname(file);
  return { projectDir: path.resolve(projectDir), dir, file, lock: path.join(dir, "lock"), lockDb: path.join(dir, "lock.sqlite") };
}

export function initState(projectDir) {
  return { version: STATE_VERSION, rev: 0, project: { dir: path.resolve(projectDir) }, server: null, team: null, facts: null, runs: {}, history: [] };
}

/** Version 1 held one `task`; version 2 holds `runs` keyed by run id. A closed
 * task was already appended to `history` by whoever closed it, so only an open
 * one carries over. The document is migrated on every read and reaches the file
 * in the new shape on the next write. */
export function migrate(doc) {
  if (doc.version !== 1) return doc;
  const { task, ...rest } = doc;
  const runs = task && task.status !== "closed" && task.runId ? { [task.runId]: task } : {};
  return { ...rest, version: STATE_VERSION, runs };
}

/** A fresh read. Returns null when there is no state yet. */
export function loadState(paths) {
  let text;
  try { text = fs.readFileSync(paths.file, "utf8"); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
  let doc;
  try { doc = JSON.parse(text); } catch { throw new Fail(EXIT.PRECONDITION, `state file is not valid JSON: ${paths.file}`, { hint: "move it aside and re-import or adopt the team" }); }
  if (doc.version !== STATE_VERSION && doc.version !== 1) throw new Fail(EXIT.PRECONDITION, `state file version ${doc.version} is not ${STATE_VERSION}`, { hint: "move it aside and re-import or adopt the team" });
  return migrate(doc);
}

/** Write, fsync, rename, then fsync the directory so the rename is durable; never leave a temp file behind. */
function writeState(paths, doc) {
  const tmp = `${paths.file}.${process.pid}.tmp`;
  try {
    const fd = fs.openSync(tmp, "w", 0o600);
    try { fs.writeFileSync(fd, `${JSON.stringify(doc, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, paths.file);
  } catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }
  try { const dir = fs.openSync(paths.dir, "r"); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } } catch {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class LockTimeout extends Fail {
  constructor(file, waitMs) {
    super(EXIT.PRECONDITION, "the state lock is held", { hint: `waited ${waitMs} ms for ${file}; wait for the other launcher or stop it` });
  }
}

/** Run `fn` while holding the project lock. */
export async function withLock(paths, fn, opts = {}) {
  const waitMs = opts.waitMs ?? Number(process.env.OMB_LOCK_WAIT_MS || 60_000);
  const retryMs = opts.retryMs ?? 100;
  if (!Number.isFinite(waitMs) || waitMs < 0 || !Number.isFinite(retryMs) || retryMs <= 0) throw new Fail(EXIT.USAGE, "lock wait must be nonnegative and retry must be positive");
  // An old launcher does not participate in the SQLite mutex. Upgrade all
  // runnable copies with commands and automations stopped before removing
  // its lock, whether it is a file, an empty directory, or an owner record.
  try {
    fs.lstatSync(paths.lock);
    throw new Fail(EXIT.PRECONDITION, "an older launcher's legacy lock is present", { hint: `stop every launcher command and automation, update all installations, then remove ${paths.lock}` });
  } catch (e) { if (e.code !== "ENOENT") throw e; }
  fs.mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  const file = paths.lockDb ?? path.join(paths.dir, "lock.sqlite");
  try { fs.closeSync(fs.openSync(file, "wx", 0o600)); } catch (e) { if (e.code !== "EEXIST") throw e; }
  fs.chmodSync(file, 0o600);
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file, { timeout: 0 });
  const deadline = performance.now() + waitMs;
  let acquired = false;
  let attempted = false;
  try {
    for (;;) {
      if (attempted && performance.now() >= deadline) throw new LockTimeout(file, waitMs);
      attempted = true;
      try { db.exec("BEGIN IMMEDIATE"); acquired = true; break; }
      catch (e) {
        if (e.errcode !== 5) throw e; // SQLITE_BUSY only: corruption/I/O must surface.
        const remaining = deadline - performance.now();
        if (remaining <= 0) throw new LockTimeout(file, waitMs);
        await sleep(Math.min(retryMs, remaining));
      }
    }
    return await fn();
  } finally {
    try { if (acquired) db.exec("ROLLBACK"); } finally { db.close(); }
  }
}

/**
 * Read-modify-write under the lock. `mutate(doc)` returns the new document
 * (or mutates in place and returns it). `expectRev` fails the write when the
 * document moved since the caller's read.
 */
export async function updateState(paths, mutate, opts = {}) {
  return withLock(paths, async () => {
    const doc = loadState(paths) ?? initState(paths.projectDir ?? path.dirname(paths.dir));
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

/** The run must still be open in the document the caller is about to write. */
export function assertOpenRun(doc, runId) {
  const run = doc?.runs?.[runId];
  if (!run || run.status === "closed") {
    throw new Fail(EXIT.PRECONDITION, `the state has no open run ${runId}`, { hint: "another launcher closed or replaced it; re-read the state" });
  }
  return run;
}

/** Persistent environment id plus the live server process identity. */
export function identityMatches(recorded, live) {
  if (!recorded || !live) return false;
  return recorded.environmentId === live.environmentId && recorded.healthPid === live.healthPid && recorded.healthStart === live.healthStart;
}

/** Append entries to the repository's info/exclude once; returns the entries added. The file is where git says it is: a linked worktree's `.git` is a file and its exclude lives under the main repository. */
export function ensureExclude(projectDir, entries) {
  const file = gitPath(projectDir, "info/exclude") ?? path.join(projectDir, ".git", "info", "exclude");
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
