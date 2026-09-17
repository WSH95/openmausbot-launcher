// `answer` on every request kind a bot can raise: question and approval cards,
// learned skills, routine confirmations, credentials and connected apps.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startFake, makeRepo, runOmb, ROOT } from "./helpers.mjs";
import { statePaths, loadState } from "../skills/openmausbot-launcher/scripts/lib/state.mjs";
import { STRIPPED_ENV } from "../skills/openmausbot-launcher/scripts/lib/server.mjs";

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

test("skill: an allow carries the hash the user reviewed, and a hash that is not this card's never reaches the server", async (t) => {
  const { f, dir, lead } = await setup(t);
  const run = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  const lt = run.json.leadThreadId;
  const posts = [];
  f.server.on("request", (req) => { if (req.method === "POST" && req.url.endsWith("/respond")) posts.push(req.url); });
  await f.control({ op: "card", threadId: lt, kind: "skill", requestId: "s1", name: "release-notes", gist: "Write release notes" });
  await f.control({ op: "card", threadId: lt, kind: "question", requestId: "q1", text: "Which one?" });
  const sha = (await thread(f, lt)).find((m) => m.card?.requestId === "s1").card.skillRequest.sha256;
  let r = await runOmb(["status", "--project", dir], { env });
  assert.equal(r.json.pending[0].skillRequest.preview, "# release-notes\nA fixture proposal.\n", "the preview is in the JSON, for the user to read before deciding");
  r = await runOmb(["answer", "--allow", "--request", "s1", "--project", dir], { env });
  assert.equal(r.code, 2, r.stdout); assert.match(r.json.error, /--reviewed/); assert.match(r.json.hint, new RegExp(sha));
  r = await runOmb(["answer", "--allow", "--reviewed", "f".repeat(64), "--request", "s1", "--project", dir], { env });
  assert.equal(r.code, 2, r.stdout); assert.match(r.json.error, /not this card's/);
  r = await runOmb(["answer", "--allow", "--reviewed", "not-a-hash", "--request", "s1", "--project", dir], { env });
  assert.equal(r.code, 2, r.stdout); assert.match(r.json.error, /64 hex/);
  r = await runOmb(["answer", "--message", "looks fine", "--request", "s1", "--project", dir], { env });
  assert.equal(r.code, 2, r.stdout); assert.match(r.json.error, /learned-skill card/); assert.match(r.json.error, /reject/);
  r = await runOmb(["answer", "--allow", "--reviewed", sha, "--request", "q1", "--project", dir], { env });
  assert.equal(r.code, 2, r.stdout); assert.match(r.json.error, /--reviewed belongs to a learned-skill card/);
  assert.deepEqual(posts, [], "no decision reaches the server until the reviewed hash is this card's");
  r = await runOmb(["answer", "--allow", "--reviewed", sha, "--request", "s1", "--project", dir, "--dry-run"], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.dryRun, true); assert.equal(r.json.reviewedSha256, sha);
  assert.deepEqual(posts, []);
  r = await runOmb(["answer", "--allow", "--reviewed", sha, "--request", "s1", "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual({ ...r.json }, { ok: true, verb: "answer", requestId: "s1", threadId: lt, bot: "Sudo", cardKind: "skill", name: "release-notes", action: "create", behavior: "allow", outcome: "allowed-once" });
  assert.deepEqual((await f.snapshot()).skills, [`${lead.id}/release-notes`], "the allow is what installed it");
  assert.equal(posts.length, 1);
  r = await runOmb(["answer", "--allow", "--reviewed", sha, "--request", "s1", "--project", dir], { env });
  assert.equal(r.code, 3, "a settled card is no longer pending");
});

test("skill: a deny rejects the staged write, and a refused allow is reported in the server's words", async (t) => {
  const { f, dir } = await setup(t);
  const run = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  const lt = run.json.leadThreadId;
  const shaOf = async (id) => (await thread(f, lt)).find((m) => m.card?.requestId === id).card.skillRequest.sha256;
  await f.control({ op: "card", threadId: lt, kind: "skill", requestId: "s1", name: "noisy" });
  let r = await runOmb(["answer", "--deny", "--request", "s1", "--project", dir, "--brief"], { env });
  assert.equal(r.stdout, "answer · Sudo · deny → rejected\n");
  assert.deepEqual((await f.snapshot()).skills, [], "a denied proposal installs nothing");
  await f.control({ op: "card", threadId: lt, kind: "skill", requestId: "s2", name: "stale", stalePreview: true });
  r = await runOmb(["answer", "--allow", "--reviewed", await shaOf("s2"), "--request", "s2", "--project", dir], { env });
  assert.equal(r.code, 3, r.stdout); assert.equal(r.json.status, 422);
  assert.equal(r.json.error, "the skill preview changed after review — deny and recreate it");
  assert.match(r.json.hint, /deny this card and ask the bot to stage the skill again/);
  await f.control({ op: "card", threadId: lt, kind: "skill", requestId: "s3", name: "old", olderBuild: true });
  r = await runOmb(["answer", "--allow", "--reviewed", await shaOf("s3"), "--request", "s3", "--project", dir], { env });
  assert.equal(r.code, 3, r.stdout); assert.equal(r.json.status, 409);
  assert.equal(r.json.error, "this proposal was created by an older build — deny it and ask the bot to create it again");
  r = await runOmb(["answer", "--deny", "--request", "s3", "--project", dir], { env });
  assert.equal(r.code, 0, "a card the server will not allow can still be denied");
  assert.deepEqual((await f.snapshot()).skills, []);
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
  assert.equal(r.code, 2, r.stdout); assert.match(r.json.error, /is a connection request: use --connect, --resume or --dismiss/);
  const secret = await f.control({ op: "secret", threadId: novaThread, target: "ttsKey" });
  r = await runOmb(["answer", "--allow", "--request", secret.message.id, "--project", dir], { env });
  assert.equal(r.code, 2, r.stdout); assert.match(r.json.error, /is a credential request: use --provide, --resume or --dismiss/);
});

test("credential: the value reaches the server through the environment or stdin and appears nowhere else", async (t) => {
  const { f, dir, lead } = await setup(t);
  const run = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  const lt = run.json.leadThreadId;
  const VALUE = "xai-0d8e-never-log-me";
  const card = await f.control({ op: "secret", threadId: lt, target: "xaiApiKey", reason: "so Grok can run." });
  let r = await runOmb(["status", "--project", dir, "--brief"], { env });
  assert.equal(r.stdout, `t10 · CREDENTIAL · Sudo needs the xAI API key → OMB_SECRET=… omb answer --provide --request ${card.message.id} | --dismiss\n`);
  r = await runOmb(["answer", "--provide", "--secret", VALUE, "--project", dir], { env });
  assert.equal(r.code, 2, "there is no flag that would put a credential in argv"); assert.match(r.json.error, /Unknown option '--secret'/);
  r = await runOmb(["answer", "--provide", "--project", dir], { env });
  assert.equal(r.code, 5, r.stdout);
  assert.match(r.json.error, /ask the user for the xAI API key/);
  assert.match(r.json.hint, /OMB_SECRET or --secret-stdin, never in chat or argv/);
  assert.equal((await (await fetch(`${f.url}/api/config`)).json()).xai.configured, false, "nothing was saved without a value");
  r = await runOmb(["answer", "--provide", "--project", dir, "--dry-run"], { env: { ...env, OMB_SECRET: VALUE } });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.dryRun, true); assert.equal(r.stdout.includes(VALUE), false, "a preview shows the routes, never the value");
  assert.equal((await (await fetch(`${f.url}/api/config`)).json()).xai.configured, false);
  r = await runOmb(["answer", "--provide", "--project", dir], { env: { ...env, OMB_SECRET: `${VALUE}\n` } });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.provided, true); assert.equal(r.json.resumed, true); assert.equal(r.json.label, "xAI API key");
  assert.equal((await (await fetch(`${f.url}/api/config`)).json()).xai.configured, true, "one trailing newline is stripped and the rest is saved");
  assert.equal((await f.snapshot()).wakes.filter((w) => w.kind === "secret").length, 1, "the bot is woken to continue");
  const written = [r.stdout, r.stderr, JSON.stringify(await f.snapshot()), fs.readFileSync(path.join(dir, ".omb", "state.json"), "utf8"), JSON.stringify(await thread(f, lt))];
  for (const text of written) assert.equal(text.includes(VALUE), false, "the value is in no transcript, state file or control snapshot");
  const second = await f.control({ op: "secret", threadId: lt, target: "ttsKey" });
  r = await runOmb(["answer", "--provide", "--secret-stdin", "--request", second.message.id, "--project", dir], { env, stdin: "eleven-labs-key\n" });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.target, "ttsKey");
  assert.equal((await (await fetch(`${f.url}/api/config`)).json()).tts.configured, true);
  const third = await f.control({ op: "secret", threadId: lt, target: "openaiImageApiKey" });
  r = await runOmb(["answer", "--provide", "--secret-stdin", "--request", third.message.id, "--project", dir], { env: { ...env, OMB_SECRET: VALUE }, stdin: "x" });
  assert.equal(r.code, 2, r.stdout); assert.match(r.json.error, /not both/);
  assert.equal((await (await fetch(`${f.url}/api/config`)).json()).imageGen.configured, false, "two sources is a usage error before anything is saved");
  assert.equal(lead.name, "Sudo");
});

test("credential: a Box token is refused, a dismissal wakes the bot, and a save the card did not accept says so", async (t) => {
  const { f, dir } = await setup(t);
  const run = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  const lt = run.json.leadThreadId;
  const box = await f.control({ op: "secret", threadId: lt, target: "boxToken" });
  let r = await runOmb(["answer", "--provide", "--request", box.message.id, "--project", dir], { env: { ...env, OMB_SECRET: "box-token" } });
  assert.equal(r.code, 3, r.stdout);
  assert.match(r.json.error, /boxToken has cloud side effects; provide it in the app/);
  assert.equal((await (await fetch(`${f.url}/api/config`)).json()).box.configured, false, "a refused target is never saved");
  r = await runOmb(["answer", "--dismiss", "--request", box.message.id, "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.dismissed, true); assert.equal(r.json.resumed, true); assert.equal(r.json.woken, true);
  assert.equal((await f.snapshot()).wakes.filter((w) => w.kind === "secret").length, 1, "declining is an answer too: the bot continues without it");
  const VALUE = "opencode-0f2a-never-log-me";
  const card = await f.control({ op: "secret", threadId: lt, target: "opencodeGoApiKey" });
  await f.control({ op: "phoneSaving", messageId: card.message.id, saving: true });
  r = await runOmb(["answer", "--provide", "--request", card.message.id, "--project", dir], { env: { ...env, OMB_SECRET: VALUE } });
  assert.equal(r.code, 3, r.stdout);
  assert.match(r.json.error, /OpenCode API key was saved, the card was not resumed: this credential is currently being saved from a phone/);
  assert.match(r.json.hint, new RegExp(`the value is stored on the server now; omb answer --resume --request ${card.message.id} resumes the card without the value`));
  assert.equal((await (await fetch(`${f.url}/api/config`)).json()).opencodeGo.configured, true, "the save happened; only the card is behind");
  for (const text of [r.stdout, r.stderr, JSON.stringify(await f.snapshot()), fs.readFileSync(path.join(dir, ".omb", "state.json"), "utf8"), JSON.stringify(await thread(f, lt))]) {
    assert.equal(text.includes(VALUE), false, "a half-finished provide leaks the value no more than a finished one");
  }
  await f.control({ op: "phoneSaving", messageId: card.message.id, saving: false });
  r = await runOmb(["answer", "--resume", "--request", card.message.id, "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.provided, true); assert.equal(r.json.resumed, true); assert.equal(r.json.woken, true);
  assert.equal((await f.snapshot()).wakes.filter((w) => w.kind === "secret").length, 2, "the credential was never asked for a second time");
});

test("credential: --resume retries the card, and says where the value is when the server never got one", async (t) => {
  const { f, dir } = await setup(t);
  const run = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  const lt = run.json.leadThreadId;
  const posts = [];
  f.server.on("request", (req) => { if (req.method === "POST" && req.url.includes("/secret-cards/")) posts.push(req.url.split("/").pop()); });
  const unsaved = await f.control({ op: "secret", threadId: lt, target: "ttsKey" });
  let r = await runOmb(["answer", "--resume", "--request", unsaved.message.id, "--project", dir], { env });
  assert.equal(r.code, 3, r.stdout); assert.equal(r.json.status, 409);
  assert.equal(r.json.error, "ElevenLabs API key was not saved yet");
  assert.match(r.json.hint, new RegExp(`OMB_SECRET=… omb answer --provide --request ${unsaved.message.id}`));
  assert.deepEqual(posts, ["provided"], "an unresumed card is retried through provided, which needs no value");
  r = await runOmb(["answer", "--provide", "--request", unsaved.message.id, "--project", dir], { env: { ...env, OMB_SECRET: "eleven-labs-key" } });
  assert.equal(r.code, 0, r.stdout);
  // The wake itself can fail after the card was already marked provided
  // (S: server/index.ts:6767-6773); the card then holds the error, unresumed.
  await f.control({ op: "secretResumeFailed", messageId: unsaved.message.id, error: "the bot was busy" });
  r = await runOmb(["status", "--project", dir], { env });
  assert.equal(r.json.pending.length, 0, "a provided credential needs nothing more from the user");
  r = await runOmb(["answer", "--resume", "--request", unsaved.message.id, "--project", dir, "--dry-run"], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.dryRun, true); assert.equal(r.json.action, "resume");
  r = await runOmb(["answer", "--resume", "--request", unsaved.message.id, "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.resumed, true); assert.equal(r.json.provided, true);
  assert.deepEqual(posts.slice(-1), ["resume"], "a card that is already provided retries only the wake");
  assert.equal((await f.snapshot()).wakes.filter((w) => w.kind === "secret").length, 2);
  await f.control({ op: "token", token: "omb_sess_client", scopes: ["client"] });
  const another = await f.control({ op: "secret", threadId: lt, target: "openaiImageApiKey" });
  r = await runOmb(["answer", "--resume", "--request", another.message.id, "--project", dir], { env: { ...env, OMB_TOKEN: "omb_sess_client" } });
  assert.equal(r.code, 5, r.stdout);
  assert.equal(r.json.error, "forbidden: this session lacks the admin scope", "confirming a saved credential is the owner's step");
});

test("OMB_SECRET never reaches a server this launcher starts", () => {
  assert.equal(STRIPPED_ENV.includes("OMB_SECRET"), true);
});

test("connection: the authorization link is handed over once, and the resume waits for every app in the request", async (t) => {
  const { f, dir } = await setup(t);
  const run = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  const lt = run.json.leadThreadId;
  const reads = [];
  f.server.on("request", (req) => { if (req.url.includes("/connector-cards/")) reads.push(`${req.method} ${req.url.split("?")[0].split("/").slice(-2).join("/")}`); });
  const made = await f.control({ op: "connector", threadId: lt, items: [{ slug: "slack", label: "Slack" }, { slug: "github", label: "GitHub", alias: "work" }] });
  const [slack, github] = made.messages;
  let r = await runOmb(["status", "--project", dir, "--brief"], { env });
  assert.equal(r.stdout, `t10 · CONNECT · Sudo needs Slack (required) → omb answer --connect --request ${slack.id}\n`);
  r = await runOmb(["answer", "--connect", "--request", slack.id, "--project", dir, "--dry-run"], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.dryRun, true);
  assert.deepEqual(reads, [], "a preview asks the provider nothing");
  r = await runOmb(["answer", "--connect", "--request", slack.id, "--project", dir], { env });
  assert.equal(r.code, 5, "the user has to open the link");
  assert.match(r.json.url, /^https:\/\//);
  assert.equal(r.json.status, "authorizing"); assert.equal(r.json.label, "Slack");
  assert.deepEqual(r.json.siblings.map((s) => s.label), ["Slack", "GitHub"], "every app in one request is named, because they resume together");
  assert.equal(r.json.siblings[1].alias, "work");
  r = await runOmb(["answer", "--resume", "--request", slack.id, "--project", dir], { env });
  assert.equal(r.code, 3, r.stdout); assert.equal(r.json.error, "finish connecting every requested app first");
  await f.control({ op: "connectorAccount", messageId: slack.id, status: "ACTIVE" });
  r = await runOmb(["answer", "--resume", "--request", slack.id, "--project", dir], { env });
  assert.equal(r.code, 3, r.stdout); assert.equal(r.json.error, "finish connecting every requested app first");
  assert.equal(reads.filter((x) => x.startsWith("GET")).length, 4, "both resumes read the status of both siblings before attempting anything");
  r = await runOmb(["status", "--project", dir], { env });
  assert.equal(r.json.pending.length, 1, "the connected card no longer needs the user");
  assert.equal(r.json.pending[0].handle, github.id);
  await f.control({ op: "connectorAccount", messageId: github.id, status: "ACTIVE" });
  r = await runOmb(["answer", "--resume", "--request", slack.id, "--project", dir], { env });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.resumed, true); assert.equal(r.json.connected, true); assert.equal(r.json.status, "ACTIVE");
  assert.deepEqual(r.json.siblings.map((s) => s.connected), [true, true]);
  assert.equal((await f.snapshot()).wakes.filter((w) => w.kind === "connector").length, 1, "the bot is woken once, when the last app is connected");
  assert.equal((await runOmb(["status", "--project", dir], { env })).json.pending.length, 0);
});

test("connection: a dismissal leaves the bot asleep, and authorizing needs the owner", async (t) => {
  const { f, dir } = await setup(t);
  const run = await runOmb(["task", "--todo", "T10", "--project", dir], { env });
  const lt = run.json.leadThreadId;
  const made = await f.control({ op: "connector", threadId: lt, items: [{ slug: "notion", label: "Notion" }] });
  const id = made.messages[0].id;
  await f.control({ op: "token", token: "omb_sess_client", scopes: ["client"] });
  let r = await runOmb(["answer", "--connect", "--request", id, "--project", dir], { env: { ...env, OMB_TOKEN: "omb_sess_client" } });
  assert.equal(r.code, 5, r.stdout);
  assert.equal(r.json.error, "forbidden: this session lacks the admin scope");
  r = await runOmb(["answer", "--dismiss", "--request", id, "--project", dir], { env: { ...env, OMB_TOKEN: "omb_sess_client" } });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.dismissed, true); assert.equal(r.json.woken, false);
  assert.match(r.json.hint, /the bot is not woken/);
  assert.deepEqual((await f.snapshot()).wakes, [], "dismissing a connection tells the bot nothing");
  assert.equal((await runOmb(["status", "--project", dir], { env })).json.pending.length, 0);
});
