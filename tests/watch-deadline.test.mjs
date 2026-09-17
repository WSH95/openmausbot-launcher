import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { watchRun } from "../skills/openmausbot-launcher/scripts/lib/watch.mjs";
import { deliverToLead } from "../skills/openmausbot-launcher/scripts/lib/verbs/run.mjs";
import { HttpError } from "../skills/openmausbot-launcher/scripts/lib/http.mjs";
import { tmpDir, heldWatchTimers } from "./helpers.mjs";
import { setImmediate as turn } from "node:timers/promises";

test("delivery preserves a child timeout before the outer clock reports expiry", async (t) => {
  t.mock.method(performance, "now", () => 0);
  const posts = [];
  let finishRead;
  const client = {
    async post(route) {
      posts.push(route);
      throw new HttpError("POST", route, 409, { error: "the bot switched tasks before it could receive the message" });
    },
    async get() {
      return new Promise((resolve) => { finishRead = resolve; });
    },
  };
  await assert.rejects(deliverToLead(client, {
    leadId: "lead", run: { leadThreadId: "la" }, otherRuns: [{ leadThreadId: "lb" }],
    text: "status?", sendId: "n", deadline: 15,
  }), /observation deadline reached/);
  assert.equal(typeof finishRead, "function", "the active-task read was pending when its timer expired");
  finishRead({ bots: [{ id: "lead", threadId: "lb" }] });
  await turn();
  assert.deepEqual(posts, ["/api/bots/lead/messages"], "the expired read cannot trigger a detached switch or retry");
});

// ── reaching the deadline in the idle wait is an observation boundary (oml-jc1) ──
// A wait the deadline bounded can wake a millisecond early: `outOfBudget` counts
// a whole remaining millisecond as budget, so the loop started one more read,
// which replaced a verified observation with one that cannot come back in time.

const team = { section: "s", lead: { id: "lead", name: "Lead" }, bots: [{ id: "lead", name: "Lead" }, { id: "worker", name: "Worker" }] };
const a = { runId: "a", tag: "oml:a", sentAt: 1000, leadThreadId: "la", threads: { lead: "la", worker: "w" } };
const b = { runId: "b", tag: "oml:b", sentAt: 1000, leadThreadId: "lb", threads: { lead: "lb", worker: "w" }, implementer: { id: "worker", name: "Worker" } };
const user = { id: "u", at: 1000, role: "user", kind: "text", text: "do it" };
const planning = { id: "s", at: 2000, role: "bot", kind: "text", text: "Planning now." };

/** An in-process server for one watch: scripted REST reads, a stream the test
 * can push frames into, and a second snapshot that never finishes — the read a
 * millisecond of budget would start cannot come back in time, so a watch that
 * starts one returns unverified (tests/watch-drain.test.mjs:23). */
function fixture({ threads = { la: [user, planning], lb: [], w: [] }, stream = true } = {}) {
  const data = {
    bots: team.bots.map((bot) => ({ ...bot, section: "s", threadId: bot.id === "lead" ? "la" : "w", busy: false, activity: "idle" })),
    threads, map: { queued: [], running: [] },
  };
  let controller; let seq = 0; let reads = 0;
  const f = {
    data, onStall: null, stallAfter: 1,
    get reads() { return reads; },
    /** Put a frame on the stream. Awaiting `turn` lets the reader classify it;
     * without that the frame is still in flight, which is how a test arranges
     * for it to arrive in the same instant as the deadline. */
    enqueue(frame) { controller.enqueue(new TextEncoder().encode(`id: s:${++seq}\ndata: ${JSON.stringify(frame)}\n\n`)); },
    async push(frame) { f.enqueue(frame); await turn(); },
    client: {
      async stream(_url, signal) {
        if (!stream) throw new Error("stream unavailable");
        return { status: 200, body: new ReadableStream({ start(c) {
          controller = c;
          signal.addEventListener("abort", () => { try { c.close(); } catch {} }, { once: true });
        } }) };
      },
      async get(route) {
        let value;
        if (route === "/api/bots?messages=0") { reads++; value = { bots: data.bots }; }
        else if (route === "/api/team-map") value = data.map;
        else {
          const id = /^\/api\/threads\/([^/]+)\/messages/.exec(route)?.[1];
          if (!Object.hasOwn(data.threads, id)) throw new Error(`unknown route ${route}`);
          value = { messages: data.threads[id], hasMore: false };
        }
        const copy = structuredClone(value);
        // A second snapshot outlasts the budget: the clock passes the deadline
        // while it waits, and its parts are cancelled where they stand.
        if (reads > f.stallAfter) { f.onStall?.(); await new Promise(() => {}); }
        return copy;
      },
    },
  };
  return f;
}

async function watchToItsIdleWait(t, options = {}, f = fixture()) {
  const c = heldWatchTimers(t);
  const state = { checkpoints: 0 };
  const deadline = (options.maxSeconds ?? 1) * 1000;
  f.onStall = () => c.at(deadline + 1);
  const p = watchRun({
    client: f.client, team, task: a, runs: [a, b], maxSeconds: 1, quietMs: 30_000, pollMs: 5000, coalesceMs: 0, stallMs: Infinity,
    checkpoint: async (r, opts) => { opts.assertCurrent(); state.checkpoints++; return true; }, ...options,
  });
  return { c, f, p: c.finish(p), state, wait: await c.until("wokeUp") };
}

test("a wait the deadline bounded ends the watch on its last verified observation", async (t) => {
  const { c, f, p, state, wait } = await watchToItsIdleWait(t);
  assert.equal(wait.ms, 1000, "the deadline bounded this wait");
  assert.equal(c.held("reachDeadline").ms, 1000, "and the absolute timer, which this watch never needs, is armed for the whole budget");
  assert.equal(f.reads, 1);
  wait.fire(998.5); // its own timer, a millisecond and a half before the deadline
  const r = await p;
  assert.equal(f.reads, 1, "no read is started with a millisecond of budget left");
  assert.equal(r.outcome, "timeout"); assert.equal(r.snap.complete, true);
  assert.deepEqual(r.ev.reasons, ["idle for 1 s when the watch budget ended; the 30 s quiet window was not confirmed"]);
  assert.equal(r.checkpointed, true); assert.equal(state.checkpoints, 1);
});

for (const [label, options, ms] of [["the poll interval", { pollMs: 300 }, 300], ["the quiet window", { quietMs: 600 }, 600]]) {
  test(`the absolute deadline timer ends a wait ${label} bounded`, async (t) => {
    const { c, f, p, state, wait } = await watchToItsIdleWait(t, options);
    assert.equal(wait.ms, ms, `${label} bounded this wait`);
    c.held("reachDeadline").fire(998.5);
    const r = await p;
    assert.equal(f.reads, 1, "no read is started with a millisecond of budget left");
    assert.equal(r.outcome, "timeout"); assert.equal(r.snap.complete, true);
    assert.match(r.ev.reasons[0], /^idle for 1 s when the watch budget ended/);
    assert.equal(r.checkpointed, true); assert.equal(state.checkpoints, 1);
  });
}

for (const [kind, frame] of [
  ["own", { kind: "message", threadId: "la" }],
  ["ownership", { kind: "message", threadId: "lb" }],
  ["other", { kind: "bot", bot: { id: "worker", name: "Worker", section: "s", threadId: "w", busy: true, activity: "working" } }],
]) {
  test(`a ${kind} frame that arrives as the deadline does is hydrated before the watch gives up its budget`, async (t) => {
    const { c, f, p, state } = await watchToItsIdleWait(t);
    f.enqueue(frame); // still in flight when the absolute timer fires
    c.held("reachDeadline").fire(998.5);
    const r = await p;
    assert.equal(f.reads, 2, "traffic is read again, whatever the clock says");
    assert.equal(r.outcome, "timeout"); assert.equal(r.snap.complete, false);
    assert.deepEqual(r.ev.reasons, ["observation deadline reached before verification"]);
    assert.equal(state.checkpoints, 0);
  });
}

test("an invalidated deadline wake cannot end the following ordinary poll wait", async (t) => {
  const f = fixture(); f.stallAfter = 2;
  const { c, p, state } = await watchToItsIdleWait(t, { pollMs: 0.5 }, f);
  f.enqueue({ kind: "message", threadId: "la" });
  c.held("reachDeadline").fire(998.5);
  const second = await c.until("wokeUp");
  assert.equal(f.reads, 2, "the invalidated first wait completed its required re-read");
  assert.equal(second.ms, 0.5, "the second wait is poll-bound");
  second.fire(999);
  const r = await p;
  assert.equal(f.reads, 3, "the ordinary poll must start a third read");
  assert.equal(r.snap.complete, false); assert.equal(state.checkpoints, 0);
});

test("a receipt written during the wait is hydrated before the watch gives up its budget", async (t) => {
  let notifyReceipt;
  t.mock.method(fs, "watch", (_dir, callback) => { notifyReceipt = callback; return { close() {} }; });
  const dataDir = tmpDir("oml-receipts-");
  fs.writeFileSync(path.join(dataDir, "delegation-receipts.json"), "[]");
  const { c, f, p } = await watchToItsIdleWait(t, { dataDir });
  fs.writeFileSync(path.join(dataDir, "delegation-receipts.json"), JSON.stringify([{ sourceThreadId: "la", toBotName: "Worker", status: "completed" }]));
  notifyReceipt("change", "delegation-receipts.json");
  c.held("reachDeadline").fire(998.5);
  const r = await p;
  assert.equal(f.reads, 2, "a receipt has no frame of its own and is evidence all the same");
  assert.equal(r.outcome, "timeout"); assert.equal(r.snap.complete, false);
});

for (const source of ["run list", "history"]) test(`a ${source} that changed silently is read again before the watch gives up its budget`, async (t) => {
  const live = [{ ...a }, b];
  const history = [];
  const { f, p, state, wait } = await watchToItsIdleWait(t, { runs: live, getRuns: () => live, history, getHistory: () => history });
  if (source === "run list") live[0] = { ...live[0], cards: { rq: "a" } };
  else history.push({ ...b, runId: "past", status: "closed", closedAt: new Date().toISOString() });
  wait.fire(998.5);
  const r = await p;
  assert.equal(f.reads, 2, "local inputs are refreshed, whatever the clock says");
  assert.equal(r.outcome, "timeout"); assert.equal(r.snap.complete, false);
  assert.equal(state.checkpoints, 0);
});

for (const [source, options] of [["poll", { pollMs: 300 }], ["quiet", { quietMs: 300 }]]) test(`an ordinary ${source} wake before the deadline reads again`, async (t) => {
  const { f, p, state, wait } = await watchToItsIdleWait(t, options);
  assert.equal(wait.ms, 300);
  wait.fire(300);
  const r = await p;
  assert.equal(f.reads, 2, `${source} is a read, not a boundary`);
  assert.equal(r.outcome, "timeout"); assert.equal(r.snap.complete, false);
  assert.deepEqual(r.ev.reasons, ["observation deadline reached before verification"]);
  assert.equal(state.checkpoints, 0);
});

test("the deadline wins an exact tie with the poll interval", async (t) => {
  const { f, p, state, wait } = await watchToItsIdleWait(t, { pollMs: 1000 });
  assert.equal(wait.ms, 1000, "both terms are 1000 ms");
  wait.fire(998.5);
  const r = await p;
  assert.equal(f.reads, 1); assert.equal(r.outcome, "timeout");
  assert.equal(r.checkpointed, true); assert.equal(state.checkpoints, 1);
});

test("a run already quiet has no quiet term, and still ends at the deadline boundary", async (t) => {
  // quietMs 0 makes `ev.quiet` true, so the wait's quiet term is Infinity.
  const { f, p, state, wait } = await watchToItsIdleWait(t, { quietMs: 0 }, fixture({ threads: { la: [user], lb: [], w: [] } }));
  assert.equal(wait.ms, 1000);
  wait.fire(998.5);
  const r = await p;
  assert.equal(f.reads, 1); assert.equal(r.outcome, "timeout"); assert.equal(r.snap.complete, true);
  assert.equal(r.ev.quiet, true); assert.deepEqual(r.ev.reasons, ["the lead has not answered the latest message yet"]);
  assert.equal(r.checkpointed, true); assert.equal(state.checkpoints, 1);
});

test("polling-only mode ends at the same boundary", async (t) => {
  const f = fixture({ stream: false });
  const c = heldWatchTimers(t, { retryPauses: true });
  let checkpoints = 0;
  const p = watchRun({
    client: f.client, team, task: a, runs: [a, b], maxSeconds: 10, quietMs: 30_000, pollMs: 20_000, coalesceMs: 0, stallMs: Infinity,
    checkpoint: async (r, opts) => { opts.assertCurrent(); checkpoints++; return true; },
  });
  const bounded = c.finish(p);
  (await c.until("done")).fire(2000);
  (await c.until("done")).fire(4000);
  const wait = await c.until("wokeUp");
  assert.equal(wait.ms, 6000, "only virtual retry time was spent");
  wait.fire(9998.5);
  const r = await bounded;
  assert.equal(f.reads, 1, "no read is started after the boundary"); assert.equal(r.pollingOnly, true);
  assert.equal(r.outcome, "timeout"); assert.equal(r.snap.complete, true);
  assert.equal(r.checkpointed, true); assert.equal(checkpoints, 1);
});

test("a held wait that is never released fails within a bounded real time", async (t) => {
  const { c, p } = await watchToItsIdleWait(t);
  await assert.rejects(c.finish(p, 20), /the held watch did not finish/);
});

// ── a startup that reaches the deadline ends the observation (oml-47p) ──
// `streamReady` only resolves, so the guard that waits for it can only reject
// with its own deadline, a millisecond before `outOfBudget` agrees. Neither the
// loop nor the fallback snapshot may read on a startup that never established
// the stream, and the operator gets a timeout, not exit 1.

test("a startup the deadline ends returns a timeout without reading", async (t) => {
  const c = heldWatchTimers(t);
  const f = fixture();
  const routes = []; let checkpoints = 0; let nudges = 0;
  const { value: p, guards } = c.guards(() => watchRun({
    // The stream never connects, so only the readiness guard can end the wait.
    client: { stream: () => new Promise(() => {}), get: (route) => { routes.push(route); return f.client.get(route); } },
    team, task: a, runs: [a, b], maxSeconds: 1, quietMs: 30_000, pollMs: 5000, coalesceMs: 0, stallMs: Infinity,
    nudge: async () => { nudges++; }, checkpoint: async () => { checkpoints++; return true; },
  }));
  assert.equal(guards.length, 2, "the stream connection's guard, then the readiness guard");
  guards[1].fire(998.5); // a millisecond and a half before the deadline
  const r = await c.finish(p);
  assert.deepEqual(routes, [], "a startup that never established the stream starts no read");
  assert.equal(r.outcome, "timeout"); assert.equal(r.snap.complete, false);
  assert.deepEqual(r.ev.reasons, ["observation deadline reached before verification"]);
  assert.equal(r.checkpointed, false); assert.equal(checkpoints, 0); assert.equal(nudges, 0);
});

test("a startup rejection that is not the deadline still propagates", async (t) => {
  // The guard computes its own timeout in a microtask of its own, after the
  // stream request has been issued: a clock that throws there rejects it with
  // an error the watch has no answer for.
  const realNow = performance.now.bind(performance);
  let boom = false;
  t.mock.method(performance, "now", () => { if (boom) { boom = false; throw new Error("the clock stopped"); } return realNow(); });
  const f = fixture();
  await assert.rejects(watchRun({
    client: { ...f.client, stream: () => { boom = true; return new Promise(() => {}); } },
    team, task: a, runs: [a, b], maxSeconds: 1, quietMs: 30_000, pollMs: 5000, coalesceMs: 0, stallMs: Infinity,
  }), /the clock stopped/);
});

test("an invalidation during the checkpoint wait still returns unverified", async (t) => {
  const c = heldWatchTimers(t);
  const f = fixture();
  f.onStall = () => c.at(1001);
  let checkpoints = 0;
  const p = watchRun({
    client: f.client, team, task: a, runs: [a, b], maxSeconds: 1, quietMs: 30_000, pollMs: 5000, coalesceMs: 0, stallMs: Infinity,
    checkpoint: async () => { checkpoints++; await f.push({ kind: "message", threadId: "la" }); return true; },
  });
  (await c.until("wokeUp")).fire(998.5);
  const r = await c.finish(p);
  assert.equal(checkpoints, 1, "the boundary does reach the checkpoint");
  assert.equal(r.outcome, "timeout"); assert.equal(r.snap.complete, false);
  assert.deepEqual(r.ev.reasons, ["observation deadline reached before checkpoint verification"]);
});
