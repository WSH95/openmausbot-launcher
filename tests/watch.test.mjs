import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { startFake, makeRepo, runOmb, ROOT, sleep } from "./helpers.mjs";
import { statePaths, loadState, updateState } from "../skills/openmausbot-launcher/scripts/lib/state.mjs";
import { relevantFrame, mergeCheckpoint, watchRun } from "../skills/openmausbot-launcher/scripts/lib/watch.mjs";
import { createClient } from "../skills/openmausbot-launcher/scripts/lib/http.mjs";
import { outOfBudget, withinDeadline } from "../skills/openmausbot-launcher/scripts/lib/snapshot.mjs";

const PKG = path.join(ROOT, "tests", "fixtures", "dev-team.package.json");
let env = { OMB_TOKEN: "" };
const fast = ["--quiet-seconds", "1", "--drop-seconds", "1", "--poll", "1"];
const thread = async (f, id) => (await (await fetch(`${f.url}/api/threads/${id}/messages`)).json()).messages;

async function setup(t, opts = {}) {
  const f = await startFake({ heartbeatMs: 100, ...opts }); t.after(() => f.close());
  env = { OMB_TOKEN: "", OMB_DATA_DIR: f.dataDir };
  const { dir } = makeRepo();
  assert.equal((await runOmb(["import", PKG, "--project", dir, "--url", f.url], { env })).code, 0);
  assert.equal((await runOmb(["bind", "--project", dir, "--default", "claude/claude-sonnet-5"], { env })).code, 0);
  const run = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  assert.equal(run.code, 0, run.stdout + run.stderr);
  const st = loadState(statePaths(dir));
  return { f, dir, lead: st.team.lead, team: st.team, run: run.json, lt: run.json.leadThreadId };
}

test("relevantFrame", () => {
  const ctx = { teamIds: new Set(["a"]), threadIds: new Set(["t"]) };
  assert.equal(relevantFrame({ data: { kind: "bot", bot: { id: "a" } } }, ctx), true);
  assert.equal(relevantFrame({ data: { kind: "bot", bot: { id: "z" } } }, ctx), false);
  assert.equal(relevantFrame({ data: { kind: "message", threadId: "t" } }, ctx), true);
  assert.equal(relevantFrame({ data: { kind: "message.patch", threadId: "u" } }, ctx), false);
  assert.equal(relevantFrame({ data: { kind: "notify", notification: { botId: "a" } } }, ctx), true);
  assert.equal(relevantFrame({ data: { kind: "hello", resumed: false } }, ctx), true);
  assert.equal(relevantFrame({ data: { kind: "hello", resumed: true } }, ctx), false);
  assert.equal(relevantFrame({ data: { kind: "ping" } }, ctx), false);
});

test("watch reaches done through SSE wake-ups: busy, outcome, closing report with the marker, quiet", async (t) => {
  const { f, dir, lead, run, lt } = await setup(t);
  const nova = loadState(statePaths(dir)).team.bots.find((b) => b.key === "nova");
  const p = runOmb(["watch", "--project", dir, "--max-seconds", "20", ...fast], { env });
  await sleep(600);
  await f.control({ op: "activity", botId: lead.id, activity: "working" });
  await f.control({ op: "leadSay", threadId: lt, text: "Delegating the plan." });
  await f.control({ op: "activity", botId: lead.id, activity: "idle" });
  await f.control({ op: "activity", botId: nova.id, activity: "working" });
  await sleep(300);
  await f.control({ op: "activity", botId: nova.id, activity: "idle" });
  await f.control({ op: "echo", threadId: lt, fromBotId: nova.id, name: "Nova", text: "implemented" });
  await f.control({ op: "receipt", sourceThreadId: lt, toBotName: "Nova", status: "completed" });
  await sleep(200);
  await f.control({ op: "activity", botId: lead.id, activity: "working" });
  await sleep(200);
  await f.control({ op: "leadSay", threadId: lt, text: `Closing report: merged as 1234567. 72 tests.\n\nDONE ${run.tag}` });
  await f.control({ op: "activity", botId: lead.id, activity: "idle" });
  const r = await p;
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.json.state, "done"); assert.equal(r.json.outcome, "terminal"); assert.ok(r.json.elapsedSec < 15);
  assert.ok(r.json.changes.length >= 2, "changes were recorded"); assert.equal(r.json.outcomes, 2);
  assert.match(r.json.cursor, /^[0-9a-f]{8}:\d+$/);
  assert.match(r.json.brief, /DONE after/);
  const st = loadState(statePaths(dir));
  assert.equal(st.task.status, "dispatched", "watch never changes the run status");
  assert.equal(st.task.lastEval.state, "done"); assert.equal(st.task.lastEval.cursor, r.json.cursor); assert.equal(st.task.lastEval.quietSince, null); assert.equal(st.task.lastEval.outcomes.length, 2);
  const s = await runOmb(["status", "--project", dir], { env });
  assert.equal(s.json.state, "done", "status carries the watch's verdict");
});

test("a question card ends the watch immediately with exit 5; a cold start with the marker already present settles", async (t) => {
  const { f, dir, lead, run, lt } = await setup(t);
  const p = runOmb(["watch", "--project", dir, "--max-seconds", "20", ...fast], { env });
  await sleep(500);
  await f.control({ op: "card", threadId: lt, requestId: "q1", kind: "question", text: "Table or list?" });
  const r = await p;
  assert.equal(r.code, 5, r.stdout); assert.equal(r.json.state, "needs-user"); assert.ok(r.json.elapsedSec < 5, "the frame woke the watch before the poll");
  assert.match(r.json.brief, /NEEDS YOU · Sudo: "Table or list\?" → omb answer --message/);
  await fetch(`${f.url}/api/threads/${lt}/respond`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: "q1", behavior: "answer", message: "table" }) });
  await f.control({ op: "leadSay", threadId: lt, text: `Closing report.\nDONE ${run.tag}` });
  const r2 = await runOmb(["watch", "--project", dir, "--max-seconds", "20", ...fast], { env });
  assert.equal(r2.code, 0, r2.stdout); assert.equal(r2.json.state, "done"); assert.ok(r2.json.elapsedSec >= 1 && r2.json.elapsedSec < 6, `quiet observed inside the invocation (${r2.json.elapsedSec}s)`);
});

test("deadline, --until change, --quiet-if-unchanged, and polling when the stream is dropped", async (t) => {
  const { f, dir, lead, lt } = await setup(t);
  await f.control({ op: "activity", botId: lead.id, activity: "working" });
  let r = await runOmb(["watch", "--project", dir, "--max-seconds", "2", ...fast], { env });
  assert.equal(r.code, 4, r.stdout); assert.equal(r.json.state, "timeout"); assert.deepEqual(r.json.busy, ["Sudo"]); assert.match(r.json.brief, /running/);
  r = await runOmb(["watch", "--project", dir, "--max-seconds", "2", "--quiet-if-unchanged", ...fast], { env });
  assert.equal(r.code, 4); assert.equal(r.stdout, "", "nothing new, nothing printed");
  r = await runOmb(["watch", "--project", dir, "--max-seconds", "2", "--quiet-if-unchanged", "--brief", ...fast], { env });
  assert.equal(r.stdout, "");
  const p = runOmb(["watch", "--project", dir, "--max-seconds", "20", "--until", "change", ...fast], { env });
  await sleep(500);
  await f.control({ op: "leadSay", threadId: lt, text: "Planning now." });
  r = await p;
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.outcome, "change"); assert.equal(r.json.state, "running"); assert.equal(r.json.lead.text, "Planning now.");
  assert.ok(r.json.changes.some((c) => c.lead === "Planning now."));
  r = await runOmb(["watch", "--project", dir, "--max-seconds", "2", "--until", "change", "--quiet-if-unchanged", ...fast], { env });
  assert.equal(r.stdout, "", "the change was already reported");
  await f.control({ op: "dropStreams", enabled: true });
  const p2 = runOmb(["watch", "--project", dir, "--max-seconds", "20", ...fast], { env });
  await sleep(6500); // three stream attempts fail (0 s, 2 s, 4 s) before the card appears
  await f.control({ op: "activity", botId: lead.id, activity: "idle" });
  await f.control({ op: "card", threadId: lt, requestId: "ap", kind: "approval", text: "Contact Quill?" });
  r = await p2;
  assert.equal(r.code, 5, r.stdout); assert.equal(r.json.pollingOnly, true, "three failed streams fall back to polling"); assert.equal(r.json.state, "needs-user");
});

test("a bearer token works on the stream; --nudge sends status? once on a suspected unacknowledged delegation", async (t) => {
  const { f, dir, lead, run, lt } = await setup(t);
  await f.control({ op: "token", token: "omb_sess_client", scopes: ["client"] });
  const nova = loadState(statePaths(dir)).team.bots.find((b) => b.key === "nova");
  await f.control({ op: "leadSay", threadId: lt, text: "Delegating." });
  await sleep(50);
  await f.control({ op: "echo", threadId: lt, fromBotId: nova.id, name: "Nova 2", text: "done but the lead sleeps" });
  let r = await runOmb(["watch", "--project", dir, "--max-seconds", "12", ...fast], { env: { ...env, OMB_TOKEN: "omb_sess_client" } });
  assert.equal(r.code, 6, r.stdout + r.stderr); assert.equal(r.json.state, "stalled"); assert.match(r.json.hint, /unacknowledged/); assert.equal(r.json.pollingOnly, false);
  assert.equal((await thread(f, lt)).filter((m) => m.text === "status?").length, 0);
  r = await runOmb(["watch", "--project", dir, "--max-seconds", "4", "--nudge", ...fast], { env });
  assert.equal(r.json.nudged, true); assert.ok(r.json.changes.some((c) => c.nudged));
  assert.equal((await thread(f, lt)).filter((m) => m.text === "status?").length, 1);
  assert.ok(loadState(statePaths(dir)).task.nudgedAt);
  r = await runOmb(["watch", "--project", dir, "--max-seconds", "4", "--nudge", ...fast], { env });
  assert.equal((await thread(f, lt)).filter((m) => m.text === "status?").length, 1, "nudged once per run");
  await f.control({ op: "leadSay", threadId: lt, text: `All done.\nDONE ${run.tag}` });
  r = await runOmb(["watch", "--project", dir, "--max-seconds", "10", ...fast], { env });
  assert.equal(r.json.state, "done");
});

test("watch refuses without a dispatched run and never writes watermarks for another run", async (t) => {
  const { f, dir, run } = await setup(t);
  await updateState(statePaths(dir), (d) => { d.task.status = "preparing"; return d; });
  let r = await runOmb(["watch", "--project", dir, "--max-seconds", "2", ...fast], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /the run is preparing/);
  await updateState(statePaths(dir), (d) => { d.task.status = "dispatched"; return d; });
  const p = runOmb(["watch", "--project", dir, "--max-seconds", "3", ...fast], { env });
  await sleep(400);
  await updateState(statePaths(dir), (d) => { d.task = { ...d.task, runId: "replaced", lastEval: { state: "running", marker: "keep" } }; return d; });
  r = await p;
  assert.equal(r.code, 4);
  assert.equal(loadState(statePaths(dir)).task.lastEval.marker, "keep", "the replaced run's watermarks were left alone");
  await updateState(statePaths(dir), (d) => { d.task = null; return d; });
  r = await runOmb(["watch", "--project", dir, "--max-seconds", "2", ...fast], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /no open run/);
});

test("mergeCheckpoint takes the watch's watermarks but keeps a newer lastChangeAt and fields watch does not own", () => {
  const prior = { state: "running", lastChangeAt: 2_000, cursor: "s:1", marker: "keep", outcomes: [{ id: "old", at: 1 }] };
  const merged = mergeCheckpoint(prior, { state: "done", lastChangeAt: 1_000, cursor: "s:9", outcomes: [], evidence: { version: 1 } });
  assert.equal(merged.lastChangeAt, 2_000, "a send during the watch bumped it");
  assert.equal(merged.state, "done"); assert.equal(merged.cursor, "s:9"); assert.deepEqual(merged.outcomes, []); assert.equal(merged.marker, "keep");
  assert.equal(mergeCheckpoint(prior, { lastChangeAt: 3_000 }).lastChangeAt, 3_000);
  assert.equal(mergeCheckpoint(null, { lastChangeAt: 5 }).lastChangeAt, 5);
  assert.equal(mergeCheckpoint({ lastChangeAt: 7 }, { lastChangeAt: null }).lastChangeAt, 7);
  assert.equal(mergeCheckpoint({}, {}).lastChangeAt, null);
});

test("the watch checkpoint keeps a lastChangeAt another writer advanced", async (t) => {
  const { f, dir, lt } = await setup(t);
  const paths = statePaths(dir);
  const bumped = Date.now() + 60_000;
  await updateState(paths, (d) => { d.task.lastEval = { ...d.task.lastEval, lastChangeAt: bumped }; return d; });
  const p = runOmb(["watch", "--project", dir, "--max-seconds", "2", ...fast], { env });
  await sleep(400);
  await f.control({ op: "leadSay", threadId: lt, text: "Planning now." });
  const r = await p;
  assert.equal(r.json.checkpointed, true, r.stdout);
  assert.equal(loadState(paths).task.lastEval.lastChangeAt, bumped);
});

test("a receipts directory that cannot be watched is logged and reported, never swallowed", async (t) => {
  const { f, dir, team } = await setup(t);
  const client = createClient({ url: f.url });
  const task = loadState(statePaths(dir)).task;
  const logs = [];
  const r = await watchRun({ client, team, task, dataDir: path.join(dir, "absent-data"), maxSeconds: 0.5, quietMs: 100, log: (m) => logs.push(m) });
  assert.equal(r.receiptsWatched, false);
  assert.ok(logs.some((m) => /^receipts: ENOENT/.test(m)), logs.join("\n"));
  assert.equal((await watchRun({ client, team, task, dataDir: f.dataDir, maxSeconds: 0.5, quietMs: 100 })).receiptsWatched, true);
  const local = await runOmb(["watch", "--project", dir, "--max-seconds", "0.5", ...fast], { env });
  assert.equal(local.json.receiptsWatched, true, local.stdout);
  const remote = await runOmb(["watch", "--project", dir, "--max-seconds", "0.5", "--remote", ...fast], { env });
  assert.equal(remote.json.receiptsWatched, false, "remote observation never watches a local directory");
});

test("a deadline inside the sub-millisecond window ends the watch as a timeout, never as a thrown deadline error", async (t) => {
  const { f, dir, team } = await setup(t);
  const client = createClient({ url: f.url });
  const task = loadState(statePaths(dir)).task;
  // withinDeadline floors the remaining budget, so 0 < remaining < 1 ms already reads as out of
  // budget. watchRun's own expiry test must agree: while it did not, the guarded rethrow around
  // the stream wait escaped and `watch` exited 1 "observation deadline reached" instead of 4.
  const outcomes = [];
  for (let ms = 0.05; ms < 1; ms += 0.05) {
    outcomes.push(await watchRun({ client, team, task, deadline: performance.now() + ms }).then((r) => r.outcome, (e) => `threw: ${e.message}`));
  }
  assert.deepEqual([...new Set(outcomes)], ["timeout"], outcomes.join(", "));
  assert.equal(outOfBudget(performance.now() + 0.4), true, "less than a millisecond left is out of budget");
  assert.equal(outOfBudget(performance.now() + 50), false);
  assert.equal(outOfBudget(performance.now() - 1), true);
  assert.equal(outOfBudget(performance.now() + 50, AbortSignal.abort()), true, "an aborted signal is out of budget too");
  await assert.rejects(withinDeadline(() => "never runs", performance.now() + 0.4), /observation deadline reached/, "withinDeadline refuses the same deadline outOfBudget rejects");
});
