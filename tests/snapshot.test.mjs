import test from "node:test";
import assert from "node:assert/strict";
import { startFake, makeRepo, runOmb, ROOT } from "./helpers.mjs";
import path from "node:path";
import { statePaths, loadState, updateState } from "../skills/openmausbot-launcher/scripts/lib/state.mjs";
import { createClient } from "../skills/openmausbot-launcher/scripts/lib/http.mjs";
import { snapshot, evaluate, brief, isLeadText, isEcho, messageNeedsInput, dispatchFailedAfterLatestUser, markerRe, summarize, evidenceOf } from "../skills/openmausbot-launcher/scripts/lib/snapshot.mjs";

const PKG = path.join(ROOT, "tests", "fixtures", "dev-team.package.json");
const LEAD = "lead1";
const T0 = 1_000_000_000;
const task = { runId: "r1", tag: "oml:abcd1234", sentAt: T0, slug: "T10", title: "T10", leadThreadId: "lt" };

/** A complete, idle snapshot to start from. */
function snap(over = {}) {
  return {
    complete: true, incomplete: [], bots: [{ id: LEAD, name: "Sudo", busy: false, activity: "idle" }, { id: "nova", name: "Nova", busy: false, activity: "idle" }],
    lead: { id: LEAD, name: "Sudo", busy: false, activity: "idle" }, teamMap: { queued: [], running: [] }, leadThreadId: "lt", leadTail: [],
    leadText: null, lastUser: { id: "u1", at: T0, text: "Sudo, do T10" }, outcomes: [], pending: [], markerSeen: null, dispatchFailed: false, receipts: { supported: true, forRun: 0 }, ...over,
  };
}
const quietSince = (s) => ({ quiet: { since: T0 + s * 1000 } });

test("classifier mirrors: lead text, echoes, needs-input, dispatch failure, marker, summarize", () => {
  assert.equal(isLeadText({ role: "bot", kind: "text", text: "hi" }, LEAD), true);
  assert.equal(isLeadText({ role: "bot", kind: "text", text: "@Nova 2 replied to the delegated task:\n\nok", from: { botId: "nova" } }, LEAD), false);
  assert.equal(isLeadText({ role: "bot", kind: "text", text: "in a room", from: { botId: LEAD } }, LEAD), true);
  assert.equal(isEcho({ role: "bot", kind: "text", text: "@Nova 2 replied to the delegated task:\n\nok", from: { botId: "nova", name: "Nova 2" } }, LEAD), true);
  assert.equal(isEcho({ role: "bot", kind: "text", text: "plain", from: { botId: "nova" } }, LEAD), false);
  assert.equal(messageNeedsInput({ card: { requestId: "r", answered: false, dismissed: false } }), true);
  assert.equal(messageNeedsInput({ card: { requestId: "r", answered: true } }), false);
  assert.equal(messageNeedsInput({ connector: { status: "pending", dismissed: false, resumed: false } }), true);
  assert.equal(messageNeedsInput({ secret: { provided: false, dismissed: false } }), true);
  const err = { role: "bot", kind: "activity", tool: { name: "error: refused", ok: false } };
  assert.equal(dispatchFailedAfterLatestUser([{ role: "user" }, err]), true);
  assert.equal(dispatchFailedAfterLatestUser([{ role: "user" }, err, { role: "bot", kind: "text", text: "recovered" }]), false, "a later bot text clears it");
  assert.equal(dispatchFailedAfterLatestUser([err, { role: "user" }]), false, "only after the latest user message");
  assert.equal(markerRe("oml:abcd1234").test("Closing report…\nDONE oml:abcd1234\n"), true);
  assert.equal(markerRe("oml:abcd1234").test("I will write DONE oml:abcd1234 later"), false, "the marker must be its own line");
  assert.equal(markerRe("oml:abcd1234").test("DONE oml:ffffffff"), false);
  assert.equal(summarize("a\n```\ncode\n```\n b   c", 10), "a b c");
});

test("evaluate: the state table", () => {
  const now = T0 + 120_000;
  const leadSaid = (text, at = T0 + 90_000, extra = {}) => ({ leadText: { id: "m9", at, text }, ...extra });
  // incomplete snapshots never reach a terminal state
  let ev = evaluate(snap({ complete: false, incomplete: ["bots: boom"], markerSeen: { id: "m9", at: T0 + 90_000 }, ...leadSaid("DONE oml:abcd1234") }), task, { now, ...quietSince(60) });
  assert.equal(ev.state, "running"); assert.equal(ev.unknown, true);
  // pending input wins over everything
  ev = evaluate(snap({ pending: [{ botId: "nova", botName: "Nova", kind: "card", requestId: "rq", cardKind: "approval", text: "Contact Quill?" }], dispatchFailed: true, lead: { id: LEAD, name: "Sudo", activity: "dead" } }), task, { now, ...quietSince(60) });
  assert.equal(ev.state, "needs-user"); assert.match(brief(ev, snap(ev), task, now), /APPROVAL · Nova: "Contact Quill\?" \(request rq\) → omb answer --allow --request rq/);
  ev = evaluate(snap({ bots: [{ id: LEAD, name: "Sudo", busy: true, activity: "waiting-on-you" }], pending: [{ botId: LEAD, botName: "Sudo", kind: "waiting", text: "Sudo is waiting on you" }] }), task, { now });
  assert.equal(ev.state, "needs-user");
  // dead lead
  ev = evaluate(snap({ lead: { id: LEAD, name: "Sudo", activity: "dead" } }), task, { now, ...quietSince(60) });
  assert.equal(ev.state, "failed");
  // busy, queued, running keep it running; quiet resets
  ev = evaluate(snap({ bots: [{ id: LEAD, name: "Sudo", busy: false, activity: "idle" }, { id: "nova", name: "Nova", busy: true, activity: "working" }] }), task, { now, ...quietSince(60) });
  assert.equal(ev.state, "running"); assert.equal(ev.inflight, true); assert.deepEqual(ev.busy, ["Nova"]);
  ev = evaluate(snap({ teamMap: { queued: [{ sourceBotId: LEAD, targetBotId: "nova" }], running: [] } }), task, { now, ...quietSince(60) });
  assert.equal(ev.state, "running"); assert.match(ev.reasons[0], /queued 1/);
  ev = evaluate(snap(leadSaid("DONE oml:abcd1234", T0 + 90_000, { markerSeen: { id: "m9", at: T0 + 90_000 } })), task, { now, quiet: { since: T0 + 100_000 } });
  assert.equal(ev.state, "running", "20 s of quiet is not settled"); assert.match(ev.reasons[0], /idle for 20 s/);
  // quiet + dispatch failure
  ev = evaluate(snap({ dispatchFailed: true }), task, { now, ...quietSince(60) });
  assert.equal(ev.state, "failed");
  // an outcome newer than the lead's last text: awaiting the wake, then stalled
  const echo = { id: "e1", at: T0 + 100_000, kind: "echo", name: "Nova 2", ok: true };
  ev = evaluate(snap({ outcomes: [echo], ...leadSaid("Delegating…", T0 + 10_000) }), task, { now: T0 + 160_000, quiet: { since: T0 + 110_000 } });
  assert.equal(ev.state, "running"); assert.match(ev.reasons[0], /awaits the lead's wake/);
  ev = evaluate(snap({ outcomes: [echo], ...leadSaid("Delegating…", T0 + 10_000) }), task, { now: T0 + 300_000, quiet: { since: T0 + 110_000 } });
  assert.equal(ev.state, "stalled"); assert.match(ev.hint, /suspected unacknowledged delegation/);
  assert.match(brief(ev, snap({ outcomes: [echo], ...leadSaid("Delegating…", T0 + 10_000) }), task, T0 + 300_000), /STALLED · echo from Nova 2/);
  // done: last lead text carries the marker, newer than outcomes, dispatch, and the user
  const done = snap({ outcomes: [echo], ...leadSaid("Closing report: merged as abc1234\nDONE oml:abcd1234", T0 + 110_000, { markerSeen: { id: "m9", at: T0 + 110_000 } }) });
  ev = evaluate(done, task, { now: T0 + 200_000, quiet: { since: T0 + 120_000 } });
  assert.equal(ev.state, "done"); assert.match(brief(ev, done, task, T0 + 200_000), /^T10 · DONE after 3m · Sudo: "Closing report: merged as abc1234 DONE oml:abcd1234"/);
  // attention: settled without the marker; a previous run's marker; the marker inside a sentence
  ev = evaluate(snap({ outcomes: [echo], ...leadSaid("BLOCKED: the premise fails", T0 + 110_000) }), task, { now: T0 + 200_000, quiet: { since: T0 + 120_000 } });
  assert.equal(ev.state, "attention"); assert.match(brief(ev, snap(), task, T0 + 200_000), /ATTENTION · settled without the run marker/);
  ev = evaluate(snap({ ...leadSaid("DONE oml:00000000", T0 + 110_000) }), task, { now: T0 + 200_000, quiet: { since: T0 + 120_000 } });
  assert.equal(ev.state, "attention", "another run's marker does not count");
  ev = evaluate(snap({ ...leadSaid("I will end with DONE oml:abcd1234 when finished", T0 + 110_000) }), task, { now: T0 + 200_000, quiet: { since: T0 + 120_000 } });
  assert.equal(ev.state, "attention", "the marker inside a sentence does not count");
  // a marker in an earlier text followed by a later lead text without it
  ev = evaluate(snap({ markerSeen: { id: "m8", at: T0 + 100_000 }, ...leadSaid("one more thing", T0 + 110_000) }), task, { now: T0 + 200_000, quiet: { since: T0 + 120_000 } });
  assert.equal(ev.state, "attention");
  // the user asked after the lead's last text: running, then stalled by the stall window
  ev = evaluate(snap({ ...leadSaid("Which approach?", T0 + 50_000), lastUser: { id: "u2", at: T0 + 60_000, text: "use the table" } }), task, { now: T0 + 200_000, quiet: { since: T0 + 120_000 }, lastChangeAt: T0 + 60_000 });
  assert.equal(ev.state, "running"); assert.match(ev.reasons[0], /not answered the latest message/);
  ev = evaluate(snap({ ...leadSaid("Which approach?", T0 + 50_000), lastUser: { id: "u2", at: T0 + 60_000, text: "use the table" } }), task, { now: T0 + 60_000 + 41 * 60_000, quiet: { since: T0 + 120_000 }, lastChangeAt: T0 + 60_000 });
  assert.equal(ev.state, "stalled");
  // no-signal lead; a busy bot never stalls the wake check
  ev = evaluate(snap({ lead: { id: LEAD, name: "Sudo", activity: "no-signal" }, bots: [{ id: LEAD, name: "Sudo", busy: true, activity: "no-signal" }] }), task, { now, lastChangeAt: T0 });
  assert.equal(ev.state, "stalled"); assert.match(ev.reasons[0], /no signal/);
  // the lead has not spoken since the dispatch and 30 s of quiet: attention would be wrong, it is still running until the stall window
  ev = evaluate(snap(), task, { now, ...quietSince(60), lastChangeAt: T0 });
  assert.equal(ev.state, "running"); assert.match(ev.reasons[0], /not answered the latest message|has not spoken since the dispatch/);
});

test("snapshot against the fake: team bots, discovered specialists, tails, outcomes, pending, marker, receipts", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const env = { OMB_TOKEN: "", OMB_DATA_DIR: f.dataDir };
  const { dir } = makeRepo();
  assert.equal((await runOmb(["import", PKG, "--project", dir, "--url", f.url], { env })).code, 0);
  const st = loadState(statePaths(dir));
  const team = st.team; const lead = team.lead; const nova = team.bots.find((b) => b.key === "nova");
  const client = createClient({ url: f.url });
  // a run: fresh thread on the lead, brief sent, work happening
  const threadId = (await client.post(`/api/bots/${lead.id}/tasks`, { title: "T10 [oml:abcd1234]" })).task.threadId;
  const sent = await client.post(`/api/bots/${lead.id}/messages`, { text: "Sudo, do T10.\n\nEnd with DONE oml:abcd1234", threadId, sendId: "task-r1" });
  const t0 = sent.message.at;
  const run = { runId: "r1", tag: "oml:abcd1234", sentAt: t0, leadThreadId: threadId, threads: { [lead.id]: threadId, [nova.id]: nova.threadId ?? undefined }, slug: "T10", title: "T10", status: "dispatched" };
  await f.control({ op: "activity", botId: nova.id, activity: "working" });
  await f.control({ op: "bot", name: "Extra", title: "Helper", section: "Dev team" });
  await f.control({ op: "leadSay", threadId, text: "Delegating the plan to Sage." });
  await f.control({ op: "echo", threadId, fromBotId: nova.id, name: "Nova", text: "implemented" });
  await f.control({ op: "delegationActivity", threadId, name: "Quill", variant: "failed", reason: "sandbox" });
  await f.control({ op: "receipt", sourceThreadId: threadId, toBotName: "Nova", status: "completed" });
  await f.control({ op: "receipt", sourceThreadId: "other-thread", toBotName: "Nobody", status: "completed" });
  await f.control({ op: "running", sourceBotId: lead.id, targetBotId: nova.id, threadId: "x" });
  const novaThread = (await client.get("/api/bots?messages=0")).bots.find((b) => b.id === nova.id).threadId;
  run.threads[nova.id] = novaThread;
  await f.control({ op: "card", threadId: novaThread, requestId: "rq1", kind: "approval", text: "May Nova contact Quill?" });
  let s = await snapshot(client, { team, task: run }, { dataDir: f.dataDir });
  assert.equal(s.complete, true, s.incomplete.join("; "));
  assert.equal(s.bots.length, 6); assert.equal(s.bots.find((b) => b.name === "Extra").discovered, true);
  assert.deepEqual(s.bots.filter((b) => b.busy).map((b) => b.name), ["Nova"]);
  assert.equal(s.teamMap.running.length, 1);
  assert.equal(s.leadText.text, "Delegating the plan to Sage.");
  assert.equal(s.lastUser.text.startsWith("Sudo, do T10."), true);
  assert.deepEqual(s.outcomes.map((o) => [o.kind, o.name]), [["echo", "Nova"], ["delegation", "Quill"], ["receipt", "Nova"]]);
  assert.equal(s.receipts.forRun, 1, "receipts are scoped to the run thread");
  assert.deepEqual(s.pending.map((p) => [p.botName, p.kind, p.requestId]), [["Nova", "card", "rq1"]]);
  assert.equal(s.markerSeen, null);
  let ev = evaluate(s, run, { now: Date.now(), quiet: { since: null } });
  assert.equal(ev.state, "needs-user");
  // answer the card, finish, and see done after quiet
  await client.post(`/api/threads/${novaThread}/respond`, { requestId: "rq1", behavior: "allow" });
  await f.control({ op: "activity", botId: nova.id, activity: "idle" });
  await f.control({ op: "clearDelegations" });
  await f.control({ op: "leadSay", threadId, text: "Closing report: merged as 1234567.\n\nDONE oml:abcd1234" });
  s = await snapshot(client, { team, task: run }, { dataDir: f.dataDir });
  assert.equal(s.pending.length, 0); assert.ok(s.markerSeen); assert.equal(s.markerSeen.id, s.leadText.id);
  ev = evaluate(s, run, { now: Date.now() + 60_000, quiet: { since: Date.now() } });
  assert.equal(ev.state, "done", ev.reasons.join("; "));
  // paging: many messages after the lead's last text still find it
  for (let i = 0; i < 45; i++) await f.control({ op: "userSay", threadId, text: `note ${i}` });
  s = await snapshot(client, { team, task: run }, { dataDir: f.dataDir });
  assert.equal(s.leadText.text.startsWith("Closing report"), true, "paged back to the lead's last text");
  assert.equal(s.lastUser.text, "note 44");
  // an incomplete snapshot when a thread read fails
  const badRun = { ...run, threads: { ...run.threads, ghost: "no-such-thread" } };
  s = await snapshot(client, { team, task: badRun }, { dataDir: f.dataDir });
  assert.equal(s.complete, true, "an unknown thread reads as empty, not as an error");
  await f.control({ op: "dropStreams", enabled: false });
  f.server.closeAllConnections?.();
  await f.close();
  s = await snapshot(client, { team, task: run }, { dataDir: f.dataDir });
  assert.equal(s.complete, false); assert.ok(s.incomplete.length >= 1);
});

test("status --tail shows a standalone send's reply without creating or classifying a task", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const env = { OMB_TOKEN: "", OMB_DATA_DIR: f.dataDir };
  const { dir } = makeRepo();
  assert.equal((await runOmb(["import", PKG, "--project", dir, "--url", f.url], { env })).code, 0);
  const empty = await runOmb(["status", "--tail", "1", "--project", dir], { env });
  assert.equal(empty.code, 0, empty.stdout);
  assert.equal(empty.json.lead, null); assert.equal(empty.json.lastUser, null); assert.deepEqual(empty.json.tail, []);
  const sent = await runOmb(["send", "Reply with M1 transport ACK", "--project", dir], { env });
  assert.equal(sent.code, 0, sent.stdout);
  const reply = await f.control({ op: "leadSay", threadId: sent.json.threadId, text: "M1 transport ACK" });
  const status = await runOmb(["status", "--tail", "1", "--project", dir], { env });
  assert.equal(status.code, 0, status.stdout);
  assert.equal(status.json.run, null); assert.equal(status.json.complete, true);
  assert.equal(status.json.lead.id, reply.message.id); assert.equal(status.json.lead.text, "M1 transport ACK");
  assert.equal(status.json.lastUser.id, sent.json.messageId); assert.equal(status.json.lastUser.text, "Reply with M1 transport ACK");
  assert.deepEqual(status.json.tail.map(m => [m.id, m.role, m.text]), [[reply.message.id, "bot", "M1 transport ACK"]]);
  assert.equal(status.json.state, undefined, "a standalone reply is not a task completion verdict");
  assert.deepEqual(loadState(statePaths(dir)).runs, {});
  const plain = await runOmb(["status", "--project", dir], { env });
  assert.equal(plain.json.lead.text, "M1 transport ACK"); assert.equal(plain.json.tail, undefined);
});

test("status: without a run, with a dispatched run, and carrying a terminal verdict", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const env = { OMB_TOKEN: "", OMB_DATA_DIR: f.dataDir };
  const { dir } = makeRepo();
  assert.equal((await runOmb(["import", PKG, "--project", dir, "--url", f.url], { env })).code, 0);
  let r = await runOmb(["status", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.run, null); assert.match(r.stdout, /"busy":\[\]/);
  const st = loadState(statePaths(dir)); const lead = st.team.lead;
  const client = createClient({ url: f.url });
  const threadId = (await client.post(`/api/bots/${lead.id}/tasks`, { title: "T10 [oml:abcd1234]" })).task.threadId;
  const sent = await client.post(`/api/bots/${lead.id}/messages`, { text: "go", threadId, sendId: "s" });
  await updateState(statePaths(dir), (d) => { d.runs.r1 = { runId: "r1", status: "dispatched", tag: "oml:abcd1234", sentAt: sent.message.at, leadThreadId: threadId, threads: { [lead.id]: threadId }, slug: "T10", title: "T10" }; return d; });
  await f.control({ op: "activity", botId: lead.id, activity: "working" });
  r = await runOmb(["status", "--project", dir, "--brief"], { env });
  assert.match(r.stdout, /^T10 · running .* · Sudo working/);
  await f.control({ op: "activity", botId: lead.id, activity: "idle" });
  await f.control({ op: "leadSay", threadId, text: "Closing report.\nDONE oml:abcd1234" });
  r = await runOmb(["status", "--project", dir, "--bots", "--tail", "3"], { env });
  assert.equal(r.json.state, "running", "one snapshot cannot settle"); assert.equal(r.json.bots.length, 5); assert.equal(r.json.tail.length, 2);
  assert.equal(r.json.carried, false);
  const s = await snapshot(client, { team: st.team, task: loadState(statePaths(dir)).runs.r1 }, {});
  await updateState(statePaths(dir), (d) => { d.runs.r1.lastEval = { state: "done", lastLeadMessageId: s.leadText.id, outcomes: [], quietSince: Date.now() - 60_000, lastChangeAt: Date.now() - 60_000 }; return d; });
  r = await runOmb(["status", "--project", dir], { env });
  assert.equal(r.json.state, "running", "legacy watermarks lack sufficient evidence to carry done");
  await updateState(statePaths(dir), (d) => { d.runs.r1.lastEval.evidence = evidenceOf(s); return d; });
  r = await runOmb(["status", "--project", dir], { env });
  assert.equal(r.json.state, "done"); assert.match(r.json.reasons[0], /from the last watch/);
  assert.equal(r.json.carried, true);
  const rep = await runOmb(["report", "--project", dir, "--no-tests", "--no-close"], { env });
  assert.equal(rep.code, 0, rep.stdout); assert.equal(rep.json.state, "done"); assert.equal(rep.json.carried, true);
  await f.control({ op: "leadSay", threadId, text: "one more thing" });
  r = await runOmb(["status", "--project", dir], { env });
  assert.equal(r.json.state, "running", "new lead text drops the carried verdict");
});

// ── attribution: which run is a busy bot, an open delegation or a card about? ──
import { openDelegations, snapshot as snapshotRuns } from "../skills/openmausbot-launcher/scripts/lib/snapshot.mjs";

const chip = (name, at = T0 + 1000) => ({ id: `c${at}`, at, role: "bot", kind: "activity", tool: { name } });
const echoOf = (name, at) => ({ id: `e${at}`, at, role: "bot", kind: "text", from: { botId: "x", name }, text: `@${name} replied to the delegated task:\n\nok` });

test("openDelegations counts the queued chips and settles them, and never guesses in the dark", () => {
  const one = openDelegations([chip("Delegated to @Nova: implement T10")], T0);
  assert.deepEqual(one, { byName: { Nova: 1 }, total: 1, unknown: false });
  assert.equal(openDelegations([chip("Delegated to @Nova"), chip("Delegated to @Nova", T0 + 2000)], T0).total, 2, "a repeated target counts twice");
  assert.equal(openDelegations([chip("Delegated to @Nova"), echoOf("Nova", T0 + 2000)], T0).total, 0, "the reply settles it");
  for (const terminal of ["Delegation to @Nova completed without a text reply", "Delegation to @Nova failed — the delegated turn did not finish", "Delegation to @Nova canceled — still busy after 3 retries", "Delegation to @Nova denied by user", "error: delegation to @Nova could not start — no provider"]) {
    assert.equal(openDelegations([chip("Delegated to @Nova"), chip(terminal, T0 + 2000)], T0).total, 0, terminal);
  }
  assert.equal(openDelegations([chip("Delegated to @Nova"), chip("Delegation to @Nova waiting — they're busy (retry 1/3 when they finish)", T0 + 2000)], T0).total, 1, "a busy retry settles nothing");
  assert.equal(openDelegations([chip("@Nova is still working — ask converted to a delegation")], T0).total, 1, "an ask that became a delegation is one too");
  const renamed = openDelegations([chip("Delegated to @Nova"), chip("Delegation to @Nova 2 completed without a text reply", T0 + 2000)], T0);
  assert.deepEqual(renamed, { byName: { Nova: 1 }, total: 1, unknown: true }, "an unmatched settlement leaves the count open and says so");
  assert.equal(openDelegations([chip("error: delegation failed — boom")], T0).unknown, true, "a failure chip with no name is an unknown");
  assert.deepEqual(openDelegations([chip("Delegated to @Nova"), chip("Delegated to @Quill"), chip("2 queued delegations dropped — the turn did not finish", T0 + 2000)], T0).byName, {}, "the drop chip empties the queue");
  assert.equal(openDelegations([chip("Delegated to @Nova", T0 - 1000)], T0).total, 0, "chips from before the dispatch are another run's");
  assert.deepEqual(openDelegations(null), { byName: {}, total: 0, unknown: false });
});

test("evaluate treats a run's own open delegation as inflight", () => {
  const s = snap({ leadTail: [chip("Delegated to @Nova")], openDelegations: { byName: { Nova: 1 }, total: 1, unknown: false }, leadText: { id: "m9", at: T0 + 90_000, text: "Delegating.\nDONE oml:abcd1234" }, markerSeen: { id: "m9", at: T0 + 90_000 } });
  const ev = evaluate(s, task, { now: T0 + 200_000, quiet: { since: T0 + 120_000 } });
  assert.equal(ev.inflight, true); assert.equal(ev.state, "running");
  assert.match(ev.reasons[0], /1 delegation\(s\) open/);
  assert.equal(evaluate({ ...s, openDelegations: { byName: {}, total: 0, unknown: false } }, task, { now: T0 + 200_000, quiet: { since: T0 + 120_000 } }).state, "done");
});

/** The lead's extra implementer, recorded and bound the way the skill says. */
async function addImplementer(f, dir, env, name = "Vex") {
  const bot = (await f.control({ op: "bot", name, title: "Implementer", section: "Dev team" })).bot;
  assert.equal((await runOmb(["import", "--adopt", "Dev team", "--project", dir, "--url", f.url], { env })).code, 0);
  assert.equal((await runOmb(["bind", "--project", dir, "--default", "claude/claude-sonnet-5"], { env })).code, 0);
  return bot;
}

test("two runs get their own view of one team: tails, outcomes, busy bots and cards", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const env = { OMB_TOKEN: "", OMB_DATA_DIR: f.dataDir };
  const { dir } = makeRepo();
  assert.equal((await runOmb(["import", PKG, "--project", dir, "--url", f.url], { env })).code, 0);
  assert.equal((await runOmb(["bind", "--project", dir, "--default", "claude/claude-sonnet-5"], { env })).code, 0);
  const vex = await addImplementer(f, dir, env);
  const a = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  assert.equal(a.code, 0, a.stdout);
  const b = await runOmb(["task", "--todo", "T11", "--project", dir], { env });
  assert.equal(b.code, 0, b.stdout);
  const st = loadState(statePaths(dir));
  const runs = Object.values(st.runs);
  const client = createClient({ url: f.url });
  const nova = st.team.bots.find((x) => x.name === "Nova");
  // A delegates to Nova and A's card is on A's lead thread; B delegates to Vex
  await f.control({ op: "delegated", threadId: a.json.leadThreadId, name: "Nova", reason: "implement T10" });
  await f.control({ op: "delegated", threadId: b.json.leadThreadId, name: "Vex" });
  await f.control({ op: "activity", botId: nova.id, activity: "working" });
  await f.control({ op: "activity", botId: vex.id, activity: "working" });
  await f.control({ op: "card", threadId: a.json.leadThreadId, requestId: "a-card", kind: "question", text: "Which table?" });
  await f.control({ op: "card", threadId: b.json.threads[vex.id], requestId: "vex-card", kind: "approval", text: "May Vex write?" });
  const all = await snapshotRuns(client, { team: st.team, runs }, { dataDir: f.dataDir });
  assert.deepEqual(Object.keys(all.views).sort(), [a.json.runId, b.json.runId].sort());
  const va = all.views[a.json.runId]; const vb = all.views[b.json.runId];
  assert.equal(va.leadThreadId, a.json.leadThreadId); assert.equal(vb.leadThreadId, b.json.leadThreadId);
  assert.deepEqual(va.openDelegations.byName, { Nova: 1 }); assert.deepEqual(vb.openDelegations.byName, { Vex: 1 });
  assert.deepEqual(va.bots.filter((x) => x.busy).map((x) => x.name), ["Nova"], "Vex works for the other run");
  assert.deepEqual(vb.bots.filter((x) => x.busy).map((x) => x.name), ["Vex"]);
  assert.deepEqual(va.pending.map((p) => p.requestId), ["a-card"], "each run sees the card raised on its own thread");
  assert.deepEqual(vb.pending.map((p) => p.requestId), ["vex-card"], "and the one from the bot it delegated to");
  assert.deepEqual(va.claims, ["a-card"]); assert.deepEqual(vb.claims, ["vex-card"]);
  assert.equal(evaluate(va, runs.find((r) => r.runId === a.json.runId), { now: Date.now(), quiet: { since: Date.now() - 60_000 } }).state, "needs-user", "A's own card, not B's");
  // Nova replies to A: A settles while B's implementer is still working
  await f.control({ op: "activity", botId: nova.id, activity: "idle" });
  await f.control({ op: "echo", threadId: a.json.leadThreadId, fromBotId: nova.id, name: "Nova", text: "implemented" });
  await fetch(`${f.url}/api/threads/${a.json.leadThreadId}/respond`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: "a-card", behavior: "answer", message: "the table" }) });
  await f.control({ op: "leadSay", threadId: a.json.leadThreadId, text: `Closing report: merged as 1234567.\n\nDONE ${a.json.tag}` });
  const after = await snapshotRuns(client, { team: st.team, runs }, { dataDir: f.dataDir });
  const runA = runs.find((r) => r.runId === a.json.runId);
  assert.equal(after.views[a.json.runId].openDelegations.total, 0);
  assert.deepEqual(after.views[a.json.runId].pending, []);
  assert.equal(evaluate(after.views[a.json.runId], runA, { now: Date.now() + 60_000, quiet: { since: Date.now() } }).state, "done", "B's working implementer never blocked A");
  // the single-run shape is the same view
  const one = await snapshotRuns(client, { team: st.team, task: runA, runs }, { dataDir: f.dataDir });
  assert.equal(one.leadThreadId, a.json.leadThreadId); assert.equal(one.views, undefined);
  assert.deepEqual(one.pending, []);
});

test("a card no run can claim is shared, and a busy lead blocks every run until the turn is placed", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const env = { OMB_TOKEN: "", OMB_DATA_DIR: f.dataDir };
  const { dir } = makeRepo();
  assert.equal((await runOmb(["import", PKG, "--project", dir, "--url", f.url], { env })).code, 0);
  assert.equal((await runOmb(["bind", "--project", dir, "--default", "claude/claude-sonnet-5"], { env })).code, 0);
  await addImplementer(f, dir, env);
  const a = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  assert.equal(a.code, 0, a.stdout);
  const b = await runOmb(["task", "--todo", "T11", "--project", dir], { env });
  assert.equal(b.code, 0, b.stdout);
  const st = loadState(statePaths(dir));
  const runs = Object.values(st.runs);
  const client = createClient({ url: f.url });
  const quill = st.team.bots.find((x) => x.name === "Quill");
  // Quill has nothing to do with either run, and raises a card anyway
  await f.control({ op: "card", threadId: st.runs[a.json.runId].threads[quill.id], requestId: "loose", kind: "approval", text: "May Quill push?" });
  let views = (await snapshotRuns(client, { team: st.team, runs }, { dataDir: f.dataDir })).views;
  for (const runId of [a.json.runId, b.json.runId]) {
    assert.deepEqual(views[runId].pending.map((p) => [p.requestId, p.shared]), [["loose", true]], runId);
    assert.deepEqual(views[runId].claims, [], "a card nobody can claim is never owned");
  }
  // once a run remembers a card, it keeps it even after the delegation settles
  const remembered = runs.map((r) => (r.runId === b.json.runId ? { ...r, cards: { loose: true } } : r));
  views = (await snapshotRuns(client, { team: st.team, runs: remembered }, { dataDir: f.dataDir })).views;
  assert.deepEqual(views[b.json.runId].pending.map((p) => [p.requestId, p.shared]), [["loose", false]]);
  assert.deepEqual(views[a.json.runId].pending, [], "first sight decided it");
  // a busy lead is every open run's problem unless the turn's thread is known
  await f.control({ op: "activity", botId: st.team.lead.id, activity: "working" });
  views = (await snapshotRuns(client, { team: st.team, runs }, { dataDir: f.dataDir })).views;
  for (const runId of [a.json.runId, b.json.runId]) assert.deepEqual(views[runId].bots.filter((x) => x.busy).map((x) => x.name), ["Sudo"], runId);
  await f.control({ op: "event", threadId: b.json.leadThreadId, event: { turnId: "t1", type: "turn.started", createdAt: new Date().toISOString() } });
  views = (await snapshotRuns(client, { team: st.team, runs }, { dataDir: f.dataDir })).views;
  assert.deepEqual(views[a.json.runId].bots.filter((x) => x.busy), [], "the runtime log says the turn is B's");
  assert.deepEqual(views[b.json.runId].bots.filter((x) => x.busy).map((x) => x.name), ["Sudo"]);
  await f.control({ op: "event", threadId: b.json.leadThreadId, event: { turnId: "t1", type: "turn.completed", createdAt: new Date().toISOString(), ok: true } });
  views = (await snapshotRuns(client, { team: st.team, runs }, { dataDir: f.dataDir })).views;
  for (const runId of [a.json.runId, b.json.runId]) assert.deepEqual(views[runId].bots.filter((x) => x.busy).map((x) => x.name), ["Sudo"], "a finished turn identifies nothing, so both wait again");
});

test("status evaluates every open run, and still reads as one run when only one is open", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const env = { OMB_TOKEN: "", OMB_DATA_DIR: f.dataDir };
  const { dir } = makeRepo();
  assert.equal((await runOmb(["import", PKG, "--project", dir, "--url", f.url], { env })).code, 0);
  assert.equal((await runOmb(["bind", "--project", dir, "--default", "claude/claude-sonnet-5"], { env })).code, 0);
  await addImplementer(f, dir, env);
  const a = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  assert.equal(a.code, 0, a.stdout);
  let r = await runOmb(["status", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.run.runId, a.json.runId, "one run keeps the shape it always had");
  assert.equal(r.json.runs.length, 1); assert.equal(r.json.runs[0].slug, "t10"); assert.equal(r.json.runs[0].state, r.json.state);
  const b = await runOmb(["task", "--todo", "T11", "--project", dir], { env });
  assert.equal(b.code, 0, b.stdout);
  await f.control({ op: "delegated", threadId: a.json.leadThreadId, name: "Nova", reason: "implement T10" });
  await f.control({ op: "leadSay", threadId: b.json.leadThreadId, text: `All done.\n\nDONE ${b.json.tag}` });
  r = await runOmb(["status", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.run, undefined, "two runs: no single run to speak for");
  assert.equal(r.json.state, undefined);
  assert.deepEqual(r.json.runs.map((x) => x.slug).sort(), ["t10", "t11"]);
  const ra = r.json.runs.find((x) => x.slug === "t10"); const rb = r.json.runs.find((x) => x.slug === "t11");
  assert.equal(ra.state, "running"); assert.match(ra.reasons.join(" "), /1 delegation\(s\) open: Nova/);
  assert.equal(ra.implementer.name, "Nova"); assert.equal(ra.branch, "task/t10");
  assert.equal(rb.lead.text, `All done.\n\nDONE ${b.json.tag}`, "each run reports its own thread");
  assert.equal(rb.marker.id, rb.lead.id);
  const brief = await runOmb(["status", "--project", dir, "--brief"], { env });
  assert.equal(brief.stdout.trim().split("\n").length, 2, brief.stdout);
  assert.match(brief.stdout, /t10 · running/); assert.match(brief.stdout, /t11 ·/);
});
