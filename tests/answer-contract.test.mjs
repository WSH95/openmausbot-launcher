import test from "node:test";
import assert from "node:assert/strict";
import { startFake } from "./helpers.mjs";

async function setup(t) {
  const f = await startFake(); t.after(() => f.close());
  const { bot } = await f.control({ op: "bot", name: "Lead" });
  const call = async (method, route, body, headers = {}) => {
    const r = await fetch(`${f.url}${route}`, { method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json() };
  };
  const card = (kind, extra = {}) => f.apply({ op: "card", kind, threadId: bot.threadId, ...extra }).message.card;
  const respond = (card, behavior, extra = {}) => call("POST", `/api/threads/${bot.threadId}/respond`, { requestId: card.requestId, behavior, ...extra });
  return { f, bot, call, card, respond };
}

test("fake config accepts empty credential strings as clearing, rejects wrong types, and never returns values", async (t) => {
  const { call } = await setup(t);
  for (const [section, field] of [["xai", "key"], ["box", "token"], ["opencodeGo", "apiKey"], ["tts", "key"], ["imageGen", "key"]]) {
    let r = await call("PUT", "/api/config", { [section]: { [field]: "" } });
    assert.equal(r.status, 200, `${section}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body[section].configured, false);
    r = await call("PUT", "/api/config", { [section]: { [field]: 7 } });
    assert.equal(r.status, 400);
    assert.match(r.body.error, new RegExp(`^${section}\\.${field} .*string`));
  }
  const r = await call("PUT", "/api/config", { unrecognized: true });
  assert.deepEqual(r, { status: 400, body: { error: "nothing to save" } });
});

test("fake config validates section and feature types and accepts empty known sections", async (t) => {
  const { call } = await setup(t);
  assert.equal((await call("PUT", "/api/config", { xai: {} })).status, 200);
  assert.equal((await call("PUT", "/api/config", { features: {} })).status, 200);
  for (const [body, path, type] of [[{ xai: "invalid" }, "xai", "object"], [{ features: null }, "features", "object"], [{ features: { skillRecorder: "true" } }, "features.skillRecorder", "boolean"]]) {
    const r = await call("PUT", "/api/config", body);
    assert.equal(r.status, 400);
    assert.match(r.body.error, new RegExp(`^${path} .*${type}`));
  }
});

test("fake skill settlement checks the trusted owner and provides verification and cleanup routes", async (t) => {
  const { bot, card, call, respond } = await setup(t);
  const bad = card("skill", { name: "foreign" }); bad.skillRequest.botId = "another-bot";
  let r = await respond(bad, "deny");
  assert.deepEqual(r, { status: 403, body: { error: "this skill request belongs to a different bot" } });
  const good = card("skill", { name: "release-notes" });
  r = await respond(good, "allow", { reviewedSha256: good.skillRequest.sha256 });
  assert.equal(r.status, 200);
  const route = `/api/bots/${bot.id}/skills/release-notes`;
  assert.deepEqual(await call("GET", route), { status: 200, body: { text: good.skillRequest.preview } });
  assert.equal((await call("DELETE", route)).status, 200);
  assert.deepEqual(await call("GET", route), { status: 404, body: { error: "no such skill" } });
  assert.equal((await call("DELETE", route)).body.error, 'no imported skill named "release-notes"');
});

test("fake skill approval binds the card to the independently staged operation", async (t) => {
  const { card, respond } = await setup(t);
  for (const field of ["requestId", "threadId", "name", "source", "action"]) {
    const changed = card("skill", { name: "original" });
    changed.skillRequest[field] = "changed";
    const r = await respond(changed, "allow", { reviewedSha256: changed.skillRequest.sha256 });
    assert.deepEqual(r, { status: 422, body: { error: "the staged skill no longer matches this approval card" } }, field);
  }
});

test("fake routines retain the safe cancel escape for mismatched payloads and record decisions once", async (t) => {
  const { f, bot, card, call, respond } = await setup(t);
  for (const [field, value, status, error] of [
    ["requestId", "different", 400, "This routine request id does not match its confirmation card"],
    ["botId", "different", 403, "This routine request belongs to another conversation"],
    ["threadId", "different", 403, "This routine request belongs to another conversation"],
  ]) {
    const bad = card("routine"); bad.routineRequest[field] = value;
    assert.deepEqual(await respond(bad, "allow"), { status, body: { error } });
    assert.equal(bad.held, undefined, "payload ownership refusals do not write held");
    assert.equal((await respond(bad, "deny")).body.outcome, "rejected");
  }
  const good = card("routine", { name: "Nightly" });
  const r = await respond(good, "allow");
  assert.equal(r.body.routineAction, "create");
  await respond(good, "allow");
  const decisions = (await f.snapshot()).decisions;
  assert.equal(decisions.length, 4, "three denials and one approval; settled replay adds none");
  assert.equal(decisions[0].decision, "user-approved");
  assert.equal(decisions[0].botId, bot.id);
  assert.equal(decisions[0].source, "user");
  await f.control({ op: "token", token: "omb_sess_client", scopes: ["client"] });
  assert.equal((await call("DELETE", `/api/routines/${r.body.resultId}`, undefined, { authorization: "Bearer omb_sess_client" })).status, 200);
  assert.deepEqual(await call("DELETE", `/api/routines/${r.body.resultId}`), { status: 404, body: { error: "no such routine" } });
});

test("fake routine run_now reports a run id and stale changes carry held", async (t) => {
  const { card, call, respond } = await setup(t);
  await respond(card("routine", { name: "Nightly" }), "allow");
  const routine = (await call("GET", "/api/routines")).body.routines[0];
  const stale = card("routine", { action: "pause", routineId: routine.id, expectedUpdatedAt: routine.updatedAt - 1 });
  const refusal = await respond(stale, "allow");
  assert.equal(refusal.status, 409); assert.equal(stale.held, refusal.body.error);
  const run = await respond(card("routine", { action: "run_now", routineId: routine.id, expectedUpdatedAt: routine.updatedAt }), "allow");
  assert.equal(run.body.routineAction, "run_now");
  assert.notEqual(run.body.resultId, routine.id);
  assert.equal((await call("GET", "/api/routines")).body.runs[0].id, run.body.resultId);
});

test("fake connector authorization failures use the source status and leave a failed card", async (t) => {
  const { f, bot, call } = await setup(t);
  const made = await f.control({ op: "connector", threadId: bot.threadId, items: [{ slug: "slack" }, { slug: "slack" }] });
  const [existing, next] = made.messages;
  await f.control({ op: "connectorAccount", messageId: existing.id, status: "ACTIVE" });
  const r = await call("POST", `/api/bots/${bot.id}/connector-cards/${next.id}/authorize`, { threadId: bot.threadId });
  assert.deepEqual(r, { status: 400, body: { error: "Add an account alias so the existing connection is not replaced" } });
  const messages = (await call("GET", `/api/threads/${bot.threadId}/messages`)).body.messages;
  assert.equal(messages.find((m) => m.id === next.id).connector.status, "failed");
});
