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

test("a stale lock (dead owner) is reclaimed by rename, leaving no debris", async () => {
  const paths = statePaths(tmpDir());
  fs.mkdirSync(paths.lock, { recursive: true });
  fs.writeFileSync(path.join(paths.lock, "owner.json"), JSON.stringify({ pid: 999999, startedAt: Date.now() - 5000 }));
  const doc = await updateState(paths, (d) => { d.marks = ["reclaimed"]; return d; }, { waitMs: 2000 });
  assert.deepEqual(doc.marks, ["reclaimed"]);
  assert.equal(fs.existsSync(paths.lock), false);
  assert.deepEqual(fs.readdirSync(paths.dir).filter((f) => f.startsWith("lock")), []);
});

test("a lock with no owner record is held while fresh and reclaimed once older than the stale window", async () => {
  const paths = statePaths(tmpDir());
  fs.mkdirSync(paths.lock, { recursive: true });
  await assert.rejects(updateState(paths, (d) => d, { waitMs: 200, retryMs: 20, staleMs: 60_000 }), /lock/);
  const old = new Date(Date.now() - 120_000);
  fs.utimesSync(paths.lock, old, old);
  const doc = await updateState(paths, (d) => { d.ok = true; return d; }, { waitMs: 1000, retryMs: 20, staleMs: 60_000 });
  assert.equal(doc.ok, true);
});

test("two reclaimers racing on a dead owner's lock both write once and never remove each other's lock", async () => {
  const paths = statePaths(tmpDir());
  fs.mkdirSync(paths.lock, { recursive: true });
  fs.writeFileSync(path.join(paths.lock, "owner.json"), JSON.stringify({ pid: 999999, startedAt: Date.now() - 5000 }));
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
  assert.deepEqual(fs.readdirSync(paths.dir).filter((f) => f.startsWith("lock")), []);
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
