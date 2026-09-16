import test from "node:test";
import assert from "node:assert/strict";
import { watchRun } from "../skills/openmausbot-launcher/scripts/lib/watch.mjs";

const team = { lead: { id: "lead", name: "Lead" }, bots: [{ id: "lead", name: "Lead" }] };
const task = { runId: "a", status: "dispatched", tag: "oml:a", sentAt: 1000, leadThreadId: "la", threads: { lead: "la" }, lastEval: { lastChangeAt: 1000 } };
const client = {
  async stream(_route, signal) {
    return { status: 200, body: new ReadableStream({ start(controller) {
      signal.addEventListener("abort", () => { try { controller.close(); } catch {} }, { once: true });
    } }) };
  },
  async get(route) {
    if (route === "/api/bots?messages=0") return { bots: [{ ...team.lead, threadId: "la", busy: false, activity: "idle" }] };
    if (route === "/api/team-map") return { queued: [], running: [] };
    assert.match(route, /^\/api\/threads\/la\/messages/);
    return { messages: [{ id: "u", at: 1000, role: "user", kind: "text", text: "do it" }], hasMore: false };
  },
};
const watch = (options) => watchRun({ client, team, task, runs: [task], maxSeconds: 1, quietMs: 0, coalesceMs: 0, pollMs: 5, stallMs: 60_000, until: "change", ...options });

test("a live run's newer progress timestamp prevents a stale stalled verdict", async () => {
  const live = { ...task, lastEval: { lastChangeAt: Date.now() } };
  const result = await watch({ getRuns: () => [live] });
  assert.equal(result.ev.state, "running");
  assert.ok(result.lastChangeAt >= live.lastEval.lastChangeAt);
});

test("own progress recorded during a checkpoint wait invalidates its stalled decision", async () => {
  let live = structuredClone(task); let first = true;
  const written = [];
  const result = await watch({ getRuns: () => [live], checkpoint: async (r, opts) => {
    if (first) {
      first = false;
      live = { ...live, lastEval: { ...live.lastEval, lastChangeAt: Date.now() } };
    }
    opts.assertCurrent();
    written.push(r.ev.state);
    live = { ...live, cards: r.cards, lastEval: { ...live.lastEval, ...r.watermarks } };
    return true;
  } });
  assert.equal(result.ev.state, "running");
  assert.deepEqual(written, ["running"]);
});
