// `answer` on every request kind a bot can raise: question and approval cards,
// learned skills, routine confirmations, credentials and connected apps.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { startFake, makeRepo, runOmb, ROOT } from "./helpers.mjs";
import { statePaths, loadState } from "../skills/openmausbot-launcher/scripts/lib/state.mjs";

const PKG = path.join(ROOT, "tests", "fixtures", "dev-team.package.json");
const env = { OMB_TOKEN: "" };
const thread = async (f, id) => (await (await fetch(`${f.url}/api/threads/${id}/messages`)).json()).messages;

async function setup(t) {
  const f = await startFake(); t.after(() => f.close()); env.OMB_DATA_DIR = f.dataDir;
  const { dir } = makeRepo();
  assert.equal((await runOmb(["import", PKG, "--project", dir, "--url", f.url], { env })).code, 0);
  assert.equal((await runOmb(["bind", "--project", dir, "--default", "claude/claude-sonnet-5"], { env })).code, 0);
  assert.equal((await runOmb(["facts", "--project", dir, "--test", "npm test", "--tracker", "beads"], { env })).code, 0);
  const st = loadState(statePaths(dir));
  return { f, dir, team: st.team, lead: st.team.lead };
}

test("answer: approval and question cards, dead cards, several pending, unsupported requests, bare text", async (t) => {
  const { f, dir, team } = await setup(t);
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
  r = await runOmb(["answer", "no new dependency, use a table", "--project", dir], { env });
  assert.equal(r.code, 0); assert.equal(r.json.viaSend, true);
  assert.equal((await thread(f, lt)).at(-1).text, "no new dependency, use a table");
  r = await runOmb(["answer", "--allow", "--project", dir, "--request", "ap1"], { env });
  assert.equal(r.code, 3, "an answered card is no longer pending");
});

test("skill, routine, credential and connection requests refuse every ordinary response mode before posting", async (t) => {
  const { f, dir } = await setup(t);
  const run = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  const posts = [];
  f.server.on("request", (req) => { if (req.method === "POST" && req.url.endsWith("/respond")) posts.push(req.url); });
  for (const kind of ["skill"]) {
    await f.control({ op: "card", threadId: run.json.leadThreadId, kind, requestId: kind });
    for (const mode of [["--allow"], ["--deny"], ["--message", "yes"]]) {
      const r = await runOmb(["answer", ...mode, "--request", kind, "--project", dir], { env });
      assert.equal(r.code, 5, r.stdout);
      assert.match(r.json.error, new RegExp(`${kind} request`));
    }
  }
  assert.deepEqual(posts, [], "even a rejected response POST is forbidden for unsupported requests");
});

test("routine: a confirmation applies the operation, a cancel rejects it, and a textual answer never reaches the server", async (t) => {
  const { f, dir } = await setup(t);
  const run = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  const lt = run.json.leadThreadId;
  const posts = [];
  f.server.on("request", (req) => { if (req.method === "POST" && req.url.endsWith("/respond")) posts.push(req.url); });
  await f.control({ op: "card", threadId: lt, kind: "routine", requestId: "rt1", name: "Nightly" });
  let r = await runOmb(["answer", "--message", "sure", "--request", "rt1", "--project", dir], { env });
  assert.equal(r.code, 2, r.stdout); assert.match(r.json.error, /routine confirmation: use --confirm or --cancel/);
  assert.deepEqual(posts, [], "the server would reject a textual answer; the driver never sends one");
  r = await runOmb(["answer", "--confirm", "--cancel", "--request", "rt1", "--project", dir], { env });
  assert.equal(r.code, 2); assert.match(r.json.error, /pass one of/);
  r = await runOmb(["answer", "--confirm", "--request", "rt1", "--project", dir, "--dry-run"], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.dryRun, true); assert.equal(r.json.behavior, "allow");
  assert.deepEqual(posts, [], "a preview settles nothing");
  r = await runOmb(["answer", "--confirm", "--request", "rt1", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.cardKind, "routine"); assert.equal(r.json.title, "Schedule “Nightly”?");
  assert.equal(r.json.outcome, "allowed-once"); assert.equal(r.json.routineAction, "create");
  const listed = (await (await fetch(`${f.url}/api/routines`)).json()).routines;
  assert.deepEqual(listed.map((x) => x.id), [r.json.resultId], "the confirmation is what created the routine");
  r = await runOmb(["answer", "--confirm", "--request", "rt1", "--project", dir], { env });
  assert.equal(r.code, 3, "a settled card is no longer pending");
  await f.control({ op: "card", threadId: lt, kind: "routine", requestId: "rt2", name: "Weekly" });
  r = await runOmb(["answer", "--cancel", "--request", "rt2", "--project", dir, "--brief"], { env });
  assert.equal(r.stdout, "answer · Sudo · deny → rejected\n");
  assert.deepEqual((await (await fetch(`${f.url}/api/routines`)).json()).routines.map((x) => x.name), ["Nightly"]);
});

test("routine: a refused revalidation is reported in the server's words and leaves the card holding it", async (t) => {
  const { f, dir } = await setup(t);
  const run = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  const lt = run.json.leadThreadId;
  await f.control({ op: "card", threadId: lt, kind: "routine", requestId: "rt1", name: "Once", pastOnce: true });
  let r = await runOmb(["answer", "--confirm", "--request", "rt1", "--project", dir], { env });
  assert.equal(r.code, 3, r.stdout);
  assert.equal(r.json.status, 409);
  assert.equal(r.json.error, "That one-time schedule is now in the past. Ask the bot to propose a new time.");
  assert.match(r.json.hint, /held/);
  assert.equal((await thread(f, lt)).find((m) => m.card?.requestId === "rt1").card.held, r.json.error);
  await f.control({ op: "card", threadId: lt, kind: "routine", requestId: "rt2", action: "pause", name: "Gone", routineId: "no-such-routine" });
  r = await runOmb(["answer", "--confirm", "--request", "rt2", "--project", dir], { env });
  assert.equal(r.code, 3, r.stdout); assert.equal(r.json.status, 404); assert.equal(r.json.error, "That routine no longer exists");
  r = await runOmb(["answer", "--cancel", "--request", "rt2", "--project", dir], { env });
  assert.equal(r.code, 0, "a held card can still be cancelled"); assert.equal(r.json.outcome, "rejected");
});

test("a connection and a credential card are named by the message they arrived on", async (t) => {
  const { f, dir, team } = await setup(t);
  const run = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  const nova = team.bots.find((b) => b.key === "nova"); const novaThread = run.json.threads[nova.id];
  const made = await f.control({ op: "connector", threadId: novaThread, items: [{ slug: "slack", label: "Slack" }] });
  let r = await runOmb(["status", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.pending[0].handle, made.messages[0].id);
  assert.equal(r.json.pending[0].text, "Connect Slack so the bot can continue");
  r = await runOmb(["answer", "--allow", "--request", made.messages[0].id, "--project", dir], { env });
  assert.equal(r.code, 5, r.stdout); assert.match(r.json.error, /connector request the driver cannot answer/);
  const secret = await f.control({ op: "secret", threadId: novaThread, target: "ttsKey" });
  r = await runOmb(["answer", "--allow", "--request", secret.message.id, "--project", dir], { env });
  assert.equal(r.code, 5, r.stdout); assert.match(r.json.error, /secret request the driver cannot answer/);
});
