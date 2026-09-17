import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { watchRun } from "../skills/openmausbot-launcher/scripts/lib/watch.mjs";
import { deliverToLead } from "../skills/openmausbot-launcher/scripts/lib/verbs/run.mjs";
import { HttpError } from "../skills/openmausbot-launcher/scripts/lib/http.mjs";
import { tmpDir } from "./helpers.mjs";
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
    data, onStall: null,
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
        if (reads > 1) { f.onStall?.(); await new Promise(() => {}); }
        return copy;
      },
    },
  };
  return f;
}

/** The clock and the two timers this rule is about: `performance.now` answers
 * what the test says, and the idle wait's timer and the absolute deadline timer
 * are held until the test fires them — they are the only callbacks with these
 * names. Every other timer (request budgets, the stream's idle guard, its retry
 * pause) keeps its real behaviour. */
function heldTimers(t, { realClock = false } = {}) {
  let now = 0;
  const held = new Set();
  const realSetTimeout = globalThis.setTimeout; const realClearTimeout = globalThis.clearTimeout;
  const realNow = performance.now;
  if (!realClock) performance.now = () => now;
  globalThis.setTimeout = (fn, ms = 0, ...args) => {
    if (fn?.name !== "wokeUp" && fn?.name !== "reachDeadline") return realSetTimeout(fn, ms, ...args);
    const handle = { fn, args, ms, name: fn.name, fire(at) { held.delete(handle); if (at !== undefined) now = at; handle.fn(...handle.args); } };
    held.add(handle);
    return handle;
  };
  globalThis.clearTimeout = (handle) => (held.has(handle) ? held.delete(handle) : realClearTimeout(handle));
  t.after(() => { globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout; performance.now = realNow; });
  return {
    at: (ms) => { now = ms; },
    held: (name) => [...held].find((h) => h.name === name),
    async until(name, budgetMs = 500) {
      const stop = Date.now() + budgetMs;
      for (let i = 0; Date.now() < stop; i++) {
        const h = [...held].find((x) => x.name === name);
        if (h) return h;
        // Mostly microtask turns, with real milliseconds now and then: a watch
        // falling back to polling waits out its stream retries first.
        await (i % 10 === 9 ? new Promise((r) => realSetTimeout(r, 2)) : turn());
      }
      throw new Error(`the watch never installed a ${name} timer`);
    },
  };
}

async function watchToItsIdleWait(t, options = {}, f = fixture()) {
  const c = heldTimers(t);
  const state = { checkpoints: 0 };
  const deadline = (options.maxSeconds ?? 1) * 1000;
  f.onStall = () => c.at(deadline + 1);
  const p = watchRun({
    client: f.client, team, task: a, runs: [a, b], maxSeconds: 1, quietMs: 30_000, pollMs: 5000, coalesceMs: 0, stallMs: Infinity,
    checkpoint: async (r, opts) => { opts.assertCurrent(); state.checkpoints++; return true; }, ...options,
  });
  return { c, f, p, state, wait: await c.until("wokeUp") };
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

test("a receipt written during the wait is hydrated before the watch gives up its budget", async (t) => {
  const dataDir = tmpDir("oml-receipts-");
  fs.writeFileSync(path.join(dataDir, "delegation-receipts.json"), "[]");
  const { f, p } = await watchToItsIdleWait(t, { dataDir });
  fs.writeFileSync(path.join(dataDir, "delegation-receipts.json"), JSON.stringify([{ sourceThreadId: "la", toBotName: "Worker", status: "completed" }]));
  for (let i = 0; i < 2000 && f.reads < 2; i++) await turn(); // a file event, not a timer
  const r = await p;
  assert.equal(f.reads, 2, "a receipt has no frame of its own and is evidence all the same");
  assert.equal(r.outcome, "timeout"); assert.equal(r.snap.complete, false);
});

test("a run list that changed silently is read again before the watch gives up its budget", async (t) => {
  const live = [{ ...a }, b];
  const { f, p, state, wait } = await watchToItsIdleWait(t, { runs: live, getRuns: () => live });
  live[0] = { ...live[0], cards: { rq: "a" } }; // a card the state file learned about, with no frame
  wait.fire(998.5);
  const r = await p;
  assert.equal(f.reads, 2, "local inputs are refreshed, whatever the clock says");
  assert.equal(r.outcome, "timeout"); assert.equal(r.snap.complete, false);
  assert.equal(state.checkpoints, 0);
});

test("an ordinary poll wake before the deadline reads again", async (t) => {
  const { f, p, state, wait } = await watchToItsIdleWait(t, { pollMs: 300 });
  assert.equal(wait.ms, 300);
  wait.fire(300); // the poll, less than a third into the budget
  const r = await p;
  assert.equal(f.reads, 2, "a poll is a read, not a boundary");
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
  // Falling back to polling costs two real stream-retry pauses, which a frozen
  // clock cannot shorten without expiring the stream-ready wait as well, so
  // this control keeps the real clock. What makes the wait a boundary is the
  // operands it was scheduled with, not the instant its timer happens to fire.
  const f = fixture({ stream: false });
  const c = heldTimers(t, { realClock: true });
  let checkpoints = 0;
  const p = watchRun({
    client: f.client, team, task: a, runs: [a, b], maxSeconds: 6, quietMs: 30_000, pollMs: 20_000, coalesceMs: 0, stallMs: Infinity,
    checkpoint: async (r, opts) => { opts.assertCurrent(); checkpoints++; return true; },
  });
  const wait = await c.until("wokeUp", 8000);
  wait.fire();
  const r = await p;
  assert.equal(f.reads, 1, "no read is started after the boundary"); assert.equal(r.pollingOnly, true);
  assert.equal(r.outcome, "timeout"); assert.equal(r.snap.complete, true);
  assert.equal(r.checkpointed, true); assert.equal(checkpoints, 1);
});

test("an invalidation during the checkpoint wait still returns unverified", async (t) => {
  const c = heldTimers(t);
  const f = fixture();
  f.onStall = () => c.at(1001);
  let checkpoints = 0;
  const p = watchRun({
    client: f.client, team, task: a, runs: [a, b], maxSeconds: 1, quietMs: 30_000, pollMs: 5000, coalesceMs: 0, stallMs: Infinity,
    checkpoint: async () => { checkpoints++; await f.push({ kind: "message", threadId: "la" }); return true; },
  });
  (await c.until("wokeUp")).fire(998.5);
  const r = await p;
  assert.equal(checkpoints, 1, "the boundary does reach the checkpoint");
  assert.equal(r.outcome, "timeout"); assert.equal(r.snap.complete, false);
  assert.deepEqual(r.ev.reasons, ["observation deadline reached before checkpoint verification"]);
});
