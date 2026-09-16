import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startFake, makeRepo, runOmb, ROOT, sleep } from "./helpers.mjs";
import { statePaths, loadState, updateState, ensureExclude, withLock } from "../skills/openmausbot-launcher/scripts/lib/state.mjs";
import { createClient } from "../skills/openmausbot-launcher/scripts/lib/http.mjs";

const PKG = path.join(ROOT, "tests", "fixtures", "dev-team.package.json");
const env = { OMB_TOKEN: "" };
const fleet = async (f) => (await (await fetch(`${f.url}/api/bots?messages=0`)).json()).bots;
const thread = async (f, id) => (await (await fetch(`${f.url}/api/threads/${id}/messages`)).json()).messages;

async function setup(t) {
  const f = await startFake(); t.after(() => f.close()); env.OMB_DATA_DIR = f.dataDir;
  const { dir, git } = makeRepo();
  assert.equal((await runOmb(["import", PKG, "--project", dir, "--url", f.url], { env })).code, 0);
  assert.equal((await runOmb(["bind", "--project", dir, "--default", "claude/claude-sonnet-5"], { env })).code, 0);
  assert.equal((await runOmb(["facts", "--project", dir, "--test", "npm test", "--tracker", "beads"], { env })).code, 0);
  const st = loadState(statePaths(dir));
  return { f, dir, git, team: st.team, lead: st.team.lead, client: createClient({ url: f.url }) };
}

test("task: preconditions, dispatch with fresh tagged threads, the brief and its marker, then refusal of a second run with the same name", async (t) => {
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
  assert.deepEqual(loadState(statePaths(dir)).runs, {});
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
  const run = loadState(statePaths(dir)).runs[r.json.runId];
  assert.equal(run.status, "dispatched"); assert.equal(run.sentAt, msgs[0].at); assert.equal(run.lastEval.state, "running");
  r = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /slug t10 is already open/); assert.match(r.json.hint, /--title/);
  r = await runOmb(["task", "--project", dir, "--abandon"], { env });
  assert.equal(r.code, 0); assert.deepEqual(loadState(statePaths(dir)).runs, {}); assert.equal(loadState(statePaths(dir)).history[0].result, "abandoned");
  r = await runOmb(["task", "a free-form brief for the lead", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout); assert.match(r.json.brief, /^a free-form brief for the lead Use the worktree/); assert.match(r.json.brief, /\n\nWhen the task is finished/); assert.equal(r.json.title, "a free-form brief for the lead");
  await f.control({ op: "newEnvironment" });
  r = await runOmb(["task", "--project", dir, "--resume"], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /not the one this team was imported on/);
});

test("task --resume recovers a crash after preparing, after one thread, and is idempotent after the send", async (t) => {
  const { f, dir, team, lead, client } = await setup(t);
  const paths = statePaths(dir);
  // crash after preparing: intent persisted, nothing on the server yet
  await updateState(paths, (d) => { d.runs["1234567890abcdef"] = { runId: "1234567890abcdef", status: "preparing", slug: "t10", title: "T10", tag: "oml:12345678", brief: "Sudo, do T10.\n\nDONE oml:12345678", sendId: "task-1234567890abcdef", sentAt: null, sentSha: "x", threads: {}, freshThreads: true, leadThreadId: null }; return d; });
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
  await updateState(paths, (d) => { d.runs["aaaaaaaa00000000"] = { runId: "aaaaaaaa00000000", status: "preparing", slug: "t12", title: "T12", tag: "oml:aaaaaaaa", brief: "Sudo, do T12.\n\nDONE oml:aaaaaaaa", sendId: "task-aaaaaaaa00000000", sentAt: null, sentSha: "x", threads: { [lead.id]: leadTask.task.threadId }, freshThreads: true, leadThreadId: leadTask.task.threadId }; return d; });
  r = await runOmb(["task", "--project", dir, "--resume"], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.threads[lead.id], leadTask.task.threadId); assert.equal(Object.keys(r.json.threads).length, 5);
  // ambiguous: two tagged tasks on a bot
  await runOmb(["task", "--project", dir, "--abandon"], { env });
  const nova = team.bots.find((b) => b.key === "nova");
  await client.post(`/api/bots/${nova.id}/tasks`, { title: "T13 [oml:bbbbbbbb]" });
  await client.post(`/api/bots/${nova.id}/tasks`, { title: "T13 [oml:bbbbbbbb]" });
  await updateState(paths, (d) => { d.runs["bbbbbbbb00000000"] = { runId: "bbbbbbbb00000000", status: "preparing", slug: "t13", title: "T13", tag: "oml:bbbbbbbb", brief: "x", sendId: "task-bbbbbbbb00000000", sentAt: null, sentSha: "x", threads: {}, freshThreads: true, leadThreadId: null }; return d; });
  r = await runOmb(["task", "--project", dir, "--resume"], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /Nova has 2 tasks tagged oml:bbbbbbbb/);
});

test("task owns .worktrees/<slug> on task/<slug>, says so in the brief, and claims an idle implementer", async (t) => {
  const { f, dir, git, team } = await setup(t);
  const nova = team.bots.find((b) => b.key === "nova");
  let r = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.slug, "t10"); assert.equal(r.json.branch, "task/t10");
  assert.match(r.json.brief, /Use the worktree \.worktrees\/t10 on branch task\/t10 for this task\./);
  assert.match(r.json.brief, /Use @Nova as the implementer for this task\./);
  assert.deepEqual(r.json.implementer, { id: nova.id, name: "Nova" });
  const saved = loadState(statePaths(dir)).runs[r.json.runId];
  assert.equal(saved.branch, "task/t10"); assert.equal(saved.implementer.name, "Nova");
  assert.equal((await runOmb(["task", "--project", dir, "--abandon"], { env })).code, 0);
  // a name the repository already uses belongs to somebody else until it is removed or claimed
  git("branch", "task/t11");
  r = await runOmb(["task", "--todo", "T11", "--project", dir], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /task\/t11 already exists/); assert.match(r.json.hint, /reconcile --claim t11/);
  git("branch", "-D", "task/t11");
  git("worktree", "add", "-q", "-b", "wt-t11", ".worktrees/t11", "main");
  r = await runOmb(["task", "--todo", "T11", "--project", dir], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /\.worktrees\/t11 already exists/);
  git("worktree", "remove", ".worktrees/t11"); git("branch", "-D", "wt-t11");
  assert.equal((await runOmb(["task", "--todo", "T11", "--project", dir], { env })).code, 0);
  // a team with no implementer dispatches without a claim
  assert.equal((await runOmb(["task", "--project", dir, "--abandon"], { env })).code, 0);
  await updateState(statePaths(dir), (d) => { d.team.bots = d.team.bots.map((b) => ({ ...b, title: "Generalist" })); return d; });
  for (const b of await fleet(f)) await fetch(`${f.url}/api/bots/${b.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Generalist" }) });
  r = await runOmb(["task", "--todo", "T12", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.implementer, null);
  assert.equal(/implementer for this task/.test(r.json.brief), false);
});

test("a second run keeps the lead's threads apart, reuses the specialists' live threads, and claims another implementer", async (t) => {
  const { f, dir, team, lead } = await setup(t);
  const nova = team.bots.find((b) => b.key === "nova");
  const a = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  assert.equal(a.code, 0, a.stdout);
  const vex = (await f.control({ op: "bot", name: "Vex", title: "Implementer", section: team.section })).bot;
  // A's implementer is at work: a second dispatch may not wait for the whole team to be idle
  await f.control({ op: "activity", botId: nova.id, activity: "working" });
  const b = await runOmb(["task", "--todo", "T11", "--project", dir], { env });
  assert.equal(b.code, 0, b.stdout + b.stderr);
  assert.equal(b.json.implementer.name, "Vex", "Nova is claimed by T10");
  assert.notEqual(b.json.leadThreadId, a.json.leadThreadId, "each run has its own lead thread");
  assert.equal(b.json.threads[nova.id], a.json.threads[nova.id], "a later run never opens a fresh specialist thread: delegations land on the target's active one");
  assert.equal(b.json.threads[vex.id], (await fleet(f)).find((x) => x.id === vex.id).threadId);
  const bots = await fleet(f);
  assert.equal(bots.find((x) => x.id === lead.id).threadId, b.json.leadThreadId, "the lead's newest task is the active one");
  assert.equal(bots.find((x) => x.id === nova.id).tasks.length, 2, "Nova kept the two tasks it had, and got no third");
  const st = loadState(statePaths(dir));
  assert.deepEqual(Object.keys(st.runs).sort(), [a.json.runId, b.json.runId].sort());
  // a claimed implementer is refused by name unless the user insists
  await f.control({ op: "activity", botId: nova.id, activity: "idle" });
  let r = await runOmb(["task", "--todo", "T12", "--implementer", "Nova", "--project", dir], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /Nova is the implementer of t10/); assert.match(r.json.hint, /--share-implementer/);
  r = await runOmb(["task", "--todo", "T12", "--implementer", "Nova", "--share-implementer", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.implementer.name, "Nova");
  assert.equal((await runOmb(["task", "--todo", "T13", "--project", dir], { env })).code, 3, "no implementer is free for a fourth run");
  r = await runOmb(["task", "--todo", "T13", "--project", dir], { env });
  assert.match(r.json.error, /implementer/); assert.match(r.json.hint, /create/);
  // the lead must still be free to take a brief
  await f.control({ op: "activity", botId: lead.id, activity: "working" });
  r = await runOmb(["task", "--todo", "T14", "--implementer", "Vex", "--share-implementer", "--project", dir], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /the lead Sudo is working/);
});

test("send: the run thread, deterministic dedupe, no retargeting on a stale thread, queued while busy", async (t) => {
  const { f, dir, lead, client } = await setup(t);
  const run = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  assert.equal(run.code, 0, run.stdout);
  let r = await runOmb(["send", "status?", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.threadId, run.json.leadThreadId); assert.equal(r.json.queued, false); assert.equal(r.json.duplicate, false);
  const first = r.json.messageId; const firstSendId = r.json.sendId;
  r = await runOmb(["send", "status?", "--project", dir], { env });
  assert.equal(r.json.messageId, first, "the same text in the same run is one message"); assert.equal(r.json.duplicate, true); assert.equal(r.json.sendId, firstSendId);
  r = await runOmb(["send", "status?", "--project", dir, "--brief"], { env });
  assert.equal(r.stdout, `send · Sudo · duplicate of ${first}\n`);
  r = await runOmb(["send", "status?", "--project", dir, "--again"], { env });
  assert.equal(r.code, 0, r.stdout); assert.notEqual(r.json.messageId, first, "--again delivers once more on purpose"); assert.equal(r.json.duplicate, false); assert.notEqual(r.json.sendId, firstSendId);
  r = await runOmb(["send", "merge it anyway", "--project", dir], { env });
  assert.notEqual(r.json.messageId, first); assert.equal(r.json.duplicate, false);
  assert.equal((await thread(f, run.json.leadThreadId)).length, 4);
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

test("skill and routine requests refuse every response mode before posting", async (t) => {
  const { f, dir } = await setup(t);
  const run = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  const posts = [];
  f.server.on("request", (req) => { if (req.method === "POST" && req.url.endsWith("/respond")) posts.push(req.url); });
  for (const kind of ["skill", "routine"]) {
    await f.control({ op: "card", threadId: run.json.leadThreadId, kind, requestId: kind });
    for (const mode of [["--allow"], ["--deny"], ["--message", "yes"]]) {
      const r = await runOmb(["answer", ...mode, "--request", kind, "--project", dir], { env });
      assert.equal(r.code, 5, r.stdout);
      assert.match(r.json.error, new RegExp(`${kind} request`));
    }
  }
  assert.deepEqual(posts, [], "even a rejected response POST is forbidden for unsupported requests");
});

test("interrupt takes no state lock: it succeeds while another launcher holds it", async (t) => {
  const { f, dir, lead } = await setup(t);
  const run = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  assert.equal(run.code, 0, run.stdout);
  await f.control({ op: "activity", botId: lead.id, activity: "working" });
  let release; const held = withLock(statePaths(dir), () => new Promise((r) => { release = r; }));
  while (!release) await sleep(5);
  t.after(async () => { release(); await held; });
  const r = await runOmb(["interrupt", "--project", dir], { env: { ...env, OMB_LOCK_WAIT_MS: "300" } });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.interrupted, true);
  assert.equal((await fleet(f)).find((b) => b.id === lead.id).busy, false);
});

// ── the delivery helper, driven directly: the cases a live fake cannot stage ──
import { deliverToLead } from "../skills/openmausbot-launcher/scripts/lib/verbs/run.mjs";
import { HttpError } from "../skills/openmausbot-launcher/scripts/lib/http.mjs";

const runA = { runId: "aaaaaaaa11111111", slug: "t10", leadThreadId: "A", status: "dispatched" };
const runB = { runId: "bbbbbbbb22222222", slug: "t11", leadThreadId: "B", status: "dispatched" };
const answer = (status, error) => new HttpError("POST", "/api/bots/lead/messages", status, { error });

function leadClient(script) {
  const calls = [];
  return {
    calls,
    async get() { return { bots: [{ id: "lead", threadId: script.active }] }; },
    async post(route, body) {
      calls.push(route);
      if (/\/tasks\//.test(route)) {
        if (script.switchFails) throw answer(409, script.switchFails);
        script.active = route.split("/").pop();
        return { bot: { id: "lead", threadId: script.active } };
      }
      if (script.active !== body.threadId) throw answer(409, "the bot switched tasks before it could receive the message");
      return { ok: true, threadId: body.threadId, message: { id: "m1", at: Date.now() } };
    },
  };
}

test("deliverToLead posts to the run's own thread, switching the lead back when it sits on another run's", async () => {
  const c = leadClient({ active: "B" });
  const r = await deliverToLead(c, { leadId: "lead", run: runA, otherRuns: [runB], text: "status?", sendId: "s1" });
  assert.equal(r.switched, true); assert.equal(r.threadId, "A"); assert.equal(r.messageId, "m1");
  assert.deepEqual(c.calls, ["/api/bots/lead/messages", "/api/bots/lead/tasks/A", "/api/bots/lead/messages"], "post, switch, post once more");
  const quiet = leadClient({ active: "A" });
  assert.equal((await deliverToLead(quiet, { leadId: "lead", run: runA, otherRuns: [runB], text: "status?", sendId: "s1" })).switched, false);
  assert.deepEqual(quiet.calls, ["/api/bots/lead/messages"], "the lead is already there: no switch");
});

test("deliverToLead refuses when the lead is working, and reports a second switch without retrying it", async () => {
  const busy = leadClient({ active: "B", switchFails: "this bot is working — stop it before switching tasks" });
  await assert.rejects(deliverToLead(busy, { leadId: "lead", run: runA, otherRuns: [runB], text: "x", sendId: "s2" }),
    (e) => e.code === 3 && /the lead is working on t11/.test(e.message) && /retry when it is idle/.test(e.message + e.hint));
  // the switch lands, then somebody else moves the lead again before the post
  const raced = leadClient({ active: "B" });
  const post = raced.post.bind(raced);
  let posts = 0;
  raced.post = async (route, body) => { const out = post(route, body); if (/\/tasks\//.test(route)) { await out; raced.calls.pop(); raced.calls.push(route); } if (/messages$/.test(route) && ++posts === 2) { throw answer(409, "the bot switched tasks before it could receive the message"); } return out; };
  await assert.rejects(deliverToLead(raced, { leadId: "lead", run: runA, otherRuns: [runB], text: "x", sendId: "s3" }),
    (e) => e.code === 3 && /switched tasks/.test(e.message) && /switched away again/.test(e.hint));
  assert.equal(raced.calls.filter((c) => c.endsWith("/messages")).length, 2, "two posts, never a third");
});

test("deliverToLead leaves a thread that is nobody's run alone", async () => {
  const c = leadClient({ active: "elsewhere" });
  await assert.rejects(deliverToLead(c, { leadId: "lead", run: runA, otherRuns: [runB], text: "x", sendId: "s4" }),
    (e) => e.code === 3 && /switched tasks/.test(e.message) && /nothing was retargeted/.test(e.hint) && /--thread elsewhere/.test(e.hint));
  assert.deepEqual(c.calls, ["/api/bots/lead/messages"], "a thread no run owns is never switched away from");
});

test("send, answer's fallback and --nudge all reach the run they name while the lead sits on another", async (t) => {
  const { f, dir, lead, team, client } = await setup(t);
  const nova = team.bots.find((b) => b.key === "nova");
  const a = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  await f.control({ op: "bot", name: "Vex", title: "Implementer", section: "Dev team" });
  const b = await runOmb(["task", "--todo", "T11", "--project", dir], { env });
  assert.equal(b.code, 0, b.stdout);
  const active = async () => (await fleet(f)).find((x) => x.id === lead.id).threadId;
  assert.equal(await active(), b.json.leadThreadId);
  let r = await runOmb(["send", "status?", "--run", "t10", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.switched, true); assert.equal(r.json.threadId, a.json.leadThreadId);
  assert.equal(await active(), a.json.leadThreadId, "the switch is what made the message land");
  assert.equal((await thread(f, a.json.leadThreadId)).at(-1).text, "status?");
  // an identical sendId replays the canonical receipt before the active-task check
  await client.post(`/api/bots/${lead.id}/tasks/${b.json.leadThreadId}`, {});
  r = await runOmb(["send", "status?", "--run", "t10", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.duplicate, true); assert.equal(r.json.switched, false);
  assert.equal(await active(), b.json.leadThreadId, "a replayed receipt moves nothing");
  // the unanswerable card falls back to chat on the run's own thread
  await f.control({ op: "card", threadId: a.json.leadThreadId, requestId: "dead-q", kind: "question", dead: true, text: "Still there?" });
  r = await runOmb(["answer", "--message", "use a table", "--request", "dead-q", "--run", "t10", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.fellBackToSend, true); assert.equal(r.json.sent.switched, true);
  assert.equal((await thread(f, a.json.leadThreadId)).at(-1).text, "use a table");
  // and the nudge does too
  await client.post(`/api/bots/${lead.id}/tasks/${b.json.leadThreadId}`, {});
  await f.control({ op: "leadSay", threadId: a.json.leadThreadId, text: "Delegating." });
  await sleep(20);
  await f.control({ op: "echo", threadId: a.json.leadThreadId, fromBotId: nova.id, name: "Nova", text: "done but the lead sleeps" });
  r = await runOmb(["watch", "--run", "t10", "--project", dir, "--max-seconds", "6", "--nudge", "--quiet-seconds", "1", "--drop-seconds", "1", "--poll", "1"], { env });
  assert.equal(r.json.nudged, true, r.stdout);
  assert.equal((await thread(f, a.json.leadThreadId)).filter((m) => m.text === "status?").length, 2, "the nudge landed on t10's thread");
  assert.equal(await active(), a.json.leadThreadId);
  // a busy lead cannot be switched away from its turn
  await client.post(`/api/bots/${lead.id}/tasks/${b.json.leadThreadId}`, {});
  await f.control({ op: "activity", botId: lead.id, activity: "working" });
  r = await runOmb(["send", "another thing", "--run", "t10", "--project", dir], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /the lead is working on t11/);
});

test("every run-scoped verb asks which run when two are open, and interrupt says what it could not reach", async (t) => {
  const { f, dir, lead, client } = await setup(t);
  const a = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  await f.control({ op: "bot", name: "Vex", title: "Implementer", section: "Dev team" });
  const b = await runOmb(["task", "--todo", "T11", "--project", dir], { env });
  for (const args of [["send", "hi"], ["interrupt"], ["watch", "--max-seconds", "2"], ["report", "--no-tests"], ["task", "--abandon"], ["task", "--resume"]]) {
    const r = await runOmb([...args, "--project", dir], { env });
    assert.equal(r.code, 3, `${args[0]}: ${r.stdout}`);
    assert.match(r.json.error, /2 runs are open; pass --run/, args[0]);
    assert.match(r.json.hint, /t10 \(\w{8}, dispatched\), t11 \(\w{8}, dispatched\)/, args[0]);
  }
  const named = await runOmb(["send", "hi", "--thread", b.json.leadThreadId, "--project", dir], { env });
  assert.equal(named.code, 0, `an explicit thread needs no run: ${named.stdout}`); assert.equal(named.json.switched, undefined, "a named thread is delivered, never switched to");
  const stale = await runOmb(["send", "hi", "--thread", a.json.leadThreadId, "--project", dir], { env });
  assert.equal(stale.code, 3); assert.match(stale.json.hint, /nothing was retargeted/, "a named thread that is not active is still never switched to");
  const watched = await runOmb(["watch", "--run", "t11", "--project", dir, "--max-seconds", "2", "--quiet-seconds", "1", "--poll", "1"], { env });
  assert.equal(watched.code, 4, "named, it watches t11 and times out on an unfinished run rather than refusing");
  // the lead's turn is pinned to t10's thread while t11 is the active task
  await f.control({ op: "pinnedTurn", botId: lead.id, threadId: a.json.leadThreadId });
  const r = await runOmb(["interrupt", "--run", "t10", "--project", dir], { env });
  assert.equal(r.code, 3, r.stdout); assert.match(r.json.error, /switched tasks before it could be interrupted/);
  assert.match(r.json.hint, /wait for the lead to go idle, then task --abandon --run t10/);
  assert.equal((await runOmb(["interrupt", "--run", "t11", "--project", dir], { env })).code, 0, "the active thread is reachable");
});

test("answer works on one run's own cards and refuses a request no run can claim without --request", async (t) => {
  const { f, dir, team } = await setup(t);
  const a = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  await f.control({ op: "bot", name: "Vex", title: "Implementer", section: "Dev team" });
  const b = await runOmb(["task", "--todo", "T11", "--project", dir], { env });
  assert.equal(b.code, 0, b.stdout);
  await f.control({ op: "card", threadId: a.json.leadThreadId, requestId: "q-a", kind: "question", text: "Which table?" });
  await f.control({ op: "card", threadId: b.json.leadThreadId, requestId: "q-b", kind: "question", text: "Which loader?" });
  let r = await runOmb(["answer", "--message", "the wide one", "--run", "t10", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.requestId, "q-a", "each run answers on its own thread without --request");
  r = await runOmb(["answer", "--message", "the fast one", "--run", "t11", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.requestId, "q-b");
  // a card from a bot neither run delegated to belongs to nobody
  const quill = team.bots.find((x) => x.key === "quill");
  await f.control({ op: "card", threadId: (await fleet(f)).find((x) => x.id === quill.id).threadId, requestId: "loose", kind: "approval", text: "May Quill push?" });
  r = await runOmb(["answer", "--allow", "--run", "t10", "--project", dir], { env });
  assert.equal(r.code, 3, r.stdout); assert.match(r.json.error, /no open run owns request loose/); assert.match(r.json.hint, /--request loose/);
  r = await runOmb(["answer", "--allow", "--request", "loose", "--run", "t10", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.outcome, "allowed-once");
});

test("task --resume sends the brief to its own run's thread even when the lead moved to another run", async (t) => {
  const { f, dir, lead } = await setup(t);
  const a = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  assert.equal(a.code, 0, a.stdout);
  await f.control({ op: "bot", name: "Vex", title: "Implementer", section: "Dev team" });
  const b = await runOmb(["task", "--todo", "T11", "--project", dir], { env });
  assert.equal(b.code, 0, b.stdout);
  // A is back to preparing with a brief the server has not seen — the state a
  // crash between opening the lead's task and sending leaves — and the lead has
  // since moved on to B's task.
  await updateState(statePaths(dir), (d) => { const run = d.runs[a.json.runId]; run.status = "preparing"; run.sentAt = null; run.sendId = "task-resend"; run.brief = `${run.brief}\n\n(resumed)`; return d; });
  assert.equal((await fleet(f)).find((x) => x.id === lead.id).threadId, b.json.leadThreadId);
  const r = await runOmb(["task", "--resume", "--run", "t10", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.json.status, "dispatched"); assert.equal(r.json.leadThreadId, a.json.leadThreadId);
  const msgs = await thread(f, a.json.leadThreadId);
  assert.equal(msgs.filter((m) => m.sendId === "task-resend").length, 1, "the brief landed once, on t10's own thread");
  assert.equal((await fleet(f)).find((x) => x.id === lead.id).threadId, a.json.leadThreadId, "the switch is what made it land");
});
