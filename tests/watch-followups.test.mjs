import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setImmediate as turn } from "node:timers/promises";
import { watchRun, readEventStream } from "../skills/openmausbot-launcher/scripts/lib/watch.mjs";
import { snapshot, evidenceOf, carriedVerdict, openDelegations } from "../skills/openmausbot-launcher/scripts/lib/snapshot.mjs";
import { deliverToLead } from "../skills/openmausbot-launcher/scripts/lib/verbs/run.mjs";
import { HttpError } from "../skills/openmausbot-launcher/scripts/lib/http.mjs";

const team = { section: "s", lead: { id: "lead", name: "Lead" }, bots: [{ id: "lead", name: "Lead" }, { id: "worker", name: "Worker" }] };
const a = { runId: "a", tag: "oml:a", sentAt: 1000, leadThreadId: "la", threads: { lead: "la", worker: "w" } };
const b = { runId: "b", tag: "oml:b", sentAt: 1000, leadThreadId: "lb", threads: { lead: "lb", worker: "w" }, implementer: { id: "worker", name: "Worker" } };
const user = { id: "u", at: 1000, role: "user", kind: "text", text: "do it" };
const done = { id: "d", at: 2000, role: "bot", kind: "text", text: "DONE oml:a" };
const card = { id: "q", at: 1500, role: "bot", kind: "options", card: { requestId: "rq", title: "Which?" } };
const echo = { id: "e", at: 3000, role: "bot", kind: "text", from: { botId: "worker", name: "Worker" }, text: "@Worker replied to the delegated task:\nok" };
const chip = (id, at, name) => ({ id, at, role: "bot", kind: "activity", tool: { name } });

// Read copies before the hook fires: a frame in the hook invalidates an actual
// REST read, rather than merely changing the next scripted response.
function fixture() {
  const data = {
    bots: team.bots.map((bot) => ({ ...bot, section: "s", threadId: bot.id === "lead" ? "la" : "w", busy: false, activity: "idle" })),
    threads: { la: [user, done], lb: [], w: [] },
    map: { queued: [], running: [] },
  };
  let controller; let seq = 0; let reads = 0;
  const f = {
    data, afterRead: null,
    async push(data) {
      controller.enqueue(new TextEncoder().encode(`id: s:${++seq}\ndata: ${JSON.stringify(data)}\n\n`));
      await turn();
    },
    client: {
      async stream(_url, signal) {
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
        await f.afterRead?.(route, reads);
        return copy;
      },
    },
    watch(options = {}) { return watchRun({ client: f.client, team, task: a, runs: [a, b], maxSeconds: 1, quietMs: 0, coalesceMs: 0, pollMs: 5, stallMs: Infinity, ...options }); },
  };
  return f;
}


test("an older pending card remains readable after its owner closes", async () => {
  const f = fixture();
  f.data.threads.w = [structuredClone(card)];
  const later = { ...a, sentAt: 3000, implementer: b.implementer,
    lastEval: { cardOwners: { rq: { threadId: "w", botId: "worker", owners: ["b"] } } } };
  const snap = await snapshot(f.client, { team, task: later, runs: [later] });
  assert.deepEqual(snap.pending.map((p) => [p.requestId, p.shared]), [["rq", true]]);
  assert.deepEqual(snap.claims, []);
});

test("ownership checkpointed only by a closed run remains shared for open runs", async () => {
  const f = fixture();
  f.data.threads.w = [structuredClone(card)];
  const later = { ...a, sentAt: 3000, implementer: b.implementer };
  const history = [{ ...b, status: "closed", cards: { rq: { threadId: "w", botId: "worker" } } }];
  const snap = await snapshot(f.client, { team, task: later, runs: [later], history });
  assert.deepEqual(snap.pending.map((p) => [p.requestId, p.shared]), [["rq", true]]);
  assert.deepEqual(snap.claims, []);
  f.data.threads.w[0].card.answered = true;
  const answered = await snapshot(f.client, { team, task: later, runs: [later], history });
  assert.deepEqual(answered.pending, []);
  assert.deepEqual(answered.cardOwners, {});
});

for (const status of [404, 503]) test(`a historical-only card conversation returning ${status} is handled without losing current truth`, async () => {
  const f = fixture();
  const history = [{ ...b, status: "closed", cards: { rq: { threadId: "deleted", botId: "worker" } } }];
  const get = f.client.get;
  f.client.get = async (route) => {
    if (route.includes("/threads/deleted/")) throw new HttpError("GET", route, status, { error: status === 404 ? "no such conversation" : "unavailable" });
    return get(route);
  };
  const snap = await snapshot(f.client, { team, task: a, runs: [a], history });
  assert.equal(snap.complete, status === 404);
  assert.deepEqual(snap.pending, []);
});

test("a missing live run conversation remains incomplete even with historical card provenance", async () => {
  const f = fixture();
  const get = f.client.get;
  f.client.get = async (route) => {
    if (route.includes("/threads/w/")) throw new HttpError("GET", route, 404, { error: "no such conversation" });
    return get(route);
  };
  const history = [{ ...b, status: "closed", cards: { rq: { threadId: "w", botId: "worker" } } }];
  const snap = await snapshot(f.client, { team, task: a, runs: [a], history });
  assert.equal(snap.complete, false);
});

test("checkpoint cancellation is authoritative before the outer clock reaches its deadline", async (t) => {
  const f = fixture();
  t.mock.method(performance, "now", () => 0);
  let writes = 0; let result; let error;
  try {
    result = await f.watch({ maxSeconds: 3, checkpoint: (_result, opts) => new Promise((resolve) => {
      opts.signal.addEventListener("abort", () => {
        try { opts.assertCurrent(); writes++; } catch {}
        resolve(false);
      }, { once: true });
    }) });
  } catch (e) { error = e; }
  assert.equal(writes, 0, "an aborted checkpoint cannot write during timer rounding");
  assert.equal(error, undefined);
  assert.equal(result.ev.state, "done");
  assert.equal(result.checkpointed, false);
});

test("historical hydration cannot give a newer run an unremembered predispatch card", async () => {
  const f = fixture();
  f.data.threads.w = [{ ...structuredClone(card), card: { ...card.card, answered: true } },
    { ...structuredClone(card), id: "old-unobserved", at: 2000, card: { ...card.card, requestId: "unobserved" } }];
  const later = { ...a, sentAt: 3000, implementer: b.implementer };
  const history = [{ ...b, status: "closed", cards: { rq: { threadId: "w", botId: "worker" } } }];
  const snap = await snapshot(f.client, { team, task: later, runs: [later], history });
  assert.deepEqual(snap.pending.map((p) => [p.requestId, p.shared]), [["unobserved", true]]);
  assert.deepEqual(snap.claims, []);
});

for (const gap of [5]) test(`a consumed checkpoint frame is drained before final return (microtask gap ${gap})`, async (t) => {
  const f = fixture();
  f.data.threads.la.push(structuredClone(card));
  let consumed = false; let closed = false; let first = true;
  const stream = f.client.stream;
  f.client.stream = (url, signal) => {
    signal.addEventListener("abort", () => { closed = true; }, { once: true });
    return stream(url, signal);
  };
  const decode = TextDecoder.prototype.decode;
  t.mock.method(TextDecoder.prototype, "decode", function(...args) {
    const text = decode.apply(this, args);
    if (!closed && text.includes('"kind":"message.patch"')) consumed = true;
    return text;
  });
  function later(left) {
    if (left) { queueMicrotask(() => later(left - 1)); return; }
    if (closed) return;
    f.data.threads.la.at(-1).card.answered = true;
    void f.push({ kind: "message.patch", threadId: "la", message: f.data.threads.la.at(-1) }).catch(() => {});
  }
  const r = await f.watch({ checkpoint: async (_r, opts) => {
    opts.assertCurrent();
    if (first) { first = false; later(gap); }
    return true;
  } });
  await turn();
  if (consumed) {
    assert.equal(r.ev.state, "done", "a frame consumed before SSE teardown invalidated the returned needs-user");
    assert.deepEqual(r.snap.pending, []);
  }
});

test("a missing sibling runtime log cannot prove exclusive ownership", async (t) => {
  const promises = await import("node:fs/promises");
  t.mock.method(promises.default, "readFile", async (file) => {
    if (String(file).endsWith("la.ndjson")) throw Object.assign(new Error("absent"), { code: "ENOENT" });
    return JSON.stringify({ type: "turn.started", turnId: "b" });
  });
  const f = fixture(); f.data.bots[0].busy = true; f.data.bots[0].activity = "working";
  const snap = await snapshot(f.client, { team, task: a, runs: [a, b] }, { dataDir: "/unused" });
  assert.equal(snap.executing, null);
  assert.equal(snap.lead.busy, true);
});

for (const [label, tail, invalid] of [
  ["empty", "", false],
  ["heartbeat", 'data: {"kind":"ping"}\n\n', false],
  ["evidence", 'data: {"kind":"message","threadId":"la"}\n\n', true],
  ["partial", 'data: {"kind":"message",', true],
]) test(`a deadline with ${label} buffered text invalidates only unread evidence`, async (t) => {
  let now = 0; let invalidated = false;
  t.mock.method(performance, "now", () => now);
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('data: {"kind":"ping"}\n\n' + tail));
    controller.close();
  } });
  await readEventStream({ body }, { deadline: 1, onFrame: () => { now = 2; }, onDeadline: () => { invalidated = true; } });
  assert.equal(invalidated, invalid);
});

test("an accepted foreign card owner survives that run closing during this watch", async () => {
  const f = fixture();
  f.data.bots[0].busy = true; f.data.bots[0].activity = "working";
  f.data.threads.la = [user]; f.data.threads.w = [structuredClone(card)];
  let live = [a, b]; let history = [];
  f.afterRead = (route, n) => {
    if (route === "/api/bots?messages=0" && n === 2) {
      live = [a]; history = [{ ...b, status: "closed" }];
      f.data.bots[0].busy = false; f.data.bots[0].activity = "idle";
      f.data.threads.la.push(chip("claim", 3000, "Delegated to @Worker"));
    }
  };
  const result = await f.watch({ maxSeconds: 0.5, getRuns: () => live, getHistory: () => history });
  assert.equal(result.ev.state, "needs-user");
  assert.deepEqual(result.snap.pending.map((p) => [p.requestId, p.shared]), [["rq", true]]);
  assert.deepEqual(result.snap.cardOwners.rq.owners, ["b"]);
  assert.deepEqual(result.snap.claims, []);
});

const durable = { id: "receipt:durable", at: 3000, kind: "receipt", name: "Worker", status: "completed", ok: true };
test("live run refresh retains a durable outcome that REST can no longer read", async () => {
  const f = fixture();
  const live = { ...a, lastEval: { outcomes: [durable] } };
  const result = await f.watch({ getRuns: () => [live, b], until: "change", dropMs: Infinity });
  assert.equal(result.ev.state, "running");
  assert.deepEqual(result.snap.outcomes, [durable]);
});

test("a newly persisted own outcome invalidates a verdict waiting to checkpoint", async () => {
  const f = fixture(); let live = { ...a }; let first = true; const written = [];
  const result = await f.watch({ getRuns: () => [live, b], dropMs: 1, checkpoint: async (r, opts) => {
    if (first) { first = false; live = { ...live, lastEval: { outcomes: [durable] } }; }
    opts.assertCurrent();
    written.push(r.ev.state);
    live = { ...live, cards: r.cards, lastEval: { ...live.lastEval, ...r.watermarks } };
    return true;
  } });
  assert.deepEqual(written, ["stalled"]);
  assert.equal(result.ev.state, "stalled");
  assert.deepEqual(result.snap.outcomes, [durable]);
});
