import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { startFake, makeRepo, runOmb, responses, ROOT, sleep } from "./helpers.mjs";
import { statePaths, loadState, updateState } from "../skills/openmausbot-launcher/scripts/lib/state.mjs";
import { relevantFrame, mergeCheckpoint, watchRun } from "../skills/openmausbot-launcher/scripts/lib/watch.mjs";
import { createClient } from "../skills/openmausbot-launcher/scripts/lib/http.mjs";
import { outOfBudget, withinDeadline } from "../skills/openmausbot-launcher/scripts/lib/snapshot.mjs";
import { run as runCli } from "../skills/openmausbot-launcher/scripts/lib/cli.mjs";
import "../skills/openmausbot-launcher/scripts/lib/verbs/run.mjs";

const PKG = path.join(ROOT, "tests", "fixtures", "dev-team.package.json");
let env = { OMB_TOKEN: "" };
const fast = ["--quiet-seconds", "1", "--drop-seconds", "1", "--poll", "1"];
const thread = async (f, id) => (await (await fetch(`${f.url}/api/threads/${id}/messages`)).json()).messages;

// Exercise the real CLI handler/output and HTTP fake, but expire observation
// only after watch has verified a snapshot and entered its idle poll wait.
// Request deadlines and the stream keep their real timers; 137 ms identifies
// the requested poll interval, which a busy run cannot shorten for quiet.
// One `polls` entry runs per idle wait (the last one repeats): it moves the
// virtual clock, and may act on the fake or the state file before it does.
async function timeoutAfterObservation(t, f, dir, flags = [], polls = [(at) => at(2000)]) {
  let now = 0; let observed = false; let poll = 0;
  const clock = t.mock.method(performance, "now", () => now);
  const setTimer = globalThis.setTimeout;
  const timer = t.mock.method(globalThis, "setTimeout", (fn, ms, ...args) => {
    if (ms !== 137) return setTimer(fn, ms, ...args);
    observed = true;
    const step = polls[Math.min(poll++, polls.length - 1)];
    return setTimer(async () => { await step((at) => { now = at; }); fn(...args); }, 0);
  });
  try {
    const r = await runCli(["watch", "--project", dir, "--url", f.url, "--data-dir", f.dataDir,
      "--max-seconds", "2", "--poll", "0.137", ...flags]);
    assert.equal(observed, true, "the deadline follows a verified observation");
    let json = null; try { json = JSON.parse(r.output); } catch {} // --brief prints a line, not JSON
    return { code: r.code, stdout: r.output, json };
  } finally { timer.mock.restore(); clock.mock.restore(); }
}

async function setup(t, { implementer = null, ...opts } = {}) {
  const f = await startFake({ heartbeatMs: 100, ...opts }); t.after(() => f.close());
  env = { OMB_TOKEN: "", OMB_DATA_DIR: f.dataDir };
  const { dir } = makeRepo();
  assert.equal((await runOmb(["import", PKG, "--project", dir, "--url", f.url], { env })).code, 0);
  assert.equal((await runOmb(["bind", "--project", dir, "--default", "claude/claude-sonnet-5"], { env })).code, 0);
  // An implementer the lead created is only this team's once it is adopted and
  // bound, and neither is allowed while a run is open — so it happens first.
  let extra = null;
  if (implementer) {
    extra = (await f.control({ op: "bot", name: implementer, title: "Implementer", section: "Dev team" })).bot;
    assert.equal((await runOmb(["import", "--adopt", "Dev team", "--project", dir, "--url", f.url], { env })).code, 0);
    assert.equal((await runOmb(["bind", "--project", dir, "--default", "claude/claude-sonnet-5"], { env })).code, 0);
  }
  const run = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  assert.equal(run.code, 0, run.stdout + run.stderr);
  const st = loadState(statePaths(dir));
  return { f, dir, lead: st.team.lead, team: st.team, run: run.json, lt: run.json.leadThreadId, extra };
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
  const saved = loadState(statePaths(dir)).runs[run.runId];
  assert.equal(saved.status, "dispatched", "watch never changes the run status");
  assert.equal(saved.lastEval.state, "done"); assert.equal(saved.lastEval.cursor, r.json.cursor); assert.equal(saved.lastEval.quietSince, null); assert.equal(saved.lastEval.outcomes.length, 2);
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
  let r = await timeoutAfterObservation(t, f, dir);
  assert.equal(r.code, 4, r.stdout); assert.equal(r.json.state, "timeout"); assert.deepEqual(r.json.busy, ["Sudo"]); assert.match(r.json.brief, /running/);
  r = await timeoutAfterObservation(t, f, dir, ["--quiet-if-unchanged"]);
  assert.equal(r.code, 4); assert.equal(r.stdout, "", "nothing new, nothing printed");
  r = await timeoutAfterObservation(t, f, dir, ["--quiet-if-unchanged", "--brief"]);
  assert.equal(r.stdout, "");
  const hydrated = responses(f, (url) => url.startsWith(`/api/threads/${lt}/messages`));
  const p = runOmb(["watch", "--project", dir, "--max-seconds", "20", "--until", "change", ...fast], { env });
  await hydrated;
  await f.control({ op: "leadSay", threadId: lt, text: "Planning now." });
  r = await p;
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.outcome, "change"); assert.equal(r.json.state, "running"); assert.equal(r.json.lead.text, "Planning now.");
  assert.ok(r.json.changes.some((c) => c.lead === "Planning now."));
  r = await timeoutAfterObservation(t, f, dir, ["--until", "change", "--quiet-if-unchanged"]);
  assert.equal(r.stdout, "", "the change was already reported");
  await f.control({ op: "dropStreams", enabled: true });
  const failedStreams = responses(f, (url) => url.startsWith("/api/events?"), 3);
  const p2 = runOmb(["watch", "--project", dir, "--max-seconds", "20", ...fast], { env });
  await failedStreams;
  await f.control({ op: "activity", botId: lead.id, activity: "idle" });
  await f.control({ op: "card", threadId: lt, requestId: "ap", kind: "approval", text: "Contact Quill?" });
  r = await p2;
  assert.equal(r.code, 5, r.stdout); assert.equal(r.json.pollingOnly, true, "three failed streams fall back to polling"); assert.equal(r.json.state, "needs-user");
});

test("a budget that ends while the quiet window is still running reports the idle time it observed", async (t) => {
  const { f, dir, lt } = await setup(t);
  await f.control({ op: "leadSay", threadId: lt, text: "Planning now." }); // quiet alone would settle this run
  const r = await timeoutAfterObservation(t, f, dir, ["--quiet-seconds", "30"]);
  assert.equal(r.code, 4, r.stdout);
  assert.equal(r.json.state, "timeout"); assert.equal(r.json.inflight, false);
  assert.equal(r.json.quietFor, 2000, "the idleness observed, not the 0 s of the read that opened the window");
  assert.deepEqual(r.json.reasons, ["idle for 2 s when the watch budget ended; the 30 s quiet window was not confirmed"]);
  assert.equal(r.json.hint, "--max-seconds 2 cannot cover the 30 s quiet window; use 35 or more");
});

test("a deadline that overran the quiet window is still a timeout: only a confirming read settles a run", async (t) => {
  const { f, dir, lt } = await setup(t);
  // Quiet enough for long enough to read as `attention`, had the ladder been re-run.
  await f.control({ op: "leadSay", threadId: lt, text: "Planning now." });
  const r = await timeoutAfterObservation(t, f, dir, ["--quiet-seconds", "30"], [(at) => at(60_000)]);
  assert.equal(r.code, 4, r.stdout);
  assert.equal(r.json.state, "timeout");
  assert.equal(r.json.quietFor, 60_000, "the elapsed idle time is reported uncapped");
  assert.deepEqual(r.json.reasons, ["idle for 60 s when the watch budget ended; the 30 s quiet window was not confirmed"]);
  assert.equal(r.json.hint, "--max-seconds 2 cannot cover the 30 s quiet window; use 35 or more", "the hint answers the budget that was asked for, not the time the deadline overran");
});

test("a timeout whose run needs more than quiet reports the idle time but promises no budget", async (t) => {
  const { f, dir, lt } = await setup(t);
  const nova = loadState(statePaths(dir)).team.bots.find((b) => b.key === "nova");
  // The lead has not woken to Nova's reply: a longer watch cannot settle this.
  await f.control({ op: "echo", threadId: lt, fromBotId: nova.id, name: "Nova", text: "implemented" });
  const r = await timeoutAfterObservation(t, f, dir, ["--quiet-seconds", "30"]);
  assert.equal(r.code, 4, r.stdout);
  assert.equal(r.json.state, "timeout"); assert.equal(r.json.outcomes, 1);
  assert.deepEqual(r.json.reasons, ["idle for 2 s when the watch budget ended; the 30 s quiet window was not confirmed"], "the idle time is still the truth");
  assert.equal(r.json.hint, undefined, "but the quiet window is not what this run is waiting for");
});

test("an own frame during the wait restarts the quiet window, and the timeout counts idle time from the restart", async (t) => {
  const { f, dir, lt } = await setup(t);
  const r = await timeoutAfterObservation(t, f, dir, ["--quiet-seconds", "30"], [
    async (at) => { at(1000); await f.control({ op: "leadSay", threadId: lt, text: "Planning now." }); },
    (at) => at(2000),
  ]);
  assert.equal(r.code, 4, r.stdout);
  assert.equal(r.json.state, "timeout"); assert.equal(r.json.elapsedSec, 2);
  assert.equal(r.json.quietFor, 1000, "the lead's own message restarted the window");
  assert.deepEqual(r.json.reasons, ["idle for 1 s when the watch budget ended; the 30 s quiet window was not confirmed"]);
});

test("an unverified timeout reports no observed quiet and no budget hint", async (t) => {
  // No keepalive during the second watch: a frame in flight at the deadline is
  // an invalidation of its own, and this test is about the checkpoint wait.
  const { f, dir, team, run } = await setup(t, { heartbeatMs: 30_000 });
  // The run's own record changes under the watch: the deadline arrives with nothing verified.
  const r = await timeoutAfterObservation(t, f, dir, ["--quiet-seconds", "30"], [async (at) => {
    await updateState(statePaths(dir), (d) => { d.runs[run.runId].cards = { "req-1": "Nova" }; return d; });
    at(2000);
  }]);
  assert.equal(r.code, 4, r.stdout);
  assert.equal(r.json.state, "timeout"); assert.equal(r.json.complete, false);
  assert.equal(r.json.quietFor, 0); assert.equal(r.json.hint, undefined);
  assert.deepEqual(r.json.reasons, ["observation deadline reached before verification"]);
  // And an invalidation during the checkpoint wait clears the marker the
  // timeout set: reaching the deadline in the idle wait is a boundary, so the
  // watch arrives at its checkpoint with the observation it verified.
  const live = loadState(statePaths(dir)).runs[run.runId];
  const r2 = await watchRun({ client: createClient({ url: f.url }), team, task: live, runs: [live], getRuns: () => [live],
    maxSeconds: 3, quietMs: 30_000, checkpoint: async () => { live.cards = { "req-2": "Nova" }; return true; } });
  assert.equal(r2.outcome, "timeout"); assert.equal(r2.snap.complete, false);
  assert.equal(r2.ev.awaitingQuiet, false, JSON.stringify(r2.ev)); assert.equal(r2.ev.quietFor, 0);
  assert.deepEqual(r2.ev.reasons, ["observation deadline reached before checkpoint verification"]);
});

test("watchBudgetHint names the budget a quiet window needs, and asks for one more call when the budget was nominally enough", async (t) => {
  const { watchBudgetHint } = await import("../skills/openmausbot-launcher/scripts/lib/watch.mjs");
  assert.equal(watchBudgetHint({ maxSeconds: 8, quietSeconds: 30, idleSeconds: 8 }), "--max-seconds 8 cannot cover the 30 s quiet window; use 35 or more");
  assert.equal(watchBudgetHint({ maxSeconds: 30, quietSeconds: 30, idleSeconds: 29 }), "--max-seconds 30 cannot cover the 30 s quiet window; use 35 or more", "an equal budget leaves nothing for hydration");
  assert.equal(watchBudgetHint({ maxSeconds: 35, quietSeconds: 30, idleSeconds: 29 }), "the 30 s quiet window was not confirmed in this watch (29 s idle observed); call watch again, with a larger --max-seconds if this repeats", "quiet + 5 is headroom, not a guarantee");
  assert.equal(watchBudgetHint({ maxSeconds: 35, quietSeconds: 30, idleSeconds: 20 }), "the 30 s quiet window was not confirmed in this watch (20 s idle observed); call watch again, with a larger --max-seconds if this repeats", "a budget setup consumed still gets guidance");
  const { f, dir, lt } = await setup(t);
  await f.control({ op: "leadSay", threadId: lt, text: "Planning now." });
  const brief = await timeoutAfterObservation(t, f, dir, ["--quiet-seconds", "30", "--brief"]);
  assert.match(brief.stdout, /watch timed out after 2s, call again · --max-seconds 2 cannot cover the 30 s quiet window; use 35 or more$/);
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
  assert.ok(loadState(statePaths(dir)).runs[run.runId].nudgedAt);
  r = await runOmb(["watch", "--project", dir, "--max-seconds", "4", "--nudge", ...fast], { env });
  assert.equal((await thread(f, lt)).filter((m) => m.text === "status?").length, 1, "nudged once per run");
  await f.control({ op: "leadSay", threadId: lt, text: `All done.\nDONE ${run.tag}` });
  r = await runOmb(["watch", "--project", dir, "--max-seconds", "10", ...fast], { env });
  assert.equal(r.json.state, "done");
});

test("watch refuses without a dispatched run and never writes watermarks for another run", async (t) => {
  const { f, dir, run } = await setup(t);
  await updateState(statePaths(dir), (d) => { d.runs[run.runId].status = "preparing"; return d; });
  let r = await runOmb(["watch", "--project", dir, "--max-seconds", "2", ...fast], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /the run is preparing/);
  await updateState(statePaths(dir), (d) => { d.runs[run.runId].status = "dispatched"; return d; });
  const p = runOmb(["watch", "--project", dir, "--max-seconds", "3", ...fast], { env });
  await sleep(400);
  await updateState(statePaths(dir), (d) => { d.runs = { replaced: { ...d.runs[run.runId], runId: "replaced", lastEval: { state: "running", marker: "keep" } } }; return d; });
  r = await p;
  assert.equal(r.code, 4);
  assert.equal(loadState(statePaths(dir)).runs.replaced.lastEval.marker, "keep", "the replaced run's watermarks were left alone");
  await updateState(statePaths(dir), (d) => { d.runs = {}; return d; });
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

test("mergeCards forgets an answered card only when the observation was complete", async () => {
  const { mergeCards } = await import("../skills/openmausbot-launcher/scripts/lib/watch.mjs");
  assert.deepEqual(mergeCards({ a: true, b: true }, { b: true }, true), { b: true }, "a complete read is the whole truth: a settled card is forgotten");
  assert.deepEqual(mergeCards({ a: true, b: true }, { b: true }, false), { a: true, b: true }, "an incomplete read never drops a remembered owner");
  assert.deepEqual(mergeCards({ a: true }, { b: true }, false), { a: true, b: true }, "and still records what it did see");
  assert.deepEqual(mergeCards(undefined, {}, true), {});
  assert.deepEqual(mergeCards(undefined, { a: true }, false), { a: true });
});

test("the watch checkpoint keeps a lastChangeAt another writer advanced", async (t) => {
  const { f, dir, lt, run } = await setup(t);
  const paths = statePaths(dir);
  const bumped = Date.now() + 60_000;
  await updateState(paths, (d) => { d.runs[run.runId].lastEval = { ...d.runs[run.runId].lastEval, lastChangeAt: bumped }; return d; });
  // The message only has to land while the watch is running, so wait for the
  // hydration that proves it is, not for an estimate of how long that takes.
  const hydrated = responses(f, (url) => url.startsWith(`/api/threads/${lt}/messages`));
  const p = runOmb(["watch", "--project", dir, "--max-seconds", "20", ...fast], { env });
  await hydrated;
  await f.control({ op: "leadSay", threadId: lt, text: "Planning now." });
  const r = await p;
  assert.equal(r.json.state, "attention", r.stdout); // the watch returns at its verdict, not at its budget
  assert.equal(r.json.checkpointed, true, r.stdout);
  assert.equal(loadState(paths).runs[run.runId].lastEval.lastChangeAt, bumped);
});

test("a receipts directory that cannot be watched is logged and reported, never swallowed", async (t) => {
  const { f, dir, team, run } = await setup(t);
  const client = createClient({ url: f.url });
  const task = loadState(statePaths(dir)).runs[run.runId];
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
  const { f, dir, team, run } = await setup(t);
  const client = createClient({ url: f.url });
  const task = loadState(statePaths(dir)).runs[run.runId];
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

test("frameScope separates a frame that concerns the team from one that concerns this run", async () => {
  const { ownFrame } = await import("../skills/openmausbot-launcher/scripts/lib/watch.mjs");
  const ctx = { botIds: new Set(["lead", "nova"]), threadIds: new Set(["lt", "nt"]) };
  assert.equal(ownFrame({ data: { kind: "message", threadId: "lt" } }, ctx), true);
  assert.equal(ownFrame({ data: { kind: "message", threadId: "other" } }, ctx), false);
  assert.equal(ownFrame({ data: { kind: "message.patch", threadId: "nt" } }, ctx), true);
  assert.equal(ownFrame({ data: { kind: "bot", bot: { id: "nova" } } }, ctx), true);
  assert.equal(ownFrame({ data: { kind: "bot", bot: { id: "vex" } } }, ctx), false);
  assert.equal(ownFrame({ data: { kind: "notify", notification: { botId: "lead" } } }, ctx), true);
  assert.equal(ownFrame({ data: { kind: "notify", notification: { threadId: "other" } } }, ctx), false);
  assert.equal(ownFrame({ data: { kind: "hello", resumed: false } }, ctx), true, "a gap in the stream is everybody's");
  assert.equal(ownFrame({ data: { kind: "ping" } }, ctx), false);
});

test("watch --run settles one run while the other keeps a second implementer busy on the active task", async (t) => {
  const { f, dir, lead, run: a, extra: vex } = await setup(t, { implementer: "Vex" });
  const b = await runOmb(["task", "--todo", "T11", "--project", dir], { env });
  assert.equal(b.code, 0, b.stdout + b.stderr);
  assert.equal((await (await fetch(`${f.url}/api/bots`)).json()).bots.find((x) => x.id === lead.id).threadId, b.json.leadThreadId, "B's task is the active one");
  // B is in full swing: its implementer works and its thread never stops moving
  await f.control({ op: "delegated", threadId: b.json.leadThreadId, name: "Vex" });
  await f.control({ op: "activity", botId: vex.id, activity: "working" });
  await f.control({ op: "leadSay", threadId: a.leadThreadId, text: `Closing report: merged as 1234567.\n\nDONE ${a.tag}` });
  let flip = false;
  const noise = setInterval(() => {
    flip = !flip;
    void f.control({ op: "activity", botId: vex.id, activity: flip ? "working" : "idle" }).catch(() => {});
    void f.control({ op: "leadSay", threadId: b.json.leadThreadId, text: "still working" }).catch(() => {});
  }, 200);
  t.after(() => clearInterval(noise));
  const r = await runOmb(["watch", "--run", "t10", "--project", dir, "--max-seconds", "12", ...fast], { env });
  clearInterval(noise);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.json.state, "done", "the other run's traffic never reset this run's quiet window");
  assert.ok(r.json.elapsedSec < 10, `settled in ${r.json.elapsedSec}s`);
  const saved = loadState(statePaths(dir));
  assert.equal(saved.runs[a.runId].lastEval.state, "done");
  assert.equal(saved.runs[b.json.runId].lastEval.state, "running", "the other run's watermarks were left alone");
});

test("the lead's frames for the other run's turns do not restart this run's quiet window", async (t) => {
  const { f, dir, lead, run: a } = await setup(t, { implementer: "Vex" });
  const b = await runOmb(["task", "--todo", "T11", "--project", dir], { env });
  assert.equal(b.code, 0, b.stdout);
  // the runtime log says the turn the lead is running belongs to T11
  await f.control({ op: "event", threadId: a.leadThreadId, event: { turnId: "a1", type: "turn.completed", createdAt: new Date().toISOString() } });
  await f.control({ op: "event", threadId: b.json.leadThreadId, event: { turnId: "b1", type: "turn.started", createdAt: new Date().toISOString() } });
  await f.control({ op: "leadSay", threadId: a.leadThreadId, text: `Closing report: merged as 1234567.\n\nDONE ${a.tag}` });
  let flip = false;
  const noise = setInterval(() => { flip = !flip; void f.control({ op: "activity", botId: lead.id, activity: flip ? "working" : "idle" }).catch(() => {}); }, 200);
  t.after(() => clearInterval(noise));
  const r = await runOmb(["watch", "--run", "t10", "--project", dir, "--max-seconds", "12", ...fast], { env });
  clearInterval(noise);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.json.state, "done", "the lead's work on T11 never reset T10's quiet");
  assert.ok(r.json.elapsedSec < 10, `settled in ${r.json.elapsedSec}s`);
});
