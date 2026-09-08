import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpDir, makeRepo, sleep } from "./helpers.mjs";
import { statePaths, initState, loadState, updateState, withLock, assertRun, identityMatches, ensureExclude, Fail } from "../skills/openmausbot-launcher/scripts/lib/state.mjs";

const STATE_MJS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../skills/openmausbot-launcher/scripts/lib/state.mjs");

test("init, update, rev, atomic file", async () => {
  const dir = tmpDir();
  const paths = statePaths(dir);
  assert.equal(loadState(paths), null);
  const a = await updateState(paths, (doc) => { doc.project.dir = dir; doc.marks = ["a"]; return doc; });
  assert.equal(a.rev, 1); assert.equal(a.version, 1);
  const b = await updateState(paths, (doc) => { doc.marks.push("b"); return doc; });
  assert.equal(b.rev, 2); assert.deepEqual(b.marks, ["a", "b"]);
  assert.deepEqual(loadState(paths).marks, ["a", "b"]);
  assert.equal(fs.existsSync(paths.lock), false, "the lock is released");
  assert.equal(fs.readdirSync(paths.dir).filter((f) => f.endsWith(".tmp")).length, 0);
  assert.equal(fs.existsSync(path.join(paths.dir, "state.json")), true);
});

test("expectRev: a stale reader fails with a precondition error and nothing is written", async () => {
  const paths = statePaths(tmpDir());
  const first = await updateState(paths, (doc) => { doc.marks = ["a"]; return doc; });
  await updateState(paths, (doc) => { doc.marks.push("b"); return doc; });
  await assert.rejects(updateState(paths, (doc) => { doc.marks.push("c"); return doc; }, { expectRev: first.rev }), (e) => e instanceof Fail && e.code === 3 && /rev/.test(e.message));
  assert.deepEqual(loadState(paths).marks, ["a", "b"]);
});

test("two in-process writers never lose an update", async () => {
  const paths = statePaths(tmpDir());
  await updateState(paths, (doc) => { doc.marks = []; return doc; });
  await Promise.all(Array.from({ length: 8 }, (_, i) => updateState(paths, (doc) => { doc.marks.push(i); return doc; })));
  const doc = loadState(paths);
  assert.equal(doc.marks.length, 8); assert.equal(doc.rev, 9);
});

test("a held lock makes a writer wait, then fail with a precondition error", async () => {
  const paths = statePaths(tmpDir());
  let release;
  const held = withLock(paths, () => new Promise((r) => { release = r; }));
  await sleep(50);
  const t0 = Date.now();
  await assert.rejects(updateState(paths, (d) => d, { waitMs: 300, retryMs: 20 }), (e) => e instanceof Fail && e.code === 3 && /lock/.test(e.message));
  assert.ok(Date.now() - t0 >= 250);
  release(); await held;
  await updateState(paths, (d) => { d.after = true; return d; });
  assert.equal(loadState(paths).after, true);
});

test("legacy lock directories and files require a stopped-launcher upgrade", async () => {
  for (const kind of ["file", "empty", "dead-owner"]) {
    const paths = statePaths(tmpDir());
    fs.mkdirSync(paths.dir, { recursive: true });
    if (kind === "file") fs.writeFileSync(paths.lock, "old");
    else {
      fs.mkdirSync(paths.lock);
      if (kind === "dead-owner") fs.writeFileSync(path.join(paths.lock, "owner.json"), JSON.stringify({ pid: 999999, startedAt: 0 }));
      fs.utimesSync(paths.lock, new Date(0), new Date(0));
    }
    await assert.rejects(updateState(paths, (d) => { d.bad = true; }, { waitMs: 20, retryMs: 5 }),
      (e) => e instanceof Fail && e.code === 3 && /older launcher|legacy/i.test(e.message) && /stop/i.test(e.hint ?? ""));
    assert.equal(loadState(paths), null);
    assert.equal(fs.existsSync(paths.lock), true, "legacy path is never removed automatically");
  }
});

test("SQLite contention retries asynchronously and never enters a live holder's transaction", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const paths = statePaths(tmpDir());
  fs.mkdirSync(paths.dir, { recursive: true });
  const db = new DatabaseSync(path.join(paths.dir, "lock.sqlite"), { timeout: 0 });
  db.exec("BEGIN IMMEDIATE");
  let released = false;
  const timer = setTimeout(() => { released = true; db.exec("ROLLBACK"); }, 50);
  try {
    await withLock(paths, () => assert.equal(released, true, "cannot enter while SQLite owner holds the lock"), { waitMs: 1000, retryMs: 5 });
  } finally { clearTimeout(timer); if (!released) db.exec("ROLLBACK"); db.close(); }
});

test("SQLite lock remains private and persistent after releasing", async () => {
  const paths = statePaths(tmpDir());
  await updateState(paths, (d) => d);
  const file = path.join(paths.dir, "lock.sqlite");
  assert.equal(fs.existsSync(file), true);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(paths.dir).mode & 0o777, 0o700);
  const ino = fs.statSync(file).ino;
  await updateState(paths, (d) => d);
  assert.equal(fs.statSync(file).ino, ino, "never rotate the lock database");
});

test("two processes serialize transactions without losing checkpoints", async () => {
  const paths = statePaths(tmpDir());
  const script = `
    import { statePaths, updateState } from ${JSON.stringify(STATE_MJS)};
    const paths = statePaths(process.argv[1]);
    const tag = process.argv[2];
    await updateState(paths, (d) => { d.marks = [...(d.marks ?? []), tag]; return d; }, { waitMs: 5000, retryMs: 5 });
    // hold a second transaction briefly so the two processes overlap in the lock
    await updateState(paths, async (d) => { await new Promise((r) => setTimeout(r, 30)); d.marks.push(tag + "2"); return d; }, { waitMs: 5000, retryMs: 5 });
    console.log("done " + tag);
  `;
  const run = (tag) => new Promise((resolve) => {
    const c = spawn(process.execPath, ["--input-type=module", "-e", script, "--", paths.dir.replace(/\/\.omb$/, ""), tag], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = ""; c.stdout.on("data", (x) => { out += x; }); c.stderr.on("data", (x) => { err += x; });
    c.on("close", (code) => resolve({ code, out, err }));
  });
  const [a, b] = await Promise.all([run("A"), run("B")]);
  assert.equal(a.code, 0, a.err); assert.equal(b.code, 0, b.err);
  const doc = loadState(paths);
  assert.equal(doc.rev, 4);
  assert.deepEqual([...doc.marks].sort(), ["A", "A2", "B", "B2"]);
  assert.equal(fs.existsSync(paths.lock), false);
  assert.deepEqual(fs.readdirSync(paths.dir).filter((f) => f.startsWith("lock")), ["lock.sqlite"]);
});

test("a mutation that throws leaves the document untouched and releases the lock", async () => {
  const paths = statePaths(tmpDir());
  await updateState(paths, (d) => { d.marks = ["a"]; return d; });
  await assert.rejects(updateState(paths, () => { throw new Fail(3, "nope"); }), /nope/);
  assert.deepEqual(loadState(paths).marks, ["a"]);
  assert.equal(fs.existsSync(paths.lock), false);
});

test("assertRun and identityMatches", () => {
  const doc = initState("/p");
  doc.task = { runId: "r1", status: "dispatched" };
  assert.doesNotThrow(() => assertRun(doc, "r1"));
  assert.throws(() => assertRun(doc, "r2"), (e) => e instanceof Fail && e.code === 3 && /run/.test(e.message));
  assert.throws(() => assertRun({ ...doc, task: null }, "r1"), /run/);
  const server = { environmentId: "e1", healthPid: 10, healthStart: 100 };
  assert.equal(identityMatches(server, { environmentId: "e1", healthPid: 10, healthStart: 100 }), true);
  assert.equal(identityMatches(server, { environmentId: "e2", healthPid: 10, healthStart: 100 }), false);
  assert.equal(identityMatches(server, { environmentId: "e1", healthPid: 11, healthStart: 100 }), false);
  assert.equal(identityMatches(server, { environmentId: "e1", healthPid: 10, healthStart: 101 }), false);
  assert.equal(identityMatches(null, { environmentId: "e1" }), false);
});

test("ensureExclude appends each entry once to .git/info/exclude", () => {
  const { dir } = makeRepo();
  const added = ensureExclude(dir, [".worktrees/", ".omb/"]);
  assert.deepEqual(added, [".worktrees/", ".omb/"]);
  assert.deepEqual(ensureExclude(dir, [".worktrees/", ".omb/"]), []);
  const text = fs.readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8");
  assert.equal((text.match(/^\.omb\/$/gm) ?? []).length, 1);
});

test("a killed SQLite owner releases the mutex without manual reclamation", { timeout: 5000 }, async () => {
  const paths = statePaths(tmpDir());
  fs.mkdirSync(paths.dir, { recursive: true });
  const ready = path.join(paths.dir, "ready");
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import fs from 'node:fs';
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(${JSON.stringify(path.join(paths.dir, "lock.sqlite"))}, { timeout: 0 });
    db.exec('BEGIN IMMEDIATE');
    fs.writeFileSync(${JSON.stringify(ready)}, 'ready');
    setInterval(() => {}, 1000);
  `], { stdio: ["ignore", "ignore", "ignore"] });
  const closed = new Promise((resolve) => child.once("close", resolve));
  try {
    const until = performance.now() + 2000;
    while (!fs.existsSync(ready) && performance.now() < until) await sleep(5);
    assert.equal(fs.existsSync(ready), true, "owner became ready");
    await assert.rejects(withLock(paths, () => assert.fail("concurrent entry"), { waitMs: 40, retryMs: 5 }), /lock/);
    child.kill("SIGKILL"); await closed;
    const doc = await updateState(paths, (d) => { d.recovered = true; }, { waitMs: 500 });
    assert.equal(doc.recovered, true);
  } finally { if (child.signalCode === null && child.exitCode === null) { child.kill("SIGKILL"); await closed; } }
});

test("a malformed lock database fails without replacing the artifact or writing state", async () => {
  const paths = statePaths(tmpDir());
  fs.mkdirSync(paths.dir, { recursive: true });
  const file = path.join(paths.dir, "lock.sqlite");
  const content = Buffer.alloc(4096, "broken sqlite");
  fs.writeFileSync(file, content, { mode: 0o600 });
  await assert.rejects(updateState(paths, (d) => { d.bad = true; }), /database|file/i);
  assert.deepEqual(fs.readFileSync(file), content);
  assert.equal(loadState(paths), null);
});

test("an overdue retry never enters the callback after its lock deadline", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const paths = statePaths(tmpDir());
  fs.mkdirSync(paths.dir, { recursive: true });
  const db = new DatabaseSync(path.join(paths.dir, "lock.sqlite"), { timeout: 0 });
  db.exec("BEGIN IMMEDIATE");
  let released = false;
  const timer = setTimeout(() => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    db.exec("ROLLBACK"); released = true;
  }, 20);
  try {
    let entered = false;
    await assert.rejects(withLock(paths, () => { entered = true; }, { waitMs: 40, retryMs: 30 }), /lock/);
    assert.equal(entered, false);
  } finally { clearTimeout(timer); if (!released) db.exec("ROLLBACK"); db.close(); }
});
