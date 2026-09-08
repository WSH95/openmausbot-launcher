import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startFake, makeRepo, runOmb, ROOT } from "./helpers.mjs";
import { statePaths, loadState, updateState, ensureExclude } from "../skills/openmausbot-launcher/scripts/lib/state.mjs";
import { createClient } from "../skills/openmausbot-launcher/scripts/lib/http.mjs";

const PKG = path.join(ROOT, "tests", "fixtures", "dev-team.package.json");
const env = { OMB_TOKEN: "" };
const fleet = async (f) => (await (await fetch(`${f.url}/api/bots?messages=0`)).json()).bots;
const thread = async (f, id) => (await (await fetch(`${f.url}/api/threads/${id}/messages`)).json()).messages;

async function setup(t) {
  const f = await startFake(); t.after(() => f.close());
  const { dir, git } = makeRepo();
  assert.equal((await runOmb(["import", PKG, "--project", dir, "--url", f.url], { env })).code, 0);
  assert.equal((await runOmb(["bind", "--project", dir, "--default", "claude/claude-sonnet-5"], { env })).code, 0);
  assert.equal((await runOmb(["facts", "--project", dir, "--test", "npm test", "--tracker", "beads"], { env })).code, 0);
  const st = loadState(statePaths(dir));
  return { f, dir, git, team: st.team, lead: st.team.lead, client: createClient({ url: f.url }) };
}

test("task: preconditions, dispatch with fresh tagged threads, the brief and its marker, then refusal while open", async (t) => {
  const { f, dir, git, team, lead } = await setup(t);
  const nova = team.bots.find((b) => b.key === "nova");
  await f.control({ op: "activity", botId: nova.id, activity: "working" });
  let r = await runOmb(["task", "--todo", "T10", "--bead", "slg-a9x", "--project", dir], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /bots are working: Nova/);
  await f.control({ op: "activity", botId: nova.id, activity: "idle" });
  await f.control({ op: "queued", sourceBotId: lead.id, targetBotId: nova.id });
  r = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /delegation\(s\) queued or running/);
  await f.control({ op: "clearDelegations" });
  fs.writeFileSync(path.join(dir, "stray"), "x");
  r = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /not reconciled/);
  fs.rmSync(path.join(dir, "stray"));
  r = await runOmb(["task", "--todo", "T10", "--bead", "slg-a9x", "--project", dir, "--dry-run"], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.dryRun, true); assert.match(r.json.brief, /^Sudo, do T10 from TODO\.md in this project\. Test command: npm test \(run inside the task's worktree\)\. Setup command: none\. Bead: slg-a9x\./);
  assert.equal(loadState(statePaths(dir)).task, null);
  assert.equal((await runOmb(["facts", "--project", dir, "--test", "npm test (run inside the task's worktree)"], { env })).code, 0);
  r = await runOmb(["task", "--todo", "T10", "--bead", "slg-a9x", "--project", dir, "--dry-run"], { env });
  assert.match(r.json.brief, /Test command: npm test \(run inside the task's worktree\)\. Setup/, "the parenthetical is not doubled");
  assert.equal((await runOmb(["facts", "--project", dir, "--test", "npm test"], { env })).code, 0);
  r = await runOmb(["task", "--todo", "T10", "--bead", "slg-a9x", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.json.status, "dispatched"); assert.equal(r.json.title, "T10"); assert.match(r.json.tag, /^oml:[0-9a-f]{8}$/);
  assert.equal(Object.keys(r.json.threads).length, 5); assert.ok(r.json.leadThreadId); assert.equal(r.json.sentSha, git("rev-parse", "HEAD").trim());
  assert.match(r.json.brief, new RegExp(`end your closing report with a line containing only \`DONE ${r.json.tag}\``));
  const bots = await fleet(f);
  for (const b of bots) assert.equal(b.tasks.at(-1).title, `T10 [${r.json.tag}]`);
  assert.equal(bots.find((b) => b.id === lead.id).threadId, r.json.leadThreadId, "the fresh task is active");
  const msgs = await thread(f, r.json.leadThreadId);
  assert.equal(msgs.length, 1); assert.equal(msgs[0].role, "user"); assert.equal(msgs[0].sendId, `task-${r.json.runId}`);
  const st = loadState(statePaths(dir));
  assert.equal(st.task.status, "dispatched"); assert.equal(st.task.sentAt, msgs[0].at); assert.equal(st.task.lastEval.state, "running");
  r = await runOmb(["task", "--todo", "T11", "--project", dir], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /a run is dispatched: T10/);
  r = await runOmb(["task", "--project", dir, "--abandon"], { env });
  assert.equal(r.code, 0); assert.equal(loadState(statePaths(dir)).task, null); assert.equal(loadState(statePaths(dir)).history[0].result, "abandoned");
  r = await runOmb(["task", "a free-form brief for the lead", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout); assert.match(r.json.brief, /^a free-form brief for the lead\n\nWhen the task is finished/); assert.equal(r.json.title, "a free-form brief for the lead");
  await f.control({ op: "newEnvironment" });
  r = await runOmb(["task", "--project", dir, "--resume"], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /not the one this team was imported on/);
});

test("task --resume recovers a crash after preparing, after one thread, and is idempotent after the send", async (t) => {
  const { f, dir, team, lead, client } = await setup(t);
  const paths = statePaths(dir);
  // crash after preparing: intent persisted, nothing on the server yet
  await updateState(paths, (d) => { d.task = { runId: "1234567890abcdef", status: "preparing", slug: "t10", title: "T10", tag: "oml:12345678", brief: "Sudo, do T10.\n\nDONE oml:12345678", sendId: "task-1234567890abcdef", sentAt: null, sentSha: "x", threads: {}, freshThreads: true, leadThreadId: null }; return d; });
  let r = await runOmb(["task", "--todo", "T11", "--project", dir], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /a run is preparing: T10/); assert.match(r.json.hint, /task --resume/);
  r = await runOmb(["task", "--project", dir, "--resume"], { env });
  assert.equal(r.code, 0, r.stdout + r.stderr); assert.equal(r.json.status, "dispatched"); assert.equal(r.json.resumed, true); assert.equal(Object.keys(r.json.threads).length, 5);
  const firstThreads = r.json.threads;
  const before = (await fleet(f)).map((b) => b.tasks.length);
  r = await runOmb(["task", "--project", dir, "--resume"], { env });
  assert.equal(r.code, 0, r.stdout); assert.deepEqual(r.json.threads, firstThreads, "a second resume adopts the tagged threads");
  assert.deepEqual((await fleet(f)).map((b) => b.tasks.length), before, "no new tasks were created");
  assert.equal((await thread(f, r.json.leadThreadId)).length, 1, "the brief was not sent twice");
  // crash after one thread was created: the lead's task exists on the server and in the state; the rest is created
  await runOmb(["task", "--project", dir, "--abandon"], { env });
  const leadTask = await client.post(`/api/bots/${lead.id}/tasks`, { title: "T12 [oml:aaaaaaaa]" });
  await updateState(paths, (d) => { d.task = { runId: "aaaaaaaa00000000", status: "preparing", slug: "t12", title: "T12", tag: "oml:aaaaaaaa", brief: "Sudo, do T12.\n\nDONE oml:aaaaaaaa", sendId: "task-aaaaaaaa00000000", sentAt: null, sentSha: "x", threads: { [lead.id]: leadTask.task.threadId }, freshThreads: true, leadThreadId: leadTask.task.threadId }; return d; });
  r = await runOmb(["task", "--project", dir, "--resume"], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.threads[lead.id], leadTask.task.threadId); assert.equal(Object.keys(r.json.threads).length, 5);
  // ambiguous: two tagged tasks on a bot
  await runOmb(["task", "--project", dir, "--abandon"], { env });
  const nova = team.bots.find((b) => b.key === "nova");
  await client.post(`/api/bots/${nova.id}/tasks`, { title: "T13 [oml:bbbbbbbb]" });
  await client.post(`/api/bots/${nova.id}/tasks`, { title: "T13 [oml:bbbbbbbb]" });
  await updateState(paths, (d) => { d.task = { runId: "bbbbbbbb00000000", status: "preparing", slug: "t13", title: "T13", tag: "oml:bbbbbbbb", brief: "x", sendId: "task-bbbbbbbb00000000", sentAt: null, sentSha: "x", threads: {}, freshThreads: true, leadThreadId: null }; return d; });
  r = await runOmb(["task", "--project", dir, "--resume"], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /Nova has 2 tasks tagged oml:bbbbbbbb/);
});

test("send: the run thread, deterministic dedupe, no retargeting on a stale thread, queued while busy", async (t) => {
  const { f, dir, lead, client } = await setup(t);
  const run = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  assert.equal(run.code, 0, run.stdout);
  let r = await runOmb(["send", "status?", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.threadId, run.json.leadThreadId); assert.equal(r.json.queued, false);
  const first = r.json.messageId;
  r = await runOmb(["send", "status?", "--project", dir], { env });
  assert.equal(r.json.messageId, first, "the same text in the same run is one message");
  r = await runOmb(["send", "merge it anyway", "--project", dir], { env });
  assert.notEqual(r.json.messageId, first);
  assert.equal((await thread(f, run.json.leadThreadId)).length, 3);
  await f.control({ op: "activity", botId: lead.id, activity: "working" });
  r = await runOmb(["send", "queued one", "--project", dir], { env });
  assert.equal(r.code, 0); assert.equal(r.json.queued, true); assert.ok(r.json.queueId);
  await f.control({ op: "activity", botId: lead.id, activity: "idle" });
  const moved = await client.post(`/api/bots/${lead.id}/tasks`, { title: "elsewhere" });
  r = await runOmb(["send", "hello", "--project", dir], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /switched tasks/); assert.match(r.json.hint, new RegExp(`active task is ${moved.task.threadId}`)); assert.match(r.json.hint, /nothing was retargeted/);
  assert.equal((await thread(f, moved.task.threadId)).length, 0);
  r = await runOmb(["send", "hello", "--project", dir, "--thread", moved.task.threadId], { env });
  assert.equal(r.code, 0, "an explicit --thread is the only way to send elsewhere");
  r = await runOmb(["send", "to nova", "--project", dir, "--bot", "nova"], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.bot, "Nova"); assert.equal(r.json.threadId, run.json.threads[Object.keys(run.json.threads).find((id) => id !== lead.id && r.json.threadId === run.json.threads[id])]);
});

test("answer: approval and question cards, dead cards, several pending, unsupported requests, bare text", async (t) => {
  const { f, dir, team, lead } = await setup(t);
  const run = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  const lt = run.json.leadThreadId;
  const nova = team.bots.find((b) => b.key === "nova"); const novaThread = run.json.threads[nova.id];
  let r = await runOmb(["answer", "--allow", "--project", dir], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /nothing is pending/);
  await f.control({ op: "card", threadId: novaThread, requestId: "ap1", kind: "approval", text: "May Nova contact Quill?" });
  r = await runOmb(["answer", "--message", "x", "--project", dir], { env });
  assert.equal(r.code, 2); assert.match(r.json.error, /approval card: use --allow or --deny/);
  r = await runOmb(["answer", "--allow", "--project", dir, "--brief"], { env });
  assert.match(r.stdout, /^answer · Nova · allow → allowed-once/);
  await f.control({ op: "card", threadId: lt, requestId: "q1", kind: "question", text: "Which one?" });
  await f.control({ op: "card", threadId: novaThread, requestId: "ap2", kind: "approval" });
  r = await runOmb(["answer", "--deny", "--project", dir], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /2 requests are pending/); assert.match(r.json.hint, /q1/); assert.match(r.json.hint, /ap2/);
  r = await runOmb(["answer", "--deny", "--request", "ap2", "--project", dir], { env });
  assert.equal(r.code, 0); assert.equal(r.json.outcome, "rejected");
  r = await runOmb(["answer", "--allow", "--request", "q1", "--project", dir], { env });
  assert.equal(r.code, 2); assert.match(r.json.error, /is a question: use --message/);
  r = await runOmb(["answer", "--message", "the table", "--request", "q1", "--project", dir], { env });
  assert.equal(r.code, 0); assert.equal(r.json.outcome, "answered"); assert.equal(r.json.fellBackToSend, false);
  await f.control({ op: "card", threadId: lt, requestId: "dead-q", kind: "question", dead: true, text: "Still there?" });
  r = await runOmb(["answer", "--message", "yes, use a table", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.outcome, "unavailable"); assert.equal(r.json.fellBackToSend, true); assert.ok(r.json.sent.messageId);
  assert.equal((await thread(f, lt)).filter((m) => m.role === "user" && m.text === "yes, use a table").length, 1);
  await f.control({ op: "card", threadId: novaThread, requestId: "dead-a", kind: "approval", dead: true });
  r = await runOmb(["answer", "--allow", "--project", dir], { env });
  assert.equal(r.code, 5); assert.match(r.json.error, /no longer answerable/); assert.match(r.json.hint, /tell the bot in chat/);
  await f.control({ op: "connector", threadId: novaThread });
  r = await runOmb(["answer", "--allow", "--project", dir], { env });
  assert.equal(r.code, 5); assert.match(r.json.error, /connector request the driver cannot answer/); assert.match(r.json.hint, /connector-cards/);
  r = await runOmb(["answer", "no new dependency, use a table", "--project", dir], { env });
  assert.equal(r.code, 0); assert.equal(r.json.viaSend, true);
  assert.equal((await thread(f, lt)).at(-1).text, "no new dependency, use a table");
  r = await runOmb(["answer", "--allow", "--project", dir, "--request", "ap1"], { env });
  assert.equal(r.code, 3, "an answered card is no longer pending");
});

test("interrupt targets the run thread and reports a bot busy elsewhere", async (t) => {
  const { f, dir, lead } = await setup(t);
  let r = await runOmb(["interrupt", "--project", dir], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /no run thread/);
  const run = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  await f.control({ op: "activity", botId: lead.id, activity: "working" });
  r = await runOmb(["interrupt", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.threadId, run.json.leadThreadId);
  assert.equal((await fleet(f)).find((b) => b.id === lead.id).busy, false);
  await f.control({ op: "busyElsewhere", botId: lead.id, where: "room Dev Room" });
  r = await runOmb(["interrupt", "--project", dir], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /working in room Dev Room/); assert.match(r.json.hint, /not interrupted/);
});
