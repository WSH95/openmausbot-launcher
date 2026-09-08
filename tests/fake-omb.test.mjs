// The contract fake must behave like OpenMausBot 0.1.56 on the paths the
// driver uses. Each test names the rule; the fixture cites the source line.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";
import { startFake, freePort, freePortPair, tmpDir, readSse, sleep, FAKE } from "./helpers.mjs";

const PKG = {
  format: "openmaus.package", version: 1,
  package: {
    id: "atw-dev-team", release: "0.4.2", name: "Dev team", tagline: "t", summary: "s", category: "engineering",
    author: { name: "wsh" }, license: "MIT", outcomes: ["x"], setupMinutes: 5, requirements: { apps: [], capabilities: ["shell"] },
    agents: [
      { key: "sudo", name: "Sudo", title: "Team Lead", description: "lead text\nProject facts (edit me): default branch: main. Test command: <fill in>.", appearance: { color: "blue" } },
      { key: "sage", name: "Sage", title: "Planner", appearance: { color: "green" } },
      { key: "nova", name: "Nova", title: "Implementer", appearance: { color: "red" } },
    ],
    chiefOfStaff: "sudo",
    rooms: [{ key: "dev-room", name: "Dev Room", members: ["sudo", "sage", "nova"], defaultResponder: { kind: "agent", agent: "sudo" } }],
  },
};
const j = async (res) => ({ status: res.status, body: await res.json() });
const post = (url, body, headers = {}) => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const patch = (url, body, headers = {}) => fetch(url, { method: "PATCH", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

async function importTeam(f) {
  const { status, body } = await j(await post(`${f.url}/api/teams/import?mode=add`, PKG));
  assert.equal(status, 201);
  return body;
}

test("health, environment, session, instances", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const h = await j(await fetch(`${f.url}/api/health`));
  assert.deepEqual(Object.keys(h.body).sort(), ["app", "pid", "static"]);
  assert.equal(h.body.app, "openmausbot");
  const env = await j(await fetch(`${f.url}/.well-known/openmausbot/environment`));
  assert.equal(env.body.environmentId, f.environmentId);
  assert.equal(fs.readFileSync(path.join(f.dataDir, "environment-id"), "utf8").trim(), f.environmentId);
  const s = await j(await fetch(`${f.url}/api/auth/session`));
  assert.deepEqual(s.body, { kind: "loopback", scopes: ["admin", "client"] });
  const i = await j(await fetch(`${f.url}/api/instances`));
  assert.ok(i.body.instances.some((x) => x.instanceId === "claude" && x.snapshot.state === "available"));
});

test("import is additive with fresh ids, numbered names, chief flag, rooms", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const a = await importTeam(f);
  assert.equal(a.bots.length, 3);
  assert.equal(a.bots.find((b) => b.name === "Sudo").chiefOfStaff, true);
  assert.equal(a.bots.find((b) => b.name === "Sage").chiefOfStaff, false);
  assert.equal(a.groups.length, 1);
  assert.equal(a.groups[0].memberIds.length, 3);
  assert.equal(a.group.id, a.groups[0].id);
  const b = await importTeam(f);
  assert.deepEqual(b.bots.map((x) => x.name), ["Sudo 2", "Sage 2", "Nova 2"]);
  assert.notEqual(b.bots[0].id, a.bots[0].id);
  assert.equal(b.name, "Dev team", "the response name is the package name, not the numbered section");
  assert.equal(b.bots[0].section, "Dev team 2");
  const long = structuredClone(PKG); long.package.tagline = "x".repeat(161);
  assert.equal((await post(`${f.url}/api/teams/import?mode=add`, long)).status, 400);
  assert.equal((await post(`${f.url}/api/teams/import?mode=replace`, PKG)).status, 400);
});

test("model PATCH: equal selection passes while busy, a change is 409, a pending grant is 409", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { bots } = await importTeam(f);
  const id = bots[0].id;
  let r = await j(await patch(`${f.url}/api/bots/${id}/model`, { instanceId: "codex", model: "gpt-6-astra", effort: "xhigh" }));
  assert.equal(r.status, 200); assert.deepEqual(r.body.bot.modelSelection, { instanceId: "codex", model: "gpt-6-astra", effort: "xhigh" });
  await f.control({ op: "activity", botId: id, activity: "working" });
  r = await j(await patch(`${f.url}/api/bots/${id}/model`, { instanceId: "codex", model: "gpt-6-astra", effort: "xhigh" }));
  assert.equal(r.status, 200, "unchanged selection while busy is accepted");
  r = await j(await patch(`${f.url}/api/bots/${id}/model`, { instanceId: "codex", model: "gpt-6-astra", effort: "high" }));
  assert.equal(r.status, 409); assert.match(r.body.error, /the bot is working/);
  await f.control({ op: "activity", botId: id, activity: "idle" });
  await f.control({ op: "approvalGrant", botId: id, pending: true });
  r = await j(await patch(`${f.url}/api/bots/${id}/model`, { instanceId: "codex", model: "gpt-6-astra", effort: "xhigh" }));
  assert.equal(r.status, 409, "a pending approval grant rejects even an unchanged selection");
  await f.control({ op: "approvalGrant", botId: id, pending: false });
  r = await j(await patch(`${f.url}/api/bots/${id}/model`, { instanceId: "codex", model: "x", effort: "turbo" }));
  assert.equal(r.status, 400);
});

test("bot PATCH: cwd and description while busy pass, approval change while busy is 409, description limit", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { bots } = await importTeam(f);
  const id = bots[0].id;
  await f.control({ op: "activity", botId: id, activity: "working" });
  let r = await j(await patch(`${f.url}/api/bots/${id}`, { cwd: "/tmp", description: "d" }));
  assert.equal(r.status, 200); assert.equal(r.body.bot.cwd, "/tmp"); assert.equal(r.body.bot.busy, true);
  r = await j(await patch(`${f.url}/api/bots/${id}`, { approvalMode: "auto" }));
  assert.equal(r.status, 409); assert.match(r.body.error, /approval level/);
  await f.control({ op: "activity", botId: id, activity: "idle" });
  r = await j(await patch(`${f.url}/api/bots/${id}`, { approvalMode: "auto" }));
  assert.equal(r.status, 200); assert.equal(r.body.bot.approvalMode, "auto");
  r = await j(await patch(`${f.url}/api/bots/${id}`, { approvalMode: "full" }));
  assert.equal(r.status, 403);
  r = await j(await patch(`${f.url}/api/bots/${id}`, { description: "x".repeat(4001) }));
  assert.equal(r.status, 400);
  r = await j(await patch(`${f.url}/api/bots/${id}`, { cwd: "relative" }));
  assert.equal(r.status, 400);
});

test("group PATCH: cwd is fixed once pinned, even when equal; other fields still pass", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { groups } = await importTeam(f);
  const g = groups[0].id;
  let r = await j(await patch(`${f.url}/api/groups/${g}`, { cwd: "/tmp" }));
  assert.equal(r.status, 200); assert.equal(r.body.group.cwd, "/tmp");
  await f.control({ op: "pinRoom", groupId: g });
  r = await j(await patch(`${f.url}/api/groups/${g}`, { cwd: "/tmp" }));
  assert.equal(r.status, 409); assert.match(r.body.error, /fixed after its first turn/);
  r = await j(await patch(`${f.url}/api/groups/${g}`, { bulletin: "hi" }));
  assert.equal(r.status, 200);
});

test("tasks: a fresh task becomes active; busy or a credential save is 409; titles may repeat", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { bots } = await importTeam(f);
  const id = bots[0].id;
  let r = await j(await post(`${f.url}/api/bots/${id}/tasks`, { title: "T10 [oml:abc]" }));
  assert.equal(r.status, 201); assert.equal(r.body.bot.threadId, r.body.task.threadId); assert.equal(r.body.task.title, "T10 [oml:abc]");
  const first = r.body.task.threadId;
  r = await j(await post(`${f.url}/api/bots/${id}/tasks`, { title: "T10 [oml:abc]" }));
  assert.equal(r.status, 201); assert.notEqual(r.body.task.threadId, first, "duplicate titles create a second task");
  assert.equal(r.body.bot.tasks.filter((x) => x.title === "T10 [oml:abc]").length, 2);
  await f.control({ op: "activity", botId: id, activity: "working" });
  r = await j(await post(`${f.url}/api/bots/${id}/tasks`, { title: "x" }));
  assert.equal(r.status, 409); assert.match(r.body.error, /working/);
  await f.control({ op: "activity", botId: id, activity: "idle" });
  await f.control({ op: "credential", botId: id, saving: true });
  r = await j(await post(`${f.url}/api/bots/${id}/tasks`, { title: "x" }));
  assert.equal(r.status, 409); assert.match(r.body.error, /credential/);
});

test("messages: 202 shapes, sendId dedupe and conflict, stale thread 409, queued and steered while busy", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { bots } = await importTeam(f);
  const id = bots[0].id; const thread = bots[0].threadId;
  let r = await j(await post(`${f.url}/api/bots/${id}/messages`, { text: "hello", threadId: thread, sendId: "s1" }));
  assert.equal(r.status, 202); assert.equal(r.body.ok, true); assert.equal(r.body.threadId, thread); assert.equal(r.body.message.role, "user");
  const firstId = r.body.message.id;
  r = await j(await post(`${f.url}/api/bots/${id}/messages`, { text: "hello", threadId: thread, sendId: "s1" }));
  assert.equal(r.status, 202); assert.equal(r.body.message.id, firstId, "a retry returns the canonical receipt");
  r = await j(await post(`${f.url}/api/bots/${id}/messages`, { text: "other", threadId: thread, sendId: "s1" }));
  assert.equal(r.status, 409); assert.match(r.body.error, /sendId already belongs/);
  r = await j(await post(`${f.url}/api/bots/${id}/messages`, { text: "", threadId: thread }));
  assert.equal(r.status, 400);
  r = await j(await post(`${f.url}/api/bots/${id}/messages`, { text: "x", threadId: "nope" }));
  assert.equal(r.status, 409); assert.match(r.body.error, /switched tasks/);
  const task = await j(await post(`${f.url}/api/bots/${id}/tasks`, { title: "T" }));
  r = await j(await post(`${f.url}/api/bots/${id}/messages`, { text: "x", threadId: thread }));
  assert.equal(r.status, 409, "a message to a task that is no longer active is refused, not retargeted");
  const active = task.body.task.threadId;
  await f.control({ op: "activity", botId: id, activity: "working" });
  r = await j(await post(`${f.url}/api/bots/${id}/messages`, { text: "q", threadId: active, sendId: "s2" }));
  assert.equal(r.status, 202); assert.equal(r.body.queued, true); assert.ok(r.body.queueId);
  r = await j(await post(`${f.url}/api/bots/${id}/messages`, { text: "q", threadId: active, sendId: "s2" }));
  assert.equal(r.body.queued, true, "a queued retry with the same sendId returns the queue receipt");
  await f.control({ op: "steer", enabled: true });
  r = await j(await post(`${f.url}/api/bots/${id}/messages`, { text: "steer me", threadId: active, sendId: "s3" }));
  assert.equal(r.status, 202); assert.equal(r.body.steered, true);
  await f.control({ op: "steer", enabled: true, lateConflict: true });
  r = await j(await post(`${f.url}/api/bots/${id}/messages`, { text: "late", threadId: active, sendId: "s4" }));
  assert.equal(r.status, 409, "a steer whose turn ended is a 409 after the fact");
});

test("thread messages: limit bounds, before cursor, hasMore; interrupt needs the right thread", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { bots } = await importTeam(f);
  const id = bots[0].id; const thread = bots[0].threadId;
  for (let i = 0; i < 5; i++) await f.control({ op: "leadSay", threadId: thread, text: `m${i}` });
  let r = await j(await fetch(`${f.url}/api/threads/${thread}/messages?limit=2`));
  assert.equal(r.status, 200); assert.deepEqual(r.body.messages.map((m) => m.text), ["m3", "m4"]); assert.equal(r.body.hasMore, true);
  assert.equal(r.body.messages[0].from, undefined, "direct turn text carries no from");
  const before = r.body.messages[0].id;
  r = await j(await fetch(`${f.url}/api/threads/${thread}/messages?limit=10&before=${before}`));
  assert.deepEqual(r.body.messages.map((m) => m.text), ["m0", "m1", "m2"]); assert.equal(r.body.hasMore, false);
  // S: index.ts:1937-1946 pageSize() clamps to MESSAGE_PAGE_MAX = 200 and is null only for a non-integer or negative; 8646 turns null into this 400.
  for (let i = 5; i < 205; i++) await f.control({ op: "leadSay", threadId: thread, text: `m${i}` });
  r = await j(await fetch(`${f.url}/api/threads/${thread}/messages?limit=201`));
  assert.equal(r.status, 200); assert.equal(r.body.messages.length, 200); assert.equal(r.body.hasMore, true); assert.equal(r.body.messages.at(-1).text, "m204");
  for (const bad of ["-1", "1.5", "abc"]) { r = await j(await fetch(`${f.url}/api/threads/${thread}/messages?limit=${bad}`)); assert.equal(r.status, 400, bad); assert.equal(r.body.error, "limit must be a non-negative whole number"); }
  assert.equal((await fetch(`${f.url}/api/threads/${thread}/messages?before=zzz`)).status, 404);
  await f.control({ op: "activity", botId: id, activity: "working" });
  r = await j(await post(`${f.url}/api/bots/${id}/interrupt`, { threadId: "other" }));
  assert.equal(r.status, 409);
  await f.control({ op: "busyElsewhere", botId: id, where: "room Dev Room" });
  r = await j(await post(`${f.url}/api/bots/${id}/interrupt`, { threadId: thread }));
  assert.equal(r.status, 409);
  await f.control({ op: "busyElsewhere", botId: id, where: null });
  r = await j(await post(`${f.url}/api/bots/${id}/interrupt`, { threadId: thread }));
  assert.equal(r.status, 200);
});

test("echoes carry the target's from and a spaced name; delegation activities and error activities have their shapes", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { bots } = await importTeam(f);
  const thread = bots[0].threadId;
  await f.control({ op: "echo", threadId: thread, fromBotId: bots[2].id, name: "Nova 2", text: "done" });
  await f.control({ op: "delegationActivity", threadId: thread, name: "Nova 2", variant: "failed", reason: "boom" });
  await f.control({ op: "errorActivity", threadId: thread, text: "rate limited" });
  const { body } = await j(await fetch(`${f.url}/api/threads/${thread}/messages`));
  const [echo, act, err] = body.messages;
  assert.equal(echo.from.botId, bots[2].id); assert.match(echo.text, /^@Nova 2 replied to the delegated task:\n\n/);
  assert.equal(act.kind, "activity"); assert.equal(act.tool.ok, false); assert.match(act.tool.name, /^Delegation to @Nova 2 failed — boom/);
  assert.equal(err.kind, "activity"); assert.match(err.tool.name, /^error:/); assert.equal(err.tool.ok, false);
});

test("respond outcomes: allowed-once, rejected, answered, unavailable (dead, unknown, already answered)", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { bots } = await importTeam(f);
  const id = bots[0].id; const thread = bots[0].threadId;
  await f.control({ op: "card", threadId: thread, requestId: "r1", kind: "approval" });
  await f.control({ op: "card", threadId: thread, requestId: "r2", kind: "approval" });
  await f.control({ op: "card", threadId: thread, requestId: "r3", kind: "question", text: "Which?" });
  await f.control({ op: "card", threadId: thread, requestId: "r4", kind: "question", dead: true });
  let r = await j(await post(`${f.url}/api/threads/${thread}/respond`, { requestId: "r1", behavior: "allow" }));
  assert.deepEqual(r.body, { ok: true, outcome: "allowed-once" });
  r = await j(await post(`${f.url}/api/bots/${id}/respond`, { requestId: "r2", behavior: "deny" }));
  assert.deepEqual(r.body, { ok: true, outcome: "rejected" });
  r = await j(await post(`${f.url}/api/threads/${thread}/respond`, { requestId: "r3", behavior: "answer", message: "the table" }));
  assert.deepEqual(r.body, { ok: true, outcome: "answered" });
  r = await j(await post(`${f.url}/api/threads/${thread}/respond`, { requestId: "r4", behavior: "answer", message: "x" }));
  assert.deepEqual(r.body, { ok: true, outcome: "unavailable" });
  r = await j(await post(`${f.url}/api/threads/${thread}/respond`, { requestId: "r1", behavior: "allow" }));
  assert.deepEqual(r.body, { ok: true, outcome: "unavailable" }, "an answered card is unavailable");
  r = await j(await post(`${f.url}/api/threads/${thread}/respond`, { requestId: "nope", behavior: "allow" }));
  assert.equal(r.body.outcome, "unavailable");
  const msgs = (await j(await fetch(`${f.url}/api/threads/${thread}/messages`))).body.messages;
  assert.equal(msgs.find((m) => m.card?.requestId === "r4").card.answered, true, "unavailable marks the dead card answered");
  const d = await j(await fetch(`${f.url}/api/decisions`));
  assert.equal(d.body.decisions.length, 3, "decisions is a log, not a pending queue");
});

test("team-map omits hidden bots and lists queued and running delegations", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { bots } = await importTeam(f);
  await f.control({ op: "queued", sourceBotId: bots[0].id, targetBotId: bots[1].id, reason: "plan" });
  await f.control({ op: "running", sourceBotId: bots[0].id, targetBotId: bots[2].id, threadId: "t1" });
  let r = await j(await fetch(`${f.url}/api/team-map`));
  assert.deepEqual(r.body.queued, [{ sourceBotId: bots[0].id, targetBotId: bots[1].id, reason: "plan" }]);
  assert.deepEqual(r.body.running, [{ sourceBotId: bots[0].id, targetBotId: bots[2].id, threadId: "t1" }]);
  await f.control({ op: "hide", botId: bots[2].id, hidden: true });
  r = await j(await fetch(`${f.url}/api/team-map`));
  assert.equal(r.body.running.length, 0);
});

test("receipts: newest first, deduplicated by id, capped, and pruned by age", async (t) => {
  const f = await startFake({ maxReceipts: 3, receiptMaxAgeMs: 1000 }); t.after(() => f.close());
  const file = path.join(f.dataDir, "delegation-receipts.json");
  await f.control({ op: "receipt", id: "a", sourceThreadId: "s", toBotName: "Sage", status: "completed", finishedAt: Date.now() - 5000 });
  await f.control({ op: "receipt", id: "b", sourceThreadId: "s", toBotName: "Sage" });
  await f.control({ op: "receipt", id: "b", sourceThreadId: "s", toBotName: "Sage" });
  await f.control({ op: "receipt", id: "c", sourceThreadId: "s", toBotName: "Nova" });
  await f.control({ op: "receipt", id: "d", sourceThreadId: "s", toBotName: "Quill" });
  await f.control({ op: "receipt", id: "e", sourceThreadId: "s", toBotName: "Quill" });
  const list = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(list.map((r) => r.id), ["e", "d", "c"], "old ones pruned by age and count; file length is not monotonic");
  assert.equal(list[0].status, "completed");
});

test("SSE: hello cursor, id lines, resume with since, replay, rejected foreign cursor, ping, screens filter", async (t) => {
  const f = await startFake({ heartbeatMs: 60, replayMax: 10 }); t.after(() => f.close());
  const { bots } = await importTeam(f);
  const thread = bots[0].threadId;
  let r = await readSse(`${f.url}/api/events?screens=off`, { ms: 200 });
  assert.equal(r.status, 200);
  assert.equal(r.frames[0].data.kind, "hello"); assert.equal(r.frames[0].data.resumed, false, "a cold start is not resumed");
  assert.ok(r.frames.some((x) => x.data.kind === "ping"), "keepalive pings arrive");
  const hello = r.frames[0].data.cursor;
  await f.control({ op: "leadSay", threadId: thread, text: "one" });
  await f.control({ op: "leadSay", threadId: thread, text: "two" });
  r = await readSse(`${f.url}/api/events?since=${encodeURIComponent(hello)}`, { ms: 150 });
  assert.equal(r.frames[0].data.resumed, true);
  const replayed = r.frames.filter((x) => x.data.kind === "message");
  assert.equal(replayed.length, 2, "frames after the cursor are replayed");
  assert.match(replayed[0].id, /^[0-9a-f]{8}:\d+$/); assert.equal(replayed[0].data.seq, Number(replayed[0].id.split(":")[1]));
  assert.ok(Number(replayed[1].id.split(":")[1]) > Number(replayed[0].id.split(":")[1]));
  r = await readSse(`${f.url}/api/events?since=deadbeef:1`, { ms: 100 });
  assert.equal(r.frames[0].data.resumed, false, "another stream's cursor is rejected");
  for (let i = 0; i < 12; i++) await f.control({ op: "leadSay", threadId: thread, text: `x${i}` });
  r = await readSse(`${f.url}/api/events?since=${encodeURIComponent(hello)}`, { ms: 100 });
  assert.equal(r.frames[0].data.resumed, false, "a cursor that fell off the replay buffer is not resumed");
  const head = (await readSse(`${f.url}/api/events`, { ms: 60 })).frames[0].data.cursor;
  await f.control({ op: "leadSay", threadId: thread, text: "after-head" });
  r = await readSse(`${f.url}/api/events`, { ms: 100, headers: { "last-event-id": head } });
  assert.equal(r.frames[0].data.resumed, true, "Last-Event-ID resumes too");
  assert.equal(r.frames.filter((x) => x.data.kind === "message").length, 1);
  await f.control({ op: "dropStreams", enabled: true });
  r = await readSse(`${f.url}/api/events`, { ms: 100 });
  assert.equal(r.frames.length, 0, "dropStreams closes the stream immediately");
});

test("auth: proxied loopback needs a session; client scope is default deny; admin token passes", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { bots } = await importTeam(f);
  assert.equal((await fetch(`${f.url}/api/bots`, { headers: { "x-forwarded-for": "1.2.3.4" } })).status, 401);
  await f.control({ op: "token", token: "omb_sess_client", scopes: ["client"] });
  await f.control({ op: "token", token: "omb_sess_admin", scopes: ["admin", "client"] });
  const c = { authorization: "Bearer omb_sess_client" };
  assert.equal((await fetch(`${f.url}/api/bots`, { headers: c })).status, 200);
  assert.equal((await post(`${f.url}/api/bots/${bots[0].id}/tasks`, { title: "t" }, c)).status, 201, "client scope can open tasks");
  assert.equal((await patch(`${f.url}/api/bots/${bots[0].id}/model`, { instanceId: "codex", model: "x" }, c)).status, 403);
  assert.equal((await post(`${f.url}/api/teams/import?mode=add`, PKG, c)).status, 403);
  assert.equal((await patch(`${f.url}/api/bots/${bots[0].id}`, { cwd: "/tmp" }, c)).status, 403, "cwd is not a display field");
  assert.equal((await patch(`${f.url}/api/bots/${bots[0].id}`, { cwd: "/tmp" }, { authorization: "Bearer omb_sess_admin" })).status, 200);
  assert.equal((await fetch(`${f.url}/api/bots`, { headers: { authorization: "Bearer omb_sess_nope" } })).status, 401);
  const s = await j(await fetch(`${f.url}/api/auth/session`, { headers: c }));
  assert.deepEqual(s.body, { kind: "session", scopes: ["client"] });
  const sse = await readSse(`${f.url}/api/events`, { ms: 80, headers: c });
  assert.equal(sse.status, 200, "a bearer token works on the event stream");
});

test("notifications can be off per bot; delayed responses; new environment id", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { bots } = await importTeam(f);
  await f.control({ op: "notifications", botId: bots[0].id, enabled: false });
  const r = await f.control({ op: "notify", kind: "question", botId: bots[0].id });
  assert.equal(r.suppressed, true);
  await f.control({ op: "delay", count: 1, ms: 300 });
  const t0 = Date.now(); await fetch(`${f.url}/api/health`); assert.ok(Date.now() - t0 >= 250);
  const before = f.environmentId;
  await f.control({ op: "newEnvironment" });
  assert.notEqual(f.environmentId, before);
  assert.equal((await j(await fetch(`${f.url}/.well-known/openmausbot/environment`))).body.environmentId, f.environmentId);
});

test("serve spawns a child that answers health with its own pid; SIGTERM to the supervisor stops both", async (t) => {
  const port = await freePortPair();
  const dataDir = tmpDir("oml-serve-");
  const sup = spawn(process.execPath, [FAKE, "serve", "--port", String(port), "--data-dir", dataDir, "--no-pair"], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { try { sup.kill("SIGKILL"); } catch {} });
  let out = ""; sup.stdout.on("data", (c) => { out += c; });
  const deadline = Date.now() + 10_000;
  while (!/OpenMausBot is running/.test(out) && Date.now() < deadline) await sleep(50);
  assert.match(out, /OpenMausBot is running on http:\/\/127\.0\.0\.1:\d+/);
  const h = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
  assert.notEqual(h.pid, sup.pid, "health reports the child, not the supervisor");
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${port + 1}/health`)).json(), { app: "openmausbot-webhooks", ready: true }, "serve binds port+1 like cli.ts:438");
  assert.match(out, new RegExp(`openmausbot webhook receiver on http://127\\.0\\.0\\.1:${port + 1}`));
  if (process.platform === "linux") {
    const status = fs.readFileSync(`/proc/${h.pid}/status`, "utf8");
    assert.match(status, new RegExp(`^PPid:\\s+${sup.pid}$`, "m"), "the child's parent is the supervisor");
  }
  assert.equal(fs.readFileSync(path.join(dataDir, "environment-id"), "utf8").trim().length > 0, true);
  sup.kill("SIGTERM");
  await new Promise((resolve) => sup.on("exit", resolve));
  await sleep(100);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`), "the child is gone after the supervisor stops");
  if (process.platform === "linux") assert.equal(fs.existsSync(`/proc/${h.pid}`), false);
});

test("real cards use options messages and typed payloads instead of card.kind", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { bots } = await importTeam(f); const threadId = bots[0].threadId;
  for (const kind of ["question", "approval", "skill", "routine"]) {
    const { message } = await f.control({ op: "card", threadId, kind, choices: ["Table", "List"], text: "Choose a layout", requestId: kind });
    assert.equal(message.kind, "options");
    assert.equal(message.card.kind, undefined);
    assert.equal(typeof message.card.title, "string");
    assert.equal(message.card.subtitle, "Choose a layout");
    if (kind === "question") { assert.equal(message.card.tool, undefined); assert.deepEqual(message.card.options, ["Table", "List"]); }
    if (kind === "approval") assert.equal(message.card.tool, "ask_bot");
    if (kind === "skill") assert.ok(message.card.skillRequest);
    if (kind === "routine") {
      const request = message.card.routineRequest;
      assert.equal(request.version, 1);
      assert.equal(request.requestId, "routine");
      assert.equal(request.threadId, threadId);
      assert.equal(request.operation.action, "create");
      assert.equal(request.operation.routine.runOn, "maus");
      assert.deepEqual(message.card.options, ["Confirm", "Cancel"]);
    }
  }
  let r = await j(await post(`${f.url}/api/threads/${threadId}/respond`, { requestId: "skill", behavior: "allow" }));
  assert.equal(r.status, 409); assert.equal(r.body.error, "reviewedSha256 must match the skill shown on the approval card");
  r = await j(await post(`${f.url}/api/threads/${threadId}/respond`, { requestId: "skill", behavior: "deny" }));
  assert.equal(r.body.outcome, "rejected");
  r = await j(await post(`${f.url}/api/threads/${threadId}/respond`, { requestId: "routine", behavior: "answer", message: "yes" }));
  assert.equal(r.status, 400); assert.equal(r.body.error, "Routine confirmations must be confirmed or cancelled");
  r = await j(await post(`${f.url}/api/threads/${threadId}/respond`, { requestId: "routine", behavior: "allow" }));
  assert.equal(r.body.outcome, "allowed-once");
  assert.equal(r.body.routineAction, "create"); assert.equal(typeof r.body.resultId, "string");
});

test("the webhook receiver on port+1: /health answers, everything else is a 404, a taken port is logged and not fatal", async (t) => {
  const webhookPort = await freePort();
  const f = await startFake({ webhookPort }); t.after(() => f.close());
  assert.equal(f.webhookPort, webhookPort);
  let r = await j(await fetch(`http://127.0.0.1:${webhookPort}/health`));
  assert.equal(r.status, 200); assert.deepEqual(r.body, { app: "openmausbot-webhooks", ready: true });
  r = await j(await fetch(`http://127.0.0.1:${webhookPort}/api/health`));
  assert.equal(r.status, 404); assert.deepEqual(r.body, { error: "Unknown webhook endpoint" });
  const taken = await freePort();
  const blocker = net.createServer(); await new Promise((res) => blocker.listen(taken, "127.0.0.1", res)); t.after(() => blocker.close());
  const g = await startFake({ webhookPort: taken }); t.after(() => g.close());
  assert.equal(g.webhookPort, null, "the API still serves when the receiver cannot bind (index.ts:4877-4879)");
  assert.equal((await fetch(`${g.url}/api/health`)).status, 200);
});

test("a created bot has no approvalMode until PATCHed; approvePeerComms must be boolean and is read back", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { bots } = await importTeam(f);
  const id = bots[0].id;
  assert.equal(bots[0].approvalMode, undefined, "createBot writes no approvalMode (store.ts:1303-1335)");
  let r = await j(await patch(`${f.url}/api/bots/${id}`, { approvePeerComms: "yes" }));
  assert.equal(r.status, 400); assert.equal(r.body.error, "approvePeerComms must be true or false");
  r = await j(await patch(`${f.url}/api/bots/${id}`, { approvePeerComms: true }));
  assert.equal(r.status, 200); assert.equal(r.body.bot.approvePeerComms, true);
  const live = (await j(await fetch(`${f.url}/api/bots?messages=0`))).body.bots.find((b) => b.id === id);
  assert.equal(live.approvePeerComms, true); assert.equal(live.approvalMode, undefined);
  r = await j(await patch(`${f.url}/api/bots/${id}`, { approvalMode: "ask" }));
  assert.equal(r.status, 200); assert.equal(r.body.bot.approvalMode, "ask", "a PATCH materialises the field (index.ts:10145-10168)");
});
