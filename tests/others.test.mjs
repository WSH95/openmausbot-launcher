import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./helpers.mjs";
import { observeOthers, readForeignState, fleetOf, canonical } from "../skills/openmausbot-launcher/scripts/lib/others.mjs";

const ENV = "environment-one";
const OTHER = "environment-two";

/** A project directory with no state file of its own unless one is written. */
function project(state = null) {
  const dir = tmpDir("oml-obs-");
  return { dir, cfg: { projectDir: dir, paths: { file: path.join(dir, ".omb", "state.json") }, state } };
}
/** Another project's folder, with the state document the case is about. */
function folder(doc) {
  const dir = tmpDir("oml-obs-other-");
  if (doc !== undefined) { fs.mkdirSync(path.join(dir, ".omb")); fs.writeFileSync(path.join(dir, ".omb", "state.json"), typeof doc === "string" ? doc : JSON.stringify(doc)); }
  return dir;
}
/** A client that answers the routes it was given and nothing else. */
const clientOf = (routes) => ({
  get: async (route) => {
    const answer = routes[route.split("?")[0]];
    if (answer === undefined) throw new Error(`no route ${route}`);
    if (answer instanceof Error) throw answer;
    return typeof answer === "function" ? answer() : answer;
  },
});
const bot = (id, name, extra = {}) => ({ id, name, section: "Other team", activity: "idle", busy: false, ...extra });
const look = (routes, cfg, opts = {}) => observeOthers({ client: clientOf(routes), cfg, environmentId: ENV, ...opts });

test("a delegation blocks on the endpoint the fleet does know, and says the other end was missing", async () => {
  const { cfg } = project();
  const fleet = { bots: [bot("f1", "Stranger")], groups: [] };
  let { others, blocking } = await look({ "/api/bots": fleet, "/api/team-map": { queued: [{ sourceBotId: "f1", targetBotId: "ghost" }], running: [] } }, cfg);
  assert.equal(blocking, true, "a known foreign source is observed work, whatever its target is");
  assert.deepEqual(others.delegations, [{ state: "queued", source: "Stranger", target: "unknown bot" }]);
  assert.ok(others.unknown.some((u) => /does not list/.test(u.why)), JSON.stringify(others.unknown));
  ({ others, blocking } = await look({ "/api/bots": fleet, "/api/team-map": { queued: [], running: [{ sourceBotId: "ghost", targetBotId: "phantom" }] } }, cfg));
  assert.equal(blocking, false, "an edge with no known endpoint is only unknown");
  assert.deepEqual(others.delegations, []);
  assert.equal(others.counts.unknown, 1);
});

test("the foreign state read is bounded by what it reads, not by what fstat said, and a failed close stays inside", () => {
  let closed = false;
  const io = {
    constants: fs.constants,
    openSync: () => 7,
    fstatSync: () => ({ isFile: () => true, size: 10 }),
    readSync: (fd, buf, offset, length) => { buf.fill(0x20, offset, offset + length); return length; },
    closeSync: () => { closed = true; throw Object.assign(new Error("close failed"), { code: "EIO" }); },
  };
  const r = readForeignState("/nowhere/.omb/state.json", io);
  assert.match(r.why, /larger than/);
  assert.equal(closed, true, "the descriptor is closed and its failure never escapes");
  const big = folder({ version: 2, rev: 1, runs: {} });
  fs.writeFileSync(path.join(big, ".omb", "state.json"), Buffer.alloc(9 * 1024 * 1024, 0x20));
  assert.match(readForeignState(path.join(big, ".omb", "state.json")).why, /larger than/);
});

test("a foreign state is read in its own version's shape, and contradictory identity is never trusted", async () => {
  const { cfg } = project();
  const withFolder = async (doc) => {
    const dir = folder(doc);
    const { others, blocking } = await look({ "/api/bots": { bots: [bot("f1", "Stranger", { cwd: dir })], groups: [] }, "/api/team-map": { queued: [], running: [] } }, cfg);
    return { others, blocking, dir };
  };
  let seen = await withFolder({ version: 1, rev: 2, task: null });
  assert.equal(seen.blocking, false, "version 1 with no task is a known negative");
  assert.deepEqual(seen.others.unknown, []);
  seen = await withFolder({ version: 1, rev: 2, server: { environmentId: ENV }, task: { runId: "aaaabbbbccccdddd", status: "dispatched", title: "T9", slug: "t9" } });
  assert.equal(seen.blocking, true, "a version 1 open task on this environment is observed work");
  assert.deepEqual(seen.others.projects, [{ folder: seen.dir, runs: ["t9 (aaaabbbb, dispatched)"] }]);
  seen = await withFolder({ version: 1, rev: 2, server: { environmentId: ENV } });
  assert.equal(seen.blocking, false); assert.equal(seen.others.counts.unknown, 1, "a version 1 state with no task key at all is unknown");
  seen = await withFolder({ version: 2, rev: 2, server: { environmentId: ENV } });
  assert.equal(seen.blocking, false); assert.equal(seen.others.counts.unknown, 1, "a version 2 state with no runs is unknown, not a known negative");
  seen = await withFolder({ version: 2, rev: 2, server: { environmentId: OTHER }, runs: { r: { runId: "aaaabbbbccccdddd", status: "dispatched", title: "T9", context: { server: { environmentId: ENV } } } } });
  assert.equal(seen.blocking, false, "two present, unequal environment ids are never trusted");
  assert.match(seen.others.unknown[0].why, /contradictory environment identity/);
});

test("malformed fleet data is dropped and counted, never thrown past the guard", async () => {
  const { cfg } = project();
  const { others, blocking } = await look({
    "/api/bots": { bots: [bot("f1", "Stranger", { busy: true, activity: "working" }), null], groups: [null] },
    "/api/team-map": { queued: [], running: [] },
  }, cfg);
  assert.equal(blocking, true);
  assert.deepEqual(others.busyBots, ["Stranger"], "what the same answer proved is kept");
  assert.ok(others.unknown.some((u) => u.source === "fleet"), JSON.stringify(others.unknown));
  const shapes = [{ bots: {} }, [], null, { bots: [], groups: 7 }];
  for (const body of shapes) assert.throws(() => fleetOf(body), Error, JSON.stringify(body));
  assert.deepEqual(fleetOf({ bots: [bot("f1", "S")] }), { bots: [bot("f1", "S")], groups: [], dropped: 0 });
});

test("the inspection budget stops the loops and reports one aggregated unknown", async () => {
  const { cfg } = project();
  const spend = (ms) => { const until = performance.now() + ms; while (performance.now() < until); };
  const fleet = { bots: [bot("f1", "A", { cwd: folder() }), bot("f2", "B", { cwd: folder() })], groups: [] };
  const { others, blocking } = await look({ "/api/bots": () => { spend(25); return fleet; }, "/api/team-map": { queued: [], running: [] } }, cfg, { budgetMs: 10 });
  assert.equal(blocking, false);
  assert.deepEqual(others.unknown.map((u) => u.source), ["fleet", "team-map"], "one aggregated entry per loop, never one per candidate");
  assert.match(others.unknown[0].why, /2 bot\(s\) were not inspected/);
  assert.ok(!others.unknown.some((u) => u.source.startsWith("/")), "no folder was walked after the budget ran out");
  const spent = await look({ "/api/bots": fleet, "/api/team-map": { queued: [], running: [] } }, cfg, { budgetMs: 0 });
  assert.equal(spent.blocking, false);
  assert.deepEqual(spent.others.unknown.map((u) => u.source), ["fleet", "team-map"], "a budget spent before the first request reads nothing and says so");
});

test("canonical keeps its vocabulary: realpath, missing, unreadable", () => {
  const dir = tmpDir("oml-canon-");
  assert.deepEqual(canonical(dir), { folder: fs.realpathSync(dir), state: "exists" });
  assert.deepEqual(canonical(path.join(dir, "gone")), { folder: path.join(dir, "gone"), state: "missing" });
  fs.writeFileSync(path.join(dir, "file"), "");
  assert.deepEqual(canonical(path.join(dir, "file", "under")), { folder: path.join(dir, "file", "under"), state: "unreadable" });
});
