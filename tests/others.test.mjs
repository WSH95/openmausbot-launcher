import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./helpers.mjs";
import { observeOthers, readForeignState, fleetOf, edgesOf, canonical } from "../skills/openmausbot-launcher/scripts/lib/others.mjs";

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
  let closed = 0; let requested = 0;
  const io = {
    constants: fs.constants,
    openSync: () => 7,
    fstatSync: () => ({ isFile: () => true, size: 10 }),
    readSync: (fd, buf, offset, length) => { requested += length; buf.fill(0x20, offset, offset + length); return length; },
    closeSync: () => { closed++; throw Object.assign(new Error("close failed"), { code: "EIO" }); },
  };
  const r = readForeignState("/nowhere/.omb/state.json", io);
  assert.match(r.why, /larger than/);
  assert.equal(closed, 1, "the descriptor is closed exactly once and its failure never escapes");
  assert.equal(requested, 8 * 1024 * 1024 + 1, "only the byte past 8 MiB is requested before refusing growth");
  const big = folder({ version: 2, rev: 1, runs: {} });
  fs.writeFileSync(path.join(big, ".omb", "state.json"), Buffer.alloc(9 * 1024 * 1024, 0x20));
  assert.match(readForeignState(path.join(big, ".omb", "state.json")).why, /larger than/);
});

test("an exactly 8 MiB state needs only the one-byte EOF probe and closes exactly once", () => {
  const raw = Buffer.alloc(8 * 1024 * 1024, 0x20); raw.write('{"version":2,"runs":{}}');
  let at = 0; let requested = 0; let closed = 0;
  const io = {
    openSync: () => 7, fstatSync: () => ({ isFile: () => true, size: 1 }), closeSync: () => { closed++; },
    readSync: (_fd, buf, offset, length) => { requested += length; const read = raw.copy(buf, offset, at, at + length); at += read; return read; },
  };
  assert.equal(readForeignState("/nowhere/.omb/state.json", io).doc.version, 2);
  assert.equal(at, raw.length);
  assert.equal(requested, raw.length + 1);
  assert.equal(closed, 1);
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
  seen = await withFolder({ version: 1, rev: 2, server: { environmentId: ENV }, task: { status: "dispatched", title: "T9" } });
  assert.equal(seen.blocking, false); assert.match(seen.others.unknown[0]?.why ?? "", /version 1 task has no run id/, "an open version 1 task without a run id cannot be placed, so it is unknown");
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
  const shapes = [[], null];
  for (const body of shapes) assert.throws(() => fleetOf(body), Error, JSON.stringify(body));
  assert.deepEqual(fleetOf({ bots: [bot("f1", "S")], groups: [] }).bots, [bot("f1", "S")]);
});

for (const state of ["queued", "running"]) for (const side of ["sourceBotId", "targetBotId"]) {
  test(`${state} work with only a valid ${side} blocks and records the unknown bot`, async () => {
    const { cfg } = project();
    for (const missing of [undefined, null, 42, ""]) {
      const other = side === "sourceBotId" ? "targetBotId" : "sourceBotId";
      const { others, blocking } = await look({ "/api/bots": { bots: [bot("foreign", "Stranger")], groups: [] }, "/api/team-map": { queued: [], running: [], [state]: [{ [side]: "foreign", [other]: missing }] } }, cfg);
      assert.equal(blocking, true, "one valid foreign endpoint is positive evidence");
      assert.deepEqual(others.delegations, [{ state, source: side === "sourceBotId" ? "Stranger" : "unknown bot", target: side === "targetBotId" ? "Stranger" : "unknown bot" }]);
      assert.equal(others.counts.unknown, 1);
    }
  });
  test(`${state} work with a foreign ${side} survives an unreadable sibling array`, async () => {
    const { cfg } = project({ team: { environmentId: ENV, bots: [{ id: "ours" }] } });
    const sibling = state === "queued" ? "running" : "queued";
    const other = side === "sourceBotId" ? "targetBotId" : "sourceBotId";
    const { others, blocking } = await look({ "/api/bots": { bots: [bot("foreign", "Stranger"), bot("ours", "Ours")], groups: [] }, "/api/team-map": { [state]: [{ [side]: "foreign", [other]: "ours" }], [sibling]: {} } }, cfg);
    assert.equal(blocking, true, "the readable component's evidence survives");
    assert.equal(others.delegations.length, 1);
    assert.ok(others.unknown.some((u) => u.why.includes(sibling)), JSON.stringify(others));
  });
}

test("fleetOf and edgesOf mark absent required arrays unreadable", () => {
  assert.deepEqual(fleetOf({}).unreadable, ["bots", "groups"]);
  assert.deepEqual(edgesOf({}).unreadable, ["queued", "running"]);
});

test("absent, null and non-array components stay unknown while valid fleet siblings keep their evidence", async () => {
  const { cfg } = project();
  for (const bad of [undefined, null, {}]) {
    const all = await look({ "/api/bots": { bots: bad, groups: bad }, "/api/team-map": { queued: bad, running: bad } }, cfg);
    assert.equal(all.blocking, false);
    assert.equal(all.others.counts.unknown, 4, "each required component is unreadable, never known-empty");
    for (const field of ["bots", "groups", "queued", "running"]) assert.ok(all.others.unknown.some((u) => u.why.includes(field)), field);
    const busy = await look({ "/api/bots": { bots: [bot("foreign", "Stranger", { busy: true })], groups: bad }, "/api/team-map": { queued: [], running: [] } }, cfg);
    assert.equal(busy.blocking, true); assert.deepEqual(busy.others.busyBots, ["Stranger"]);
    const room = await look({ "/api/bots": { bots: bad, groups: [{ id: "room", name: "Room", working: true }] }, "/api/team-map": { queued: [], running: [] } }, cfg);
    assert.equal(room.blocking, true); assert.deepEqual(room.others.workingRooms, ["Room"]);
  }
});

for (const kind of ["fleet", "edges"]) test(`the budget expires inside ${kind} decoding and aggregates skipped candidates`, async (t) => {
  const { cfg } = project();
  let now = 0; let visited = 0;
  t.mock.method(performance, "now", () => now);
  const count = 10_000;
  const entries = Array.from({ length: count }, (_, i) => {
    const entry = kind === "fleet" ? bot(String(i), "Stranger") : { sourceBotId: "foreign", targetBotId: "foreign" };
    const key = kind === "fleet" ? "id" : "sourceBotId";
    const value = entry[key];
    Object.defineProperty(entry, key, { get() { if (++visited === 8) now = 2; return value; } });
    return entry;
  });
  const { others } = await look({ "/api/bots": { bots: kind === "fleet" ? entries : [bot("foreign", "Stranger")], groups: [] }, "/api/team-map": { queued: kind === "edges" ? entries : [], running: [] } }, cfg, { budgetMs: 1 });
  assert.ok(visited >= 8 && visited < count, `decoding stops inside the loop, visited ${visited}`);
  const exhausted = others.unknown.filter((u) => u.source === (kind === "fleet" ? "fleet" : "team-map") && /were not inspected/.test(u.why));
  assert.equal(exhausted.length, 1, "one aggregate for the skipped decode and observation work");
  assert.match(exhausted[0].why, /^10000 (?:bot|delegation)\(s\) were not inspected/);
});

test("the team-map deadline is checked after the await and inside edge observation", async (t) => {
  const { cfg } = project();
  let now = 0; let names = 0;
  t.mock.method(performance, "now", () => now);
  const foreign = bot("foreign", "Stranger");
  Object.defineProperty(foreign, "name", { get() { names++; now = 2; return "Stranger"; } });
  const map = { queued: Array.from({ length: 100 }, () => ({ sourceBotId: "foreign", targetBotId: "foreign" })), running: [] };
  const routes = { "/api/bots": { bots: [foreign], groups: [] }, "/api/team-map": map };
  const observed = await look(routes, cfg, { budgetMs: 1 });
  assert.equal(observed.others.counts.delegations, 1, "stop before the next edge after expiry inside observation");
  assert.equal(names, 2);
  assert.ok(observed.others.unknown.some((u) => /^99 delegation\(s\) were not inspected/.test(u.why)));
  now = 0;
  const awaited = await look({ ...routes, "/api/team-map": () => { now = 2; return map; } }, cfg, { budgetMs: 1 });
  assert.equal(awaited.others.counts.delegations, 0, "a late response starts no edge observation");
  assert.ok(awaited.others.unknown.some((u) => /^100 delegation\(s\) were not inspected/.test(u.why)));
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

test("a FIFO planted as a foreign state file is unknown, never a hang", { skip: process.platform === "win32" && "no mkfifo" }, async () => {
  // A synchronous open on a FIFO with no writer blocks the whole process, so
  // the probe runs in a child that a real-time bound can kill: a hang is red.
  const { execFileSync } = await import("node:child_process");
  const dir = tmpDir("oml-fifo-"); fs.mkdirSync(path.join(dir, ".omb"), { recursive: true });
  const file = path.join(dir, ".omb", "state.json");
  execFileSync("mkfifo", [file]);
  const lib = path.resolve("skills/openmausbot-launcher/scripts/lib/others.mjs");
  let out;
  try {
    out = execFileSync(process.execPath, ["--input-type=module", "-e", `import { readForeignState } from ${JSON.stringify(lib)}; console.log(JSON.stringify(readForeignState(${JSON.stringify(file)})));`], { encoding: "utf8", timeout: 5000 });
  } catch (e) { assert.fail(`readForeignState did not return on a FIFO: ${e.code ?? e.message}`); }
  assert.match(JSON.parse(out).why ?? "", /not a regular file|could not be opened/, out);
});

test("canonical keeps its vocabulary: realpath, missing, unreadable", () => {
  const dir = tmpDir("oml-canon-");
  assert.deepEqual(canonical(dir), { folder: fs.realpathSync(dir), state: "exists" });
  assert.deepEqual(canonical(path.join(dir, "gone")), { folder: path.join(dir, "gone"), state: "missing" });
  fs.writeFileSync(path.join(dir, "file"), "");
  assert.deepEqual(canonical(path.join(dir, "file", "under")), { folder: path.join(dir, "file", "under"), state: "unreadable" });
});
