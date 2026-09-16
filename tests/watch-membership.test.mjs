import test from "node:test";
import assert from "node:assert/strict";
import { snapshot } from "../skills/openmausbot-launcher/scripts/lib/snapshot.mjs";

test("a remembered unresolved card survives its discovered helper leaving the team section", async () => {
  const lead = { id: "lead", name: "Lead", section: "s", threadId: "la", busy: false, activity: "idle" };
  const helper = { id: "helper", name: "Helper", section: "elsewhere", threadId: "helper-new", busy: false, activity: "idle" };
  const team = { section: "s", lead, bots: [lead] };
  const run = { runId: "a", sentAt: 1000, tag: "oml:a", leadThreadId: "la", threads: { lead: "la" },
    cards: { rq: { threadId: "helper-old", botId: "helper" } } };
  // Moving a bot's section does not settle its cards.
  // S: server/index.ts:10042-10083 (PATCH /api/bots/:id).
  const tails = {
    la: [{ id: "u", at: 1000, role: "user", kind: "text", text: "do it" },
      { id: "d", at: 2000, role: "bot", kind: "text", text: "DONE oml:a" }],
    "helper-old": [{ id: "q", at: 1500, role: "bot", kind: "options", card: { requestId: "rq", title: "Which?" } }],
  };
  const reads = [];
  const client = { async get(route) {
    if (route === "/api/bots?messages=0") return { bots: [lead, helper] };
    if (route === "/api/team-map") return { queued: [], running: [] };
    const id = /^\/api\/threads\/([^/]+)\/messages/.exec(route)?.[1];
    reads.push(id);
    assert.ok(Object.hasOwn(tails, id), `unexpected thread read: ${id}`);
    return { messages: structuredClone(tails[id]), hasMore: false };
  } };
  const snap = await snapshot(client, { team, task: run, runs: [run] });
  assert.ok(reads.includes("helper-old"), "remembered provenance remains readable outside current membership");
  assert.equal(snap.complete, true);
  assert.deepEqual(snap.pending.map((p) => p.requestId), ["rq"]);
  assert.equal(snap.pending[0].run, "a");
});
