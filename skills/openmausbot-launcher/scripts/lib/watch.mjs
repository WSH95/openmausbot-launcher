// The watch loop (design, "watch loop"): SSE frames are wake-ups, REST
// snapshots are the truth, quiet evidence lives inside one invocation, and
// the cursor checkpoint is the id of the last frame actually applied.
import fs from "node:fs";
import { snapshot, evaluate, evidenceOf, mergeOutcomes, withinDeadline, outOfBudget, TERMINAL, DEFAULTS } from "./snapshot.mjs";

const pause = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted || ms <= 0) return resolve();
  let timer;
  const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); };
  timer = setTimeout(done, ms);
  signal?.addEventListener("abort", done, { once: true });
});

/** Parse an SSE body into {id, data} frames; calls onFrame for each; resolves when the stream ends. */
export async function readEventStream(res, { onFrame, onDeadline = () => {}, signal, idleMs = 45_000, deadline = Infinity }) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let idle;
  const armIdle = () => { clearTimeout(idle); idle = setTimeout(() => reader.cancel(new Error("idle")).catch(() => {}), idleMs); };
  armIdle();
  const onAbort = () => reader.cancel(new Error("aborted")).catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });
  const inBudget = () => performance.now() < (typeof deadline === "function" ? deadline() : deadline);
  const onlyHeartbeats = () => {
    if (!buf.trim()) return true;
    // Inspect a small complete tail without resuming an unbounded replay.
    if (buf.length > 4096 || !buf.endsWith("\n\n")) return false;
    return buf.split("\n\n").every((raw) => {
      let data = null;
      for (const line of raw.split("\n")) if (line.startsWith("data: ")) {
        try { data = JSON.parse(line.slice(6)); } catch { return false; }
      }
      return !data || data.kind === "ping";
    });
  };
  try {
    while (!signal?.aborted && inBudget()) {
      const { value, done } = await reader.read();
      if (done) break;
      armIdle();
      buf += dec.decode(value, { stream: true });
      let i;
      while (!signal?.aborted && inBudget() && (i = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, i); buf = buf.slice(i + 2);
        const frame = { id: null, data: null };
        for (const line of raw.split("\n")) {
          if (line.startsWith("id: ")) frame.id = line.slice(4).trim();
          else if (line.startsWith("data: ")) { try { frame.data = JSON.parse(line.slice(6)); } catch { frame.data = null; } }
        }
        if (frame.data) onFrame(frame);
      }
    }
    // A deadline can leave complete frames buffered but unclassified. Such a
    // stream cannot authorize a checkpoint of the last accepted snapshot.
    if (!signal?.aborted && !inBudget() && !onlyHeartbeats()) onDeadline();
  } finally { clearTimeout(idle); signal?.removeEventListener("abort", onAbort); void reader.cancel().catch(() => {}); }
}

/**
 * Is this frame about THIS run? Only a frame on the run's own threads, or
 * about a bot the run holds — its lead, its implementer, a delegate it is
 * waiting on — may reset its quiet window. A gap in the stream is everybody's.
 */
export function ownFrame(frame, { botIds, threadIds }) {
  const d = frame.data;
  if (!d) return false;
  switch (d.kind) {
    case "hello": return d.resumed === false;
    case "bot": case "bot.deleted": return botIds.has(d.bot?.id ?? d.botId ?? d.id);
    case "message": case "message.patch": case "thread": return threadIds.has(d.threadId);
    case "notify": return botIds.has(d.notification?.botId) || threadIds.has(d.notification?.threadId);
    default: return false;
  }
}

/** Is this frame about the team or the run? */
const runtimeLogGap = (d) => d?.kind === "runtime" && d.event?.type === "runtime.error" && /Canonical event history is incomplete/.test(d.event.message ?? "");

export function relevantFrame(frame, { teamIds, threadIds, section }) {
  const d = frame.data;
  if (!d) return false;
  switch (d.kind) {
    case "hello": return d.resumed === false; // a gap: re-hydrate
    case "bot": case "bot.deleted": return teamIds.has(d.bot?.id ?? d.botId ?? d.id) || Boolean(section && d.bot?.section === section);
    case "message": case "message.patch": case "thread": return threadIds.has(d.threadId);
    case "notify": return teamIds.has(d.notification?.botId) || threadIds.has(d.notification?.threadId);
    // These are the runtime-log events used to place a busy lead. S:
    // server/index.ts:2724 broadcasts {kind: "runtime", event}.
    case "runtime": return (["turn.started", "turn.completed"].includes(d.event?.type) || runtimeLogGap(d)) && threadIds.has(d.event?.threadId);
    default: return false;
  }
}

export const signatureOf = (snap, ev) => ({
  state: ev.state, leadMessageId: snap.leadText?.id ?? null,
  evidence: evidenceOf(snap),
  pending: [...snap.pending, ...(snap.resumable ?? []).filter((p) => !p.foreign)].map((p) => p.requestId ?? `${p.kind}:${p.botId}`).join(","),
});
const sameEvidence = (a, b) => Boolean(a?.evidence && b?.evidence) && JSON.stringify(a.evidence) === JSON.stringify(b.evidence);
const sameSig = (a, b) => Boolean(a && b) && a.state === b.state && sameEvidence(a, b);

/** The record a watch checkpoint writes: its watermarks over the existing one, never losing a `lastChangeAt` another writer (send, nudge) advanced meanwhile, nor fields the watch does not own. */
export function mergeCheckpoint(existing, watermarks) {
  const prior = existing ?? {};
  const stamps = [prior.lastChangeAt, watermarks.lastChangeAt].filter((v) => Number.isFinite(v));
  return { ...prior, ...watermarks, lastChangeAt: stamps.length ? Math.max(...stamps) : null };
}

/**
 * The pending requests a run owns after this watch. A complete observation is
 * the whole truth, so a card that has been answered stops being remembered; an
 * incomplete one may simply have failed to read the thread the card is on, and
 * dropping the owner there would turn it into a `shared` request the run can no
 * longer answer without `--request`.
 */
export function mergeCards(prior, cards, complete) {
  return complete ? { ...cards } : { ...(prior ?? {}), ...cards };
}

export class StaleObservation extends Error {
  constructor(message = "watch observation was invalidated") { super(message); }
}

// Run attribution and this run's durable progress; unrelated watermarks do
// not invalidate an observation.
const runInputs = (runs, history = [], watched = null) => JSON.stringify({ runs: [...runs].sort((a, b) => a.runId.localeCompare(b.runId)).map((r) => ({
  runId: r.runId, status: r.status, sentAt: r.sentAt, tag: r.tag, leadThreadId: r.leadThreadId, implementer: r.implementer,
  threads: Object.entries(r.threads ?? {}).sort(), cards: Object.entries(r.cards ?? {}).sort(),
  runtimeUntrusted: Boolean(r.lastEval?.runtimeUntrusted), cardOwners: r.lastEval?.cardOwners,
  outcomes: r.runId === watched ? mergeOutcomes(r.lastEval?.outcomes) : undefined,
  lastChangeAt: r.runId === watched ? r.lastEval?.lastChangeAt : undefined,
})), history: history.map((r) => ({ runId: r.runId, cards: r.cards, cardOwners: r.lastEval?.cardOwners })) });

/** A read may authorize a decision only when its relevant generation stayed
 * unchanged. Scope changes require a confirming read. Three unsuccessful reads
 * return running/unknown; exhausting a drain never authorizes a stale verdict. */
export async function watchRun({ client, team, task, runs = [], getRuns = null, history = [], getHistory = null, dataDir = null, maxSeconds = 100, until = "settled", pollMs = 30_000, quietMs = DEFAULTS.quietMs, dropMs = DEFAULTS.dropMs, stallMs = DEFAULTS.stallMs, idleMs = 45_000, coalesceMs = 2_000, nudge = null, checkpoint = null, log = () => {}, deadline = performance.now() + maxSeconds * 1000 }) {
  const start = performance.now();
  const teamIds = new Set([...team.bots.map((b) => b.id), team.lead.id]);
  const rosterIds = new Set(teamIds);
  let allRuns = runs.some((r) => r.runId === task.runId) ? runs : [task, ...runs];
  let inputKey = runInputs(allRuns, history, task.runId);
  const threadIds = new Set(allRuns.flatMap((r) => [...Object.values(r.threads ?? {}), r.leadThreadId]).filter(Boolean));
  let foreignLeadThreads = new Set(allRuns.filter((r) => r.runId !== task.runId).map((r) => r.leadThreadId));
  let scoped = allRuns.length > 1;
  let scope = null; let scopeKey = null;
  let cardsByRun = Object.fromEntries(allRuns.map((r) => [r.runId, { ...r.cards }]));
  let cardOwners = { ...task.lastEval?.cardOwners };
  let cursor = task.lastEval?.cursor ?? null;
  let receivedCursor = cursor;
  let quietSince = null;
  let lastChangeAt = task.lastEval?.lastChangeAt ?? task.sentAt ?? Date.now();
  let lastSig = task.lastEval?.lastReported ?? null;
  const reported = lastSig;
  const changes = [];
  let outcomes = mergeOutcomes(task.lastEval?.outcomes);
  let nudged = Boolean(task.nudgedAt);
  let runtimeTrusted = !allRuns.some((r) => r.lastEval?.runtimeUntrusted);
  // All traffic wakes hydration. Only relevant traffic invalidates its truth;
  // only our own traffic resets quiet. Classification happens at arrival.
  let invalidations = 0; let appliedInvalidations = -1; let relevant = 0;
  let verifiedGeneration = -1;
  let streamFailures = 0; let pollingOnly = false;
  let waiter = null;
  const wake = () => waiter?.();
  const controller = new AbortController();
  let streamDeadline = deadline;
  const expired = () => outOfBudget(deadline, controller.signal);
  const deadlineTimer = setTimeout(wake, Math.max(0, deadline - performance.now()));
  const invalidate = (kind) => {
    invalidations++;
    if (kind !== "other") relevant++;
    if (kind === "own") quietSince = null;
    wake();
  };
  const classify = (frame) => {
    if (!scoped || !scope) return "own"; // no ownership proof on a cold read
    if (ownFrame(frame, scope)) return "own";
    const d = frame.data;
    if (d.kind === "runtime") return scope.threadIds.has(d.event.threadId) ? "own" : foreignLeadThreads.has(d.event.threadId) || runtimeLogGap(d) ? "ownership" : "other";
    if (foreignLeadThreads.has(d.threadId ?? d.notification?.threadId)) return "ownership";
    if (d.kind === "bot.deleted") return "ownership";
    if (d.kind === "bot") {
      const before = scope.bots.get(d.bot?.id);
      if (!before) return "ownership";
      // Foreign work flags can be ignored, but health and identity changes can
      // alter our evidence or the name-based delegation claims.
      const health = (v) => ["dead", "no-signal"].includes(v) ? v : null;
      if ((d.bot.activity !== undefined && health(before.activity) !== health(d.bot.activity)) ||
          d.bot.hidden === true || ["name", "threadId"].some((key) => d.bot[key] !== undefined && d.bot[key] !== before[key])) return "ownership";
    }
    return "other";
  };
  let markStreamReady;
  const streamReady = new Promise((resolve) => { markStreamReady = resolve; });
  const runStream = async () => {
    while (!expired() && !pollingOnly) {
      try {
        const res = await withinDeadline(({ signal }) => client.stream(`/api/events?screens=off${cursor ? `&since=${encodeURIComponent(cursor)}` : ""}`, signal), deadline, controller.signal);
        if (res.status !== 200) throw new Error(`event stream ${res.status}`);
        const reading = readEventStream(res, {
          // Stay subscribed during the final bounded checkpoint lock wait.
          signal: controller.signal, idleMs, deadline: () => streamDeadline,
          onDeadline: () => invalidate("ownership"),
          onFrame: (frame) => {
            if (controller.signal.aborted) return;
            streamFailures = 0;
            if (frame.data?.kind === "ping") return;
            if (frame.id) receivedCursor = frame.id;
            const d = frame.data;
            if (d.kind === "bot" && d.bot?.hidden === true && !rosterIds.has(d.bot.id) && !scope?.bots.has(d.bot.id)) return;
            if (!relevantFrame(frame, { teamIds, threadIds, section: team.section }) &&
                !(scope === null && ["message", "message.patch", "thread"].includes(d.kind))) return;
            const kind = classify(frame);
            if (runtimeLogGap(d)) runtimeTrusted = false;
            // A newly created/switched bot can publish on its current thread
            // before the next fleet hydration has finished reading it.
            if (d.kind === "bot") {
              teamIds.add(d.bot.id);
              if (d.bot.threadId) threadIds.add(d.bot.threadId);
            }
            invalidate(kind);
          },
        });
        markStreamReady();
        await reading;
      } catch (e) {
        if (expired()) return;
        log(`stream: ${e.message}`);
      }
      if (expired()) return;
      if (++streamFailures >= 3) { pollingOnly = true; markStreamReady(); log("stream: polling only"); return; }
      await pause(Math.min(2_000, deadline - performance.now()), controller.signal);
    }
  };
  const streamTask = runStream();
  let receiptsWatcher = null;
  if (dataDir) {
    // A receipt has no SSE equivalent. Its owner is unknown until it is read,
    // so a file write invalidates truth without claiming another run's quiet.
    try { receiptsWatcher = fs.watch(dataDir, (_ev, name) => { if (name === "delegation-receipts.json" && !controller.signal.aborted) invalidate(scoped ? "ownership" : "own"); }); }
    catch (e) { log(`receipts: ${e.message}`); }
  }
  let snap = null; let ev = null; let sig = null;
  let lastSnapAt = null; let redraws = 0; let immediate = false;
  const sameInputs = () => (!getRuns && !getHistory) || inputKey === runInputs(getRuns ? getRuns() : allRuns, getHistory ? getHistory() : history, task.runId);
  const current = () => snap?.complete && verifiedGeneration === relevant && sameInputs();
  const assertCurrent = () => {
    if (!current()) throw new StaleObservation();
    if (expired()) throw new Error("observation deadline reached");
  };
  const resultOf = (outcome) => ({
    outcome, ev, snap, sig, changes, cursor, nudged, timedOut: outcome === "timeout", elapsedSec: Math.round((performance.now() - start) / 1000), checkpointed: false,
    cards: { ...cardsByRun[task.runId] },
    changedSinceReport: !current() || !sameSig(reported, sig), pollingOnly, receiptsWatched: receiptsWatcher !== null, lastChangeAt,
    watermarks: current() ? { state: ev.state, cursor, lastLeadMessageId: snap.leadText?.id ?? null, lastChangeAt, quietSince: null, outcomes: mergeOutcomes(snap.outcomes), cardOwners: snap.cardOwners, evidence: evidenceOf(snap), lastReported: sig, runtimeUntrusted: !runtimeTrusted }
      : { state: "running", cursor, lastChangeAt, quietSince: null, outcomes: mergeOutcomes(outcomes) },
  });
  const unverified = (outcome, reason) => {
    snap = { ...snap, complete: false, incomplete: [...(snap?.incomplete ?? []), reason] };
    // Keep the last observed busy list for the operator, but no settled claim.
    ev = { ...(ev ?? evaluate(snap, task)), state: "running", unknown: true, quiet: false, quietFor: 0, reasons: [reason] };
    sig = signatureOf(snap, ev);
    return resultOf(outcome);
  };
  const finish = async (outcome) => {
    const r = resultOf(outcome);
    if (checkpoint && current()) {
      // Timeout observations may checkpoint their last complete running view,
      // but the stream and generation guard remain live throughout that wait.
      const checkpointDeadline = Math.min(deadline + 1000, performance.now() + 1000);
      const guard = () => {
        if (!current()) throw new StaleObservation();
        if (outOfBudget(checkpointDeadline, controller.signal) || (outcome !== "timeout" && expired())) throw new Error("observation deadline reached");
      };
      streamDeadline = checkpointDeadline;
      try {
        try { r.checkpointed = await withinDeadline((opts) => checkpoint(r, { ...opts, assertCurrent: () => {
          if (opts.signal.aborted) throw new Error("observation deadline reached");
          guard();
        } }), checkpointDeadline, controller.signal); }
        catch (e) {
          if (e.message !== "observation deadline reached") throw e;
          r.checkpointed = false;
        }
        // Only this checkpoint's own watermarks are exempt from invalidation.
        if (r.checkpointed && getRuns) inputKey = runInputs(allRuns.map((run) => run.runId === task.runId ? { ...run, cards: r.cards, lastEval: mergeCheckpoint(run.lastEval, r.watermarks) } : run), history, task.runId);
        if (!current()) throw new StaleObservation();
      } finally { streamDeadline = deadline; }
    }
    return r;
  };
  try {
    try { await withinDeadline(() => streamReady, deadline, controller.signal); }
    catch (e) { if (!expired()) throw e; }
    while (!expired()) {
      if (!immediate && appliedInvalidations !== invalidations && lastSnapAt !== null) {
        // Leave time for the read: batching must not spend the entire budget
        // with an already invalidated view still waiting for hydration.
        await pause(Math.min(Math.max(0, lastSnapAt + coalesceMs - performance.now()), Math.max(0, (deadline - performance.now()) / 2)), controller.signal);
      }
      immediate = false;
      if (expired()) break;
      if (getRuns || getHistory) {
        const liveRuns = getRuns ? getRuns() : allRuns;
        const liveHistory = getHistory ? getHistory() : history;
        if (!liveRuns.some((r) => r.runId === task.runId)) {
          if (!snap) snap = await snapshot(client, { team, task, runs: allRuns, history }, { dataDir, deadline, signal: controller.signal });
          return unverified("unverified", "the watched run is no longer open; re-read the project state");
        }
        const nextInputs = runInputs(liveRuns, liveHistory, task.runId);
        if (nextInputs !== inputKey) { scope = null; scopeKey = null; quietSince = null; }
        allRuns = liveRuns; history = liveHistory; inputKey = nextInputs; scoped = allRuns.length > 1;
        const liveEval = allRuns.find((r) => r.runId === task.runId)?.lastEval;
        outcomes = mergeOutcomes(outcomes, liveEval?.outcomes);
        if (Number.isFinite(liveEval?.lastChangeAt)) lastChangeAt = Math.max(lastChangeAt, liveEval.lastChangeAt);
        runtimeTrusted &&= !allRuns.some((r) => r.lastEval?.runtimeUntrusted);
        foreignLeadThreads = new Set(allRuns.filter((r) => r.runId !== task.runId).map((r) => r.leadThreadId));
        for (const run of allRuns) {
          cardsByRun[run.runId] = { ...cardsByRun[run.runId], ...run.cards };
          for (const id of [...Object.values(run.threads ?? {}), run.leadThreadId].filter(Boolean)) threadIds.add(id);
        }
      }
      const targetAll = invalidations; const targetRelevant = relevant; const targetCursor = receivedCursor;
      verifiedGeneration = -1;
      const readRuns = allRuns.map((r) => ({ ...r, cards: cardsByRun[r.runId], ...(r.runId === task.runId ? { lastEval: { ...r.lastEval, outcomes, cardOwners: { ...cardOwners, ...r.lastEval?.cardOwners } } } : {}) }));
      snap = await snapshot(client, { team, task: readRuns.find((r) => r.runId === task.runId), runs: readRuns, history }, { dataDir, runtimeTrusted, deadline, signal: controller.signal });
      outcomes = mergeOutcomes(outcomes, snap.outcomes); snap.outcomes = outcomes;
      lastSnapAt = performance.now();
      const evidenceChanged = lastSig && !sameEvidence(lastSig, { evidence: evidenceOf(snap) });
      const busyNow = snap.bots.some((b) => b.busy) || snap.teamMap.queued.length || snap.teamMap.running.length || snap.openDelegations.total;
      // An invalidated observation cannot establish quiet, but busy or changed
      // evidence still disproves the quiet interval preceding that read.
      if (!snap.complete || busyNow || evidenceChanged) quietSince = null;
      for (const bot of snap.observedBots) teamIds.add(bot.id);
      for (const id of snap.observedThreads) threadIds.add(id);
      const nextScope = { botIds: new Set(snap.attributedBots), threadIds: new Set(snap.attributedThreads), bots: new Map(snap.observedBots.map((b) => [b.id, b])) };
      const nextKey = JSON.stringify([[...nextScope.botIds].sort(), [...nextScope.threadIds].sort(), [...threadIds].sort()]);
      const moved = snap.complete && scopeKey !== null && nextKey !== scopeKey;
      if (snap.complete) { scope = nextScope; scopeKey = nextKey; }
      // No evaluation, signature, cursor or card ownership from an invalidated
      // read can escape. Confirmation also covers frames classified under the
      // previous ownership, including a newly attributed bot's busy frame.
      if (targetRelevant !== relevant || moved || !sameInputs()) {
        if (++redraws >= 3) return unverified("unverified", "relevant traffic prevented a verified observation; call watch again");
        immediate = true;
        continue;
      }
      if (expired()) break;
      const now = Date.now();
      if (snap.complete) {
        verifiedGeneration = targetRelevant;
        appliedInvalidations = targetAll;
        if (targetCursor !== null) cursor = targetCursor;
        outcomes = mergeOutcomes(outcomes, snap.outcomes); snap.outcomes = outcomes;
        // A foreign owner can close before this watch checkpoints. Preserve
        // accepted provenance independently of the refreshed open-run list.
        cardOwners = snap.cardOwners;
        for (const run of allRuns) cardsByRun[run.runId] = mergeCards(cardsByRun[run.runId], snap.cardsByRun[run.runId], true);
      }

      if (!snap.complete || busyNow) quietSince = null;
      else if (quietSince === null || evidenceChanged) quietSince = lastSnapAt;
      if (evidenceChanged) lastChangeAt = now;
      ev = evaluate(snap, task, { now, quiet: { since: quietSince === null ? null : now - (lastSnapAt - quietSince) }, lastChangeAt, quietMs, dropMs, stallMs });
      sig = signatureOf(snap, ev);
      if (snap.complete && !sameSig(lastSig, sig)) {
        if (lastSig) changes.push({ at: now, from: lastSig.state, to: sig.state, lead: !sameEvidence(lastSig, sig) ? snap.leadText?.text ?? null : undefined, pending: sig.pending || undefined });
        lastSig = sig; lastChangeAt = now;
      }
      if (nudge && ev.state === "stalled" && /unacknowledged/.test(ev.hint ?? "") && !nudged) {
        try {
          await withinDeadline((opts) => { assertCurrent(); return nudge({ ...opts, deadline, assertCurrent }); }, deadline, controller.signal);
          nudged = true; changes.push({ at: Date.now(), nudged: true }); log("nudged the lead");
        } catch (e) { if (!(e instanceof StaleObservation)) log(`nudge failed: ${e.message}`); }
        // Sending (or waiting to send) is an asynchronous observation boundary.
        // Even without a frame yet, the pre-send snapshot cannot be reported.
        invalidate("own");
        if (++redraws >= 3 && !expired()) return unverified("unverified", "nudge activity requires a fresh observation; call watch again");
        immediate = true;
        continue;
      }
      if (expired()) break;
      const outcome = TERMINAL.has(ev.state) ? "terminal" : current() && until === "change" && !sameSig(reported, sig) ? "change" : null;
      if (outcome) {
        try {
          assertCurrent();
          const result = await finish(outcome);
          assertCurrent(); // The final awaited return also lets SSE run.
          return result;
        }
        catch (e) {
          if (expired()) break;
          if (!(e instanceof StaleObservation)) throw e;
          if (++redraws >= 3) return unverified("unverified", e.message);
          immediate = true;
          continue;
        }
      }
      redraws = 0;
      const quietRemaining = quietSince === null || ev.quiet ? Infinity : Math.max(0, quietSince + quietMs - performance.now());
      const waitMs = Math.min(pollMs, quietRemaining, Math.max(0, deadline - performance.now()));
      // A foreign wake received during the read is already scheduled. Do not
      // lose it by installing the waiter only after it has called wake().
      if (appliedInvalidations !== invalidations && snap.complete) continue;
      await new Promise((resolve) => {
        let timer;
        const done = () => { clearTimeout(timer); if (waiter === done) waiter = null; resolve(); };
        timer = setTimeout(done, waitMs); waiter = done;
      });
    }
    if (!snap) snap = await snapshot(client, { team, task, runs: allRuns, history }, { dataDir, deadline, signal: controller.signal });
    if (!current() || !ev || TERMINAL.has(ev.state)) return unverified("timeout", "observation deadline reached before verification");
    sig = signatureOf(snap, ev);
    try {
      const result = await finish("timeout");
      if (!current()) throw new StaleObservation();
      return result;
    }
    catch (e) {
      if (!(e instanceof StaleObservation) && !/observation deadline/.test(e.message)) throw e;
      return unverified("timeout", "observation deadline reached before checkpoint verification");
    }
  } finally {
    clearTimeout(deadlineTimer); controller.abort(); wake(); receiptsWatcher?.close();
    void streamTask.catch(() => {});
  }
}
