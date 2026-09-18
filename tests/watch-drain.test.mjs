import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setImmediate as turn, setTimeout as sleep } from "node:timers/promises";
import { watchRun } from "../skills/openmausbot-launcher/scripts/lib/watch.mjs";
import { snapshot, evaluate, evidenceOf, carriedVerdict, executingThread } from "../skills/openmausbot-launcher/scripts/lib/snapshot.mjs";
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

for (const state of ["done", "attention", "needs-user", "failed", "stalled", "change"]) {
  test(`a saturated ownership drain cannot emit ${state} or checkpoint its evidence`, async () => {
    const f = fixture();
    if (state === "attention") f.data.threads.la = [user, { ...done, text: "Waiting for a decision." }];
    if (state === "needs-user") f.data.threads.la.push(structuredClone(card));
    if (state === "failed") f.data.bots[0].activity = "dead";
    if (state === "stalled") f.data.threads.la = [user, done, echo];
    if (state === "change") f.data.bots[0].busy = true;
    let nudges = 0; let checkpoints = 0;
    f.afterRead = async (route) => {
      if (route.includes("/threads/lb/")) await f.push({ kind: "message", threadId: "lb" });
    };
    const result = await f.watch({ until: state === "change" ? "change" : "settled", dropMs: 1,
      nudge: async () => { nudges++; }, checkpoint: async () => { checkpoints++; return true; } });
    assert.equal(result.ev.state, "running");
    assert.equal(result.ev.unknown, true);
    assert.equal(result.outcome, "unverified", "bounded traffic returns a visible non-verdict");
    assert.equal(result.changedSinceReport, true, "quiet-if-unchanged must not hide an unverified observation");
    assert.equal(result.snap.complete, false);
    assert.equal(nudges, 0);
    assert.equal(checkpoints, 0);
    assert.equal(result.cursor, null, "an unstable read never covers a cursor");
  });
}

test("the first hydration drains frames for an unclaimed specialist", async () => {
  const f = fixture();
  f.afterRead = async (route, n) => {
    if (n === 1 && route === "/api/bots?messages=0") {
      f.data.bots[1].busy = true;
      f.data.bots[1].activity = "working";
      await f.push({ kind: "bot", bot: f.data.bots[1] });
    }
  };
  const result = await f.watch({ runs: [a, { ...b, implementer: null }], maxSeconds: 0.08 });
  assert.equal(result.ev.state, "running");
  assert.notEqual(result.outcome, "terminal");
  assert.deepEqual(result.ev.busy, ["Worker"]);
});

test("a bot.deleted frame uses upstream botId and invalidates a copied fleet", async () => {
  const f = fixture();
  f.afterRead = async (route, n) => {
    if (n === 1 && route.includes("/threads/la/")) {
      f.data.bots = f.data.bots.filter((bot) => bot.id !== "lead");
      // S: server/index.ts:1915 (the field is botId, not id).
      await f.push({ kind: "bot.deleted", botId: "lead" });
    }
  };
  const result = await f.watch({ maxSeconds: 0.08 });
  assert.equal(result.ev.state, "running");
  assert.equal(result.snap.complete, false);
});

test("a card owned by this run invalidates its thread even when another run owns the bot", async () => {
  const f = fixture();
  f.data.threads.w = [structuredClone(card)];
  f.afterRead = async (route, n) => {
    if (n === 1 && route.includes("/threads/w/")) {
      f.data.threads.w[0].card.answered = true;
      await f.push({ kind: "message.patch", threadId: "w", message: f.data.threads.w[0] });
    }
  };
  const owned = { ...a, cards: { rq: true } };
  const result = await f.watch({ task: owned, runs: [owned, b] });
  assert.equal(result.ev.state, "done");
  assert.deepEqual(result.snap.pending, []);
  assert.deepEqual(result.cards, {});
});

test("new current specialist threads are watched as well as the recorded run threads", async () => {
  const f = fixture();
  f.data.bots[1].threadId = "new";
  f.data.threads.new = [structuredClone(card)];
  f.afterRead = async (route, n) => {
    if (n === 1 && route.includes("/threads/new/")) {
      f.data.threads.new[0].card.answered = true;
      await f.push({ kind: "message.patch", threadId: "new", message: f.data.threads.new[0] });
    }
  };
  const result = await f.watch({ runs: [a, { ...b, implementer: null }] });
  assert.equal(result.ev.state, "done");
  assert.deepEqual(result.snap.pending, []);
});

test("a card first observed for another run stays there after its delegation settles", async () => {
  const f = fixture();
  f.data.bots[0].busy = true;
  f.data.threads.w = [structuredClone(card)];
  f.data.threads.lb = [chip("queued", 1100, "Delegated to @Worker")];
  f.afterRead = (route, n) => {
    if (n === 1 && route.includes("/threads/lb/")) {
      f.data.threads.lb.push(chip("settled", 3000, "Delegation to @Worker completed without a text reply"));
      f.data.bots[0].busy = false;
    }
  };
  const result = await f.watch({ runs: [a, { ...b, implementer: null }] });
  assert.equal(result.ev.state, "done");
  assert.deepEqual(result.snap.pending, []);
  assert.deepEqual(result.cards, {});
});

test("fleet health changes are drained even for a bot another run owns", async () => {
  const f = fixture();
  f.afterRead = async (route, n) => {
    if (n === 1 && route.includes("/threads/la/")) {
      f.data.bots[1].activity = "no-signal";
      await f.push({ kind: "bot", bot: f.data.bots[1] });
    }
  };
  const result = await f.watch();
  assert.equal(result.snap.bots.find((bot) => bot.id === "worker").activity, "no-signal");
});

test("ordinary foreign bot frames with explicit hidden false do not exhaust the drain", async () => {
  const f = fixture();
  f.afterRead = async (route) => {
    if (route.includes("/threads/lb/")) {
      // S: server/index.ts:1159-1168 wireBot includes the stored bot fields;
      // snapshot omits hidden bots, so every observed bot is already visible.
      await f.push({ kind: "bot", bot: { ...f.data.bots[1], hidden: false } });
    }
  };
  const result = await f.watch();
  assert.equal(result.ev.state, "done");
  assert.equal(result.outcome, "terminal");
});

test("a nudge waiting for a lock rechecks freshness before it sends", async () => {
  const f = fixture();
  f.data.threads.la.push(echo);
  let sends = 0;
  const result = await f.watch({ dropMs: 1, nudge: async (opts) => {
    f.data.threads.la.push({ ...done, id: "d2", at: 4000 });
    await f.push({ kind: "message", threadId: "la" });
    opts.assertCurrent?.();
    sends++;
  } });
  assert.equal(sends, 0, "the newer closing text canceled the stale nudge");
  assert.equal(result.nudged, false);
  assert.equal(result.ev.state, "done");
  assert.equal(result.snap.leadText.id, "d2");
});

test("until change rehydrates frames received while an authorized nudge is in flight", async () => {
  const f = fixture();
  f.data.threads.la.push(echo);
  const result = await f.watch({ until: "change", dropMs: 1, nudge: async () => {
    f.data.threads.la.push(structuredClone(card));
    await f.push({ kind: "message", threadId: "la", message: card });
  } });
  assert.equal(result.nudged, true);
  assert.equal(result.ev.state, "needs-user");
  assert.deepEqual(result.snap.pending.map((p) => p.requestId), ["rq"]);
});

test("a checkpoint lock wait stays inside the stream lifetime and drains before writing", async () => {
  const f = fixture();
  f.data.threads.la.push(structuredClone(card));
  const written = []; let first = true;
  const result = await f.watch({ checkpoint: async (r, opts) => {
    if (first) {
      first = false;
      f.data.threads.la.at(-1).card.answered = true;
      await f.push({ kind: "message.patch", threadId: "la", message: f.data.threads.la.at(-1) });
    }
    opts.assertCurrent();
    written.push(r.ev.state);
    return true;
  } });
  assert.deepEqual(written, ["done"]);
  assert.equal(result.ev.state, "done");
  assert.equal(result.checkpointed, true);
  assert.equal(result.cursor, "s:1");
});

test("delivery rechecks a watch decision after the active-thread read and before switching", async () => {
  let current = true; const writes = [];
  const client = {
    async get() { current = false; return { bots: [{ id: "lead", threadId: "lb" }] }; },
    async post(route) {
      writes.push(route);
      if (route.endsWith("/messages")) throw new HttpError("POST", route, 409, { error: "the bot switched tasks before it could receive the message" });
      return {};
    },
  };
  await assert.rejects(deliverToLead(client, { leadId: "lead", run: a, otherRuns: [b], text: "status?", sendId: "n", assertCurrent: () => { if (!current) throw new Error("stale observation"); } }), /stale observation/);
  assert.deepEqual(writes, ["/api/bots/lead/messages"]);
});

test("delivery honors the shared deadline rather than posting after its caller timed out", async () => {
  let posts = 0;
  const client = {
    async post(route) {
      posts++;
      if (posts === 1) throw new HttpError("POST", route, 409, { error: "the bot switched tasks before it could receive the message" });
      return {};
    },
    async get() { await new Promise((r) => setTimeout(r, 50)); return { bots: [{ id: "lead", threadId: "lb" }] }; },
  };
  await assert.rejects(deliverToLead(client, { leadId: "lead", run: a, otherRuns: [b], text: "status?", sendId: "n", deadline: performance.now() + 15 }), /observation deadline/);
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(posts, 1, "no detached switch or retry after expiry");
});

test("delivery checks freshness before the first post and again after a task switch", async () => {
  const writes = []; let current = false;
  const assertCurrent = () => { if (!current) throw new Error("stale observation"); };
  const client = {
    async get() { return { bots: [{ id: "lead", threadId: "lb" }] }; },
    async post(route) {
      writes.push(route);
      if (route.endsWith("/messages")) throw new HttpError("POST", route, 409, { error: "the bot switched tasks before it could receive the message" });
      current = false;
      return {};
    },
  };
  const options = { leadId: "lead", run: a, otherRuns: [b], text: "status?", sendId: "n", assertCurrent };
  await assert.rejects(deliverToLead(client, options), /stale observation/);
  assert.deepEqual(writes, []);
  current = true;
  await assert.rejects(deliverToLead(client, options), /stale observation/);
  assert.deepEqual(writes, ["/api/bots/lead/messages", "/api/bots/lead/tasks/la"]);
});

for (const boundary of ["read", "nudge", "checkpoint"]) {
  test(`a local ownership change at the ${boundary} boundary invalidates the watch without an SSE frame`, async () => {
    const f = fixture(); let liveRuns = [a, b]; const writes = [];
    f.data.bots[1].busy = true; f.data.bots[1].activity = "working";
    if (boundary === "nudge") f.data.threads.la.push(echo);
    if (boundary === "read") f.afterRead = (route) => {
      if (route.includes("/threads/lb/")) liveRuns = [a];
    };
    const result = await f.watch({ maxSeconds: 0.12, dropMs: 1, getRuns: () => liveRuns,
      nudge: boundary === "nudge" ? async (opts) => {
        liveRuns = [a]; opts.assertCurrent(); writes.push("nudge");
      } : null,
      checkpoint: async (r, opts) => {
        if (boundary === "checkpoint") liveRuns = [a];
        opts.assertCurrent(); writes.push(r.ev.state); return true;
      },
    });
    assert.equal(result.ev.state, "running");
    assert.deepEqual(result.ev.busy, ["Worker"]);
    assert.ok(writes.every((state) => state === "running"), writes.join(", "));
  });
}

test("another run switching its active task does not change this run's evidence", async () => {
  const f = fixture();
  const first = await snapshot(f.client, { team, task: a, runs: [a, b] });
  f.data.bots[1].threadId = "elsewhere";
  f.data.threads.elsewhere = [];
  const next = await snapshot(f.client, { team, task: a, runs: [a, b] });
  assert.deepEqual(evidenceOf(next), evidenceOf(first));
});

test("each run's lead tail and outcomes start at that run's own dispatch boundary", async () => {
  const f = fixture();
  const later = { ...a, sentAt: 4000 };
  f.data.threads.la = [user, done, echo];
  const snap = await snapshot(f.client, { team, task: later, runs: [later, b] });
  assert.deepEqual(snap.leadTail, []);
  assert.deepEqual(snap.outcomes, []);
  assert.equal(snap.leadText, null);
});

test("terminal evidence includes the hydrated ordering of timestamp ties", async () => {
  const f = fixture();
  f.data.threads.la = [user, { ...echo, at: done.at }, done];
  const first = await snapshot(f.client, { team, task: a });
  const remembered = { ...a, lastEval: { state: "stalled", evidence: evidenceOf(first) } };
  f.data.threads.la = [user, done, { ...echo, at: done.at }];
  const next = await snapshot(f.client, { team, task: a });
  assert.notDeepEqual(evidenceOf(first), evidenceOf(next));
  assert.equal(carriedVerdict(next, remembered), null);
});

test("dropping part of a queue cannot settle the delegations already running for this run", async () => {
  const f = fixture();
  f.data.threads.la = [user, chip("x", 1200, "Delegated to @Worker"), chip("y", 1300, "Delegated to @Other"), chip("drop", 1400, "1 queued delegation dropped — the turn did not finish"), done];
  f.data.bots[1].busy = true;
  f.data.bots[1].activity = "working";
  const snap = await snapshot(f.client, { team, task: a, runs: [a, b] });
  assert.ok(snap.openDelegations.total > 0);
  assert.equal(snap.openDelegations.unknown, true);
  assert.equal(evaluate(snap, a, { quiet: { since: 0 }, quietMs: 0, stallMs: Infinity }).state, "running");
  assert.equal(snap.bots.find((bot) => bot.id === "worker").busy, true);
});

for (const failure of ["unreadable", "malformed", "incomplete history"]) {
  test(`a ${failure} sibling runtime log cannot prove exclusive lead ownership`, async (t) => {
    const promises = await import("node:fs/promises");
    t.mock.method(promises.default, "readFile", async (file) => {
      if (String(file).endsWith("la.ndjson")) return JSON.stringify({ type: "turn.started", turnId: "t" });
      if (failure === "unreadable") throw Object.assign(new Error("denied"), { code: "EACCES" });
      return failure === "malformed" ? "{incomplete" : JSON.stringify({ type: "runtime.error", message: "Canonical event history is incomplete: OpenMausBot could not write one or more events to disk. Live updates will continue." });
    });
    assert.equal(await executingThread("/unused", ["la", "lb"]), null);
  });
}

test("a renamed open delegate leaves new cards shared instead of assigning them to the other run", async () => {
  const f = fixture();
  f.data.threads.la.push(chip("rename", 2500, "Delegated to @Old Worker"));
  f.data.threads.w = [structuredClone(card)];
  f.data.bots[1].busy = true;
  const snap = await snapshot(f.client, { team, task: a, runs: [a, b] });
  assert.equal(snap.bots.find((bot) => bot.id === "worker").busy, true);
  assert.deepEqual(snap.pending.map((p) => [p.requestId, p.shared]), [["rq", true]]);
});

test("remembered cards keep their thread readable after the specialist switches tasks", async () => {
  const f = fixture();
  f.data.bots[1].threadId = "new";
  f.data.threads.new = [structuredClone(card)];
  const owning = { ...a, implementer: b.implementer };
  const first = await snapshot(f.client, { team, task: owning, runs: [owning, { ...b, implementer: null }] });
  const saved = { ...owning, cards: first.cardsByRun.a };
  f.data.bots[1].threadId = "next";
  f.data.threads.next = [];
  const next = await snapshot(f.client, { team, task: saved, runs: [saved, { ...b, implementer: null }] });
  assert.deepEqual(next.pending.map((p) => p.requestId), ["rq"]);
});

test("a legacy card without a recoverable thread stays unknown until settlement is observed", async () => {
  const f = fixture(); const owning = { ...a, cards: { rq: true } };
  const missing = await snapshot(f.client, { team, task: owning, runs: [owning, b] });
  assert.equal(missing.complete, false);
  assert.equal(evaluate(missing, owning, { quiet: { since: 0 }, quietMs: 0 }).state, "running");
  f.data.threads.w = [{ ...card, card: { ...card.card, answered: true } }];
  const settled = await snapshot(f.client, { team, task: owning, runs: [owning, b] });
  assert.equal(settled.complete, true);
  assert.deepEqual(settled.cardsByRun.a, {});
});

test("a live runtime log failure prevents stale disk evidence from excluding the lead", async (t) => {
  const f = fixture(); f.data.bots[0].busy = true; f.data.bots[0].activity = "working";
  const promises = await import("node:fs/promises");
  t.mock.method(promises.default, "readFile", async (file) => {
    if (String(file).endsWith("lb.ndjson")) return JSON.stringify({ type: "turn.started", turnId: "b" });
    return "[]";
  });
  f.afterRead = async (route, n) => {
    if (n === 1 && route.includes("/threads/la/")) {
      // S: server/harness/bus.ts:56-75 sends the warning even when disk writes
      // fail; server/index.ts:2724 broadcasts it as a runtime frame.
      await f.push({ kind: "runtime", event: { threadId: "la", type: "runtime.error", message: "Canonical event history is incomplete: OpenMausBot could not write one or more events to disk. Live updates will continue." } });
    }
  };
  const result = await f.watch({ dataDir: "/unused", until: "change" });
  assert.equal(result.ev.state, "running");
  assert.deepEqual(result.ev.busy, ["Lead"]);
});

test("a receipt change during a multi-run read invalidates a verdict without an SSE message", async (t) => {
  const f = fixture();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "watch-drain-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dataDir, "events"));
  fs.writeFileSync(path.join(dataDir, "delegation-receipts.json"), "[]");
  // Synchronise on the notification this test is about, not on a deadline:
  // the real watcher's callback resolves `seen` once it has invalidated the
  // read, so the receipt cannot reach the loop after its first verdict.
  let notified; const seen = new Promise((resolve) => { notified = resolve; });
  const watch = fs.watch;
  t.mock.method(fs, "watch", (target, listener) => watch(target, (event, name) => {
    listener(event, name);
    if (name === "delegation-receipts.json") notified();
  }));
  // Hold the last optional read after receipts were read, so fs.watch can
  // invalidate exactly that snapshot. Mock only the filesystem read boundary.
  const promises = await import("node:fs/promises");
  const read = promises.default.readFile;
  // The loop's optional reads swallow errors, so the staging records what it
  // reached, what it threw and what it saw; the assertions read that record.
  let first = true; const stage = { reached: false, error: null, notified: null };
  t.mock.method(promises.default, "readFile", async (file, opts) => {
    if (first && String(file).endsWith("la.ndjson")) {
      first = false; stage.reached = true;
      try {
        fs.writeFileSync(path.join(dataDir, "delegation-receipts.json"), JSON.stringify([{ id: "new", sourceThreadId: "la", finishedAt: Date.now(), status: "completed" }]));
        // Five real seconds bound the failure; they never decide the success.
        stage.notified = await Promise.race([seen.then(() => true), sleep(5_000, false, { ref: false })]);
      } catch (e) { stage.error = e; }
    }
    return read(file, opts);
  });
  // `reported` is null, so the invalidated read's replacement is the first
  // verified view and `change` returns it; the receipt is newer than the
  // lead's text, so this settled fixture reads as running again.
  const result = await f.watch({ dataDir, until: "change", maxSeconds: 5, dropMs: Infinity });
  assert.equal(stage.reached, true, "the staged la.ndjson read was never reached");
  assert.equal(stage.error, null, `the receipt write threw: ${stage.error?.message}`);
  assert.equal(stage.notified, true, "no fs.watch notification for the receipt write: the first read was not invalidated");
  assert.equal(result.outcome, "change");
  assert.equal(result.snap.complete, true);
  assert.equal(result.ev.state, "running");
  assert.equal(result.snap.outcomes[0]?.id, "receipt:new");
});


test("a terminal return rechecks ownership after the final checkpoint promise resolves", async () => {
  const f = fixture();
  let written = false; let current = true; let scheduled = false;
  const result = await f.watch({
    checkpoint: async () => { written = true; return true; },
    getRuns: () => {
      if (written && !scheduled) {
        scheduled = true;
        queueMicrotask(() => { current = false; });
      }
      return current ? [a, b] : [];
    },
  });
  assert.equal(written, true, "the write itself preceded the ownership change");
  assert.equal(result.ev.state, "running");
  assert.equal(result.ev.unknown, true);
  assert.notEqual(result.outcome, "terminal");
});

test("an optional checkpoint deadline returns the verified verdict without a late write", async () => {
  const f = fixture();
  let written = false; let late;
  const result = await f.watch({ maxSeconds: 3, checkpoint: (_result, opts) => {
    late = new Promise((resolve) => setTimeout(() => {
      try { opts.assertCurrent(); written = true; } catch {}
      resolve();
    }, 1100));
    return new Promise((resolve) => opts.signal.addEventListener("abort", () => resolve(false), { once: true }));
  } });
  assert.equal(result.ev.state, "done");
  assert.equal(result.checkpointed, false);
  await late;
  assert.equal(written, false, "the timed-out checkpoint cannot write after watch returns");
});

test("a scope change at the deadline cannot checkpoint an unconfirmed snapshot", async (t) => {
  const f = fixture();
  let now = 0; let writes = 0;
  t.mock.method(performance, "now", () => now);
  f.data.threads.lb = [chip("queued", 1100, "Delegated to @Worker")];
  f.afterRead = (route, n) => {
    if (route === "/api/bots?messages=0" && n === 2) f.data.threads.lb = [];
    if (route.includes("/threads/lb/") && n === 2) now = 99.5;
  };
  const result = await f.watch({ runs: [a, { ...b, implementer: null }], deadline: 100, quietMs: Infinity, pollMs: 0,
    checkpoint: async (_result, opts) => { opts.assertCurrent(); writes++; return true; } });
  assert.equal(result.outcome, "timeout");
  assert.equal(result.ev.unknown, true);
  assert.equal(result.snap.complete, false);
  assert.equal(writes, 0);
});

test("delivery preserves the HTTP per-request cap within a longer watch deadline", async () => {
  const budgets = [];
  const client = {
    timeoutMs: 25,
    async post(_route, _body, opts) { budgets.push(opts.timeoutMs); return { threadId: "la" }; },
  };
  await deliverToLead(client, { leadId: "lead", run: a, text: "status?", sendId: "n", deadline: performance.now() + 1000 });
  assert.ok(budgets.length > 0);
  assert.ok(budgets.every((ms) => ms > 0 && ms <= 25));
});

test("idle lead and proven foreign lead work have the same evidence for this run", async (t) => {
  const f = fixture(); let foreign = false;
  const promises = await import("node:fs/promises");
  t.mock.method(promises.default, "readFile", async (file) => {
    if (String(file).endsWith("delegation-receipts.json")) return "[]";
    if (String(file).endsWith("lb.ndjson") && foreign) return JSON.stringify({ type: "turn.started", turnId: "b" });
    return JSON.stringify({ type: "turn.completed", turnId: "prior" });
  });
  const first = await snapshot(f.client, { team, task: a, runs: [a, b] }, { dataDir: "/unused" });
  foreign = true;
  f.data.bots[0].busy = true; f.data.bots[0].activity = "working"; f.data.bots[0].threadId = "lb";
  const next = await snapshot(f.client, { team, task: a, runs: [a, b] }, { dataDir: "/unused" });
  assert.deepEqual(evidenceOf(next), evidenceOf(first));
});

test("an unresolved delegate name alone cannot claim an unrelated card exclusively", async () => {
  const f = fixture();
  f.data.threads.la.push(chip("rename", 2500, "Delegated to @Old Worker"));
  f.data.threads.w = [structuredClone(card)];
  const snap = await snapshot(f.client, { team, task: a, runs: [a, { ...b, implementer: null }] });
  assert.deepEqual(snap.pending.map((p) => [p.requestId, p.shared]), [["rq", true]]);
});

test("another run's specialist runtime frames cannot starve this run's verdict", async () => {
  const f = fixture();
  f.afterRead = async (route, n) => {
    if (route.includes("/threads/w/")) await f.push({ kind: "runtime", event: { type: "turn.started", threadId: "w", turnId: `foreign-${n}` } });
  };
  const result = await f.watch();
  assert.equal(result.ev.state, "done");
  assert.equal(result.outcome, "terminal");
});

test("an unrecorded hidden bot does not invalidate a run whose snapshot excludes it", async () => {
  const f = fixture();
  f.afterRead = async (route) => {
    if (route.includes("/threads/w/")) await f.push({ kind: "bot", bot: { id: "archived", name: "Archived", section: "s", hidden: true, threadId: "archived-thread" } });
  };
  const result = await f.watch();
  assert.equal(result.ev.state, "done");
});

test("a buffered stream flood cannot consume the checkpoint grace before observation ends", async (t) => {
  const f = fixture();
  const ping = '{"kind":"ping","fixture":"budget"}';
  const chunk = new TextEncoder().encode(`data: ${ping}\n\n`.repeat(1000));
  let now = 0; let decoded = 0;
  t.mock.method(performance, "now", () => now);
  const parse = JSON.parse;
  t.mock.method(JSON, "parse", function(text, ...args) {
    if (text === ping) { decoded++; now = 11; }
    return parse(text, ...args);
  });
  f.client.stream = async (_url, signal) => ({ status: 200, body: new ReadableStream({ start(c) {
    c.enqueue(chunk);
    signal.addEventListener("abort", () => { try { c.close(); } catch {} }, { once: true });
  } }) });
  const result = await f.watch({ maxSeconds: 0.01, checkpoint: async () => true });
  assert.equal(result.outcome, "timeout");
  assert.equal(decoded, 1, "no further frames are parsed after the observation budget expires");
  assert.equal(result.checkpointed, false);
});

test("a watch remembers another run's first-seen card owner across invocations", async () => {
  const f = fixture();
  f.data.threads.w = [structuredClone(card)];
  f.data.threads.lb = [chip("queued", 1100, "Delegated to @Worker")];
  const other = { ...b, implementer: null };
  const first = await f.watch({ runs: [a, other] });
  const saved = { ...a, lastEval: first.watermarks };
  f.data.threads.lb.push(chip("settled", 3000, "Delegation to @Worker completed without a text reply"));
  const next = await snapshot(f.client, { team, task: saved, runs: [saved, other] });
  assert.deepEqual(next.pending, [], "the unanswered card still belongs to B");
});

test("an invalidated snapshot showing inflight work breaks the quiet interval", async () => {
  const f = fixture();
  f.data.bots[1].busy = true;
  f.data.bots[1].activity = "working";
  f.data.threads.lb = [chip("queued", 1100, "Delegated to @Worker")];
  let busySeenAt = null;
  f.afterRead = async (route, n) => {
    if (n === 2 && route === "/api/bots?messages=0") f.data.threads.lb.push(chip("settled", 3000, "Delegation to @Worker completed without a text reply"));
    if (n === 2 && route.includes("/threads/lb/")) {
      busySeenAt = performance.now();
      f.data.threads.lb.push(chip("again", 3100, "Delegated to @Worker"));
      await f.push({ kind: "message", threadId: "lb" });
    }
  };
  const result = await f.watch({ runs: [a, { ...b, implementer: null }], quietMs: 100, pollMs: 20 });
  assert.equal(result.ev.state, "done");
  assert.ok(busySeenAt !== null);
  assert.ok(performance.now() - busySeenAt >= 100, "quiet starts after even a discarded observation of our busy worker");
});
