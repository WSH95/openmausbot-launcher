// The watch loop (design, "watch loop"): SSE frames are wake-ups, REST
// snapshots are the truth, quiet evidence lives inside one invocation, and
// the cursor checkpoint is the id of the last frame actually applied.
import fs from "node:fs";
import { snapshot, evaluate, evidenceOf, mergeOutcomes, withinDeadline, outOfBudget, cardKeyOf, TERMINAL, DEFAULTS } from "./snapshot.mjs";

const pause = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted || ms <= 0) return resolve();
  let timer;
  const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); };
  timer = setTimeout(done, ms);
  signal?.addEventListener("abort", done, { once: true });
});

/** Parse an SSE body into {id, data} frames; calls onFrame for each; resolves when the stream ends. */
export async function readEventStream(res, { onFrame, signal, idleMs = 45_000, deadline = Infinity }) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let idle;
  const armIdle = () => { clearTimeout(idle); idle = setTimeout(() => reader.cancel(new Error("idle")).catch(() => {}), idleMs); };
  armIdle();
  const onAbort = () => reader.cancel(new Error("aborted")).catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (!signal?.aborted && performance.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      armIdle();
      buf += dec.decode(value, { stream: true });
      let i;
      while (!signal?.aborted && performance.now() < deadline && (i = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, i); buf = buf.slice(i + 2);
        const frame = { id: null, data: null };
        for (const line of raw.split("\n")) {
          if (line.startsWith("id: ")) frame.id = line.slice(4).trim();
          else if (line.startsWith("data: ")) { try { frame.data = JSON.parse(line.slice(6)); } catch { frame.data = null; } }
        }
        if (frame.data) onFrame(frame);
      }
    }
  } finally { clearTimeout(idle); signal?.removeEventListener("abort", onAbort); void reader.cancel().catch(() => {}); }
}

/** Is this frame about the team or the run? */
export function relevantFrame(frame, { teamIds, threadIds, section }) {
  const d = frame.data;
  if (!d) return false;
  switch (d.kind) {
    case "hello": return d.resumed === false; // a gap: re-hydrate
    case "bot": case "bot.deleted": return teamIds.has(d.bot?.id ?? d.id) || Boolean(section && d.bot?.section === section);
    case "message": case "message.patch": case "thread": return threadIds.has(d.threadId);
    case "notify": return teamIds.has(d.notification?.botId) || threadIds.has(d.notification?.threadId);
    default: return false;
  }
}

export const signatureOf = (snap, ev) => ({
  state: ev.state, leadMessageId: snap.leadText?.id ?? null,
  evidence: evidenceOf(snap),
  pending: snap.pending.map((p) => p.requestId ?? `${p.kind}:${p.botId}`).join(","),
});
const sameEvidence = (a, b) => Boolean(a?.evidence && b?.evidence) && JSON.stringify(a.evidence) === JSON.stringify(b.evidence);
const sameSig = (a, b) => Boolean(a && b) && a.state === b.state && sameEvidence(a, b);

/** The record a watch checkpoint writes: its watermarks over the existing one, never losing a `lastChangeAt` another writer (send, nudge) advanced meanwhile, nor fields the watch does not own. */
export function mergeCheckpoint(existing, watermarks) {
  const prior = existing ?? {};
  const stamps = [prior.lastChangeAt, watermarks.lastChangeAt].filter((v) => Number.isFinite(v));
  return { ...prior, ...watermarks, lastChangeAt: stamps.length ? Math.max(...stamps) : null };
}

/** Watch uses one monotonic observation deadline, including every invalidation
 * drain. Only complete snapshots advance the cursor covered by REST truth. */
export async function watchRun({ client, team, task, runs = [], dataDir = null, maxSeconds = 100, until = "settled", pollMs = 30_000, quietMs = DEFAULTS.quietMs, dropMs = DEFAULTS.dropMs, stallMs = DEFAULTS.stallMs, idleMs = 45_000, coalesceMs = 2_000, nudge = null, log = () => {}, deadline = performance.now() + maxSeconds * 1000 }) {
  const start = performance.now();
  const teamIds = new Set([...team.bots.map((b) => b.id), team.lead.id]);
  const threadIds = new Set(Object.values(task.threads ?? {}).concat(task.leadThreadId ? [task.leadThreadId] : []));
  let cursor = task.lastEval?.cursor ?? null;
  let receivedCursor = cursor;
  let quietSince = null;
  let lastChangeAt = task.lastEval?.lastChangeAt ?? task.sentAt ?? Date.now();
  let lastSig = task.lastEval?.lastReported ?? null;
  const reported = lastSig;
  const changes = [];
  let outcomes = mergeOutcomes(task.lastEval?.outcomes);
  let nudged = Boolean(task.nudgedAt);
  let invalidations = 0; let appliedInvalidations = -1;
  let streamFailures = 0; let pollingOnly = false;
  let waiter = null;
  const wake = () => waiter?.();
  const controller = new AbortController();
  const deadlineTimer = setTimeout(() => { controller.abort(); wake(); }, Math.max(0, deadline - performance.now()));
  // The same question withinDeadline asks, so a budget it refuses is one this loop calls expired.
  const expired = () => outOfBudget(deadline, controller.signal);
  const invalidate = () => { invalidations++; quietSince = null; wake(); };

  let markStreamReady;
  const streamReady = new Promise((resolve) => { markStreamReady = resolve; });
  const runStream = async () => {
    while (!expired() && !pollingOnly) {
      try {
        const res = await withinDeadline(({ signal }) => client.stream(`/api/events?screens=off${cursor ? `&since=${encodeURIComponent(cursor)}` : ""}`, signal), deadline, controller.signal);
        if (res.status !== 200) throw new Error(`event stream ${res.status}`);
        const reading = readEventStream(res, {
          signal: controller.signal, idleMs, deadline,
          onFrame: (frame) => {
            if (expired()) return;
            streamFailures = 0;
            if (frame.data?.kind === "ping") return;
            if (frame.id) receivedCursor = frame.id;
            if (relevantFrame(frame, { teamIds, threadIds, section: team.section })) invalidate();
          },
        });
        // Start reading buffered hello/replay frames before hydration can
        // establish quiet. Connection setup itself cannot count as quiet.
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
    try { receiptsWatcher = fs.watch(dataDir, (_ev, name) => { if (name === "delegation-receipts.json" && !expired()) invalidate(); }); }
    catch (e) { log(`receipts: ${e.message}`); }
  }

  let snap = null; let ev = null; let sig = null;
  let lastSnapAt = null; let outcome = "timeout";
  try {
    try { await withinDeadline(() => streamReady, deadline, controller.signal); }
    catch (e) { if (!expired()) throw e; }
    while (!expired()) {
      const pending = appliedInvalidations !== invalidations;
      // Coalescing applies to frame traffic. A quiet-threshold verification
      // must not wait for either the next poll or the coalescing interval.
      if (pending && lastSnapAt !== null) {
        await pause(Math.min(Math.max(0, lastSnapAt + coalesceMs - performance.now()), Math.max(0, deadline - performance.now())), controller.signal);
      }
      if (expired()) break;
      const targetInvalidations = invalidations;
      const targetCursor = receivedCursor;
      snap = await snapshot(client, { team, task: { ...task, lastEval: { ...task.lastEval, outcomes } }, runs: runs.map((r) => (r.runId === task.runId ? { ...r, lastEval: { ...task.lastEval, outcomes } } : r)) }, { dataDir, deadline, signal: controller.signal });
      outcomes = mergeOutcomes(outcomes, snap.outcomes); snap.outcomes = outcomes;
      lastSnapAt = performance.now();
      const now = Date.now();
      for (const bot of snap.bots) teamIds.add(bot.id);
      for (const thread of snap.runThreads) threadIds.add(thread.threadId);
      const busyNow = snap.bots.some((b) => b.busy) || snap.teamMap.queued.length > 0 || snap.teamMap.running.length > 0;
      const hasUnappliedFrames = targetInvalidations !== invalidations;
      if (snap.complete && !expired()) {
        if (targetCursor !== null) cursor = targetCursor;
        appliedInvalidations = targetInvalidations;
      }
      const evidenceChanged = lastSig && !sameEvidence(lastSig, { evidence: evidenceOf(snap) });
      if (!snap.complete || busyNow || hasUnappliedFrames) quietSince = null;
      else if (quietSince === null || evidenceChanged) quietSince = lastSnapAt;
      if (evidenceChanged) lastChangeAt = now;
      const quiet = { since: quietSince === null ? null : now - (lastSnapAt - quietSince) };
      ev = evaluate(snap, task, { now, quiet, lastChangeAt, quietMs, dropMs, stallMs });
      sig = signatureOf(snap, ev);
      if (!sameSig(lastSig, sig)) {
        if (lastSig) changes.push({ at: now, from: lastSig.state, to: sig.state, lead: !sameEvidence(lastSig, sig) ? snap.leadText?.text ?? null : undefined, pending: sig.pending || undefined });
        lastSig = sig; lastChangeAt = now;
      }
      // Deadline has priority over draining another frame or acting on a verdict.
      if (expired()) break;
      if (hasUnappliedFrames) continue;
      if (nudge && ev.state === "stalled" && /unacknowledged/.test(ev.hint ?? "") && !nudged) {
        try {
          await withinDeadline((opts) => nudge(opts), deadline, controller.signal);
          nudged = true; changes.push({ at: Date.now(), nudged: true }); log("nudged the lead");
        } catch (e) { log(`nudge failed: ${e.message}`); }
        quietSince = null;
        ev = { ...ev, state: "running", reasons: ["nudged the lead; waiting for its wake", ...ev.reasons], nudged };
        sig = signatureOf(snap, ev); lastSig = sig; lastChangeAt = Date.now();
      }
      if (expired()) break;
      if (appliedInvalidations !== invalidations && snap.complete) continue;
      if (TERMINAL.has(ev.state)) { outcome = "terminal"; break; }
      if (until === "change" && !sameSig(reported, sig)) { outcome = "change"; break; }
      if (until === "question" && ["needs-user", "attention"].includes(ev.state)) { outcome = "question"; break; }
      const quietRemaining = quietSince === null || ev.quiet ? Infinity : Math.max(0, quietSince + quietMs - performance.now());
      const waitMs = Math.min(pollMs, quietRemaining, Math.max(0, deadline - performance.now()));
      await new Promise((resolve) => {
        let timer;
        const done = () => { clearTimeout(timer); if (waiter === done) waiter = null; resolve(); };
        timer = setTimeout(done, waitMs); waiter = done;
      });
    }
    if (!snap) snap = await snapshot(client, { team, task, runs }, { dataDir, deadline, signal: controller.signal });
    if (!ev) ev = evaluate(snap, task);
    if (outcome === "timeout" && (TERMINAL.has(ev.state) || appliedInvalidations !== invalidations)) ev = { ...ev, state: "running", unknown: true, quiet: false, reasons: ["observation deadline reached before verification"] };
    sig = signatureOf(snap, ev);
  } finally {
    clearTimeout(deadlineTimer); controller.abort(); wake(); receiptsWatcher?.close();
    // The stream and backoff share this abort signal; never add a cleanup grace
    // period to the observation budget for a server that ignores cancellation.
    void streamTask.catch(() => {});
  }
  return {
    outcome, ev, snap, sig, changes, cursor, nudged, timedOut: outcome === "timeout", elapsedSec: Math.round((performance.now() - start) / 1000),
    // What this run owns of what is pending now: a card keeps the run that saw
    // it first, and one that has been answered stops being remembered.
    cards: Object.fromEntries(snap.pending.filter((p) => p.shared !== true).map((p) => [cardKeyOf(p), true])),
    changedSinceReport: !sameSig(reported, sig), pollingOnly, receiptsWatched: receiptsWatcher !== null, lastChangeAt,
    watermarks: { state: ev.state, cursor, lastLeadMessageId: snap.leadText?.id ?? null, lastChangeAt, quietSince: null, outcomes: mergeOutcomes(snap.outcomes), evidence: evidenceOf(snap), lastReported: sig },
  };
}
