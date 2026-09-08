// The watch loop (design, "watch loop"): SSE frames are wake-ups, REST
// snapshots are the truth, quiet evidence lives inside one invocation, and
// the cursor checkpoint is the id of the last frame actually applied.
import fs from "node:fs";
import path from "node:path";
import { snapshot, evaluate, TERMINAL, DEFAULTS } from "./snapshot.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Parse an SSE body into {id, data} frames; calls onFrame for each; resolves when the stream ends. */
export async function readEventStream(res, { onFrame, signal, idleMs = 45_000 }) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let idle;
  const armIdle = () => { clearTimeout(idle); idle = setTimeout(() => reader.cancel(new Error("idle")).catch(() => {}), idleMs); };
  armIdle();
  const onAbort = () => reader.cancel(new Error("aborted")).catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      armIdle();
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, i); buf = buf.slice(i + 2);
        const frame = { id: null, data: null };
        for (const line of raw.split("\n")) {
          if (line.startsWith("id: ")) frame.id = line.slice(4).trim();
          else if (line.startsWith("data: ")) { try { frame.data = JSON.parse(line.slice(6)); } catch { frame.data = null; } }
        }
        if (frame.data) onFrame(frame);
      }
    }
  } finally { clearTimeout(idle); signal?.removeEventListener("abort", onAbort); }
}

/** Is this frame about the team or the run? */
export function relevantFrame(frame, { teamIds, threadIds }) {
  const d = frame.data;
  if (!d) return false;
  switch (d.kind) {
    case "hello": return d.resumed === false; // a gap: re-hydrate
    case "bot": case "bot.deleted": return teamIds.has(d.bot?.id ?? d.id);
    case "message": case "message.patch": case "thread": return threadIds.has(d.threadId);
    case "notify": return teamIds.has(d.notification?.botId) || threadIds.has(d.notification?.threadId);
    default: return false;
  }
}

export const signatureOf = (snap, ev) => ({
  state: ev.state, leadMessageId: snap.leadText?.id ?? null, outcomes: snap.outcomes.map((o) => o.id).join(","),
  pending: snap.pending.map((p) => p.requestId ?? `${p.kind}:${p.botId}`).join(","), busy: (ev.busy ?? []).join(","), lastUserId: snap.lastUser?.id ?? null,
});
const sameSig = (a, b) => Boolean(a && b) && ["state", "leadMessageId", "outcomes", "pending", "busy", "lastUserId"].every((k) => a[k] === b[k]);
const progressed = (a, b) => !a || !b || ["leadMessageId", "outcomes", "pending", "busy", "lastUserId"].some((k) => a[k] !== b[k]);

/**
 * Watch one run until a terminal state, a change (until=change), a question
 * (until=question), or the deadline. Returns the final evaluation and the
 * watermarks to persist.
 */
export async function watchRun({ client, team, task, dataDir = null, maxSeconds = 100, until = "settled", pollMs = 30_000, quietMs = DEFAULTS.quietMs, dropMs = DEFAULTS.dropMs, stallMs = DEFAULTS.stallMs, idleMs = 45_000, coalesceMs = 2_000, nudge = null, log = () => {} }) {
  const start = Date.now();
  const deadline = start + maxSeconds * 1000;
  const teamIds = new Set([...team.bots.map((b) => b.id), team.lead.id]);
  const threadIds = new Set(Object.values(task.threads ?? {}).concat(task.leadThreadId ? [task.leadThreadId] : []));
  let cursor = task.lastEval?.cursor ?? null;
  let quiet = { since: null };
  let lastChangeAt = task.lastEval?.lastChangeAt ?? task.sentAt ?? start;
  let lastSig = task.lastEval?.lastReported ?? null;
  const reported = lastSig;
  const changes = [];
  let nudged = Boolean(task.nudgedAt);
  let pendingFrames = 0;
  let resetQuiet = false;
  let lastFrameAt = null;
  let streamFailures = 0;
  let pollingOnly = false;
  let waiter = null;
  const wake = () => { if (waiter) { const w = waiter; waiter = null; w(); } };
  const controller = new AbortController();

  // ── the stream, as wake-ups ──
  const runStream = async () => {
    while (!controller.signal.aborted && Date.now() < deadline && !pollingOnly) {
      try {
        const res = await client.stream(`/api/events?screens=off${cursor ? `&since=${encodeURIComponent(cursor)}` : ""}`, controller.signal);
        if (res.status !== 200) throw new Error(`event stream ${res.status}`);
        streamFailures = 0;
        await readEventStream(res, {
          signal: controller.signal, idleMs,
          onFrame: (frame) => {
            lastFrameAt = Date.now();
            if (frame.data?.kind === "ping") return;
            if (frame.data?.kind === "hello" && frame.data.resumed === false && cursor) { resetQuiet = true; }
            const relevant = relevantFrame(frame, { teamIds, threadIds });
            if (frame.id) cursor = frame.id; // applied as an invalidation below; the id is checkpointed with the snapshot it triggered
            if (relevant) { pendingFrames++; wake(); }
          },
        });
      } catch (e) {
        if (controller.signal.aborted) return;
        log(`stream: ${e.message}`);
      }
      if (controller.signal.aborted || Date.now() >= deadline) return;
      streamFailures++;
      if (streamFailures >= 3) { pollingOnly = true; log("stream: polling only"); return; }
      await sleep(2_000);
    }
  };
  const streamTask = runStream();

  // ── receipts file, best effort ──
  let receiptsWatcher = null;
  if (dataDir) { try { receiptsWatcher = fs.watch(dataDir, (ev, name) => { if (name === "delegation-receipts.json") { pendingFrames++; wake(); } }); } catch {} }

  let snap = null; let ev = null; let sig = null;
  let lastSnapAt = 0;
  let outcome = null;
  try {
    for (;;) {
      const now = Date.now();
      // coalesce: at most one snapshot per coalesceMs when frames keep coming
      if (now - lastSnapAt < coalesceMs && lastSnapAt) await sleep(coalesceMs - (now - lastSnapAt));
      pendingFrames = 0;
      const applyReset = resetQuiet; resetQuiet = false;
      snap = await snapshot(client, { team, task }, { dataDir });
      lastSnapAt = Date.now();
      const busyNow = snap.bots.some((b) => b.busy) || snap.teamMap.queued.length > 0 || snap.teamMap.running.length > 0;
      if (!snap.complete || busyNow || applyReset) quiet = { since: null };
      else if (quiet.since === null) quiet = { since: lastSnapAt };
      ev = evaluate(snap, task, { now: lastSnapAt, quiet, lastChangeAt, quietMs, dropMs, stallMs });
      sig = signatureOf(snap, ev);
      if (lastSig && progressed(lastSig, sig)) { quiet = snap.complete && !busyNow ? { since: lastSnapAt } : { since: null }; ev = evaluate(snap, task, { now: lastSnapAt, quiet, lastChangeAt: lastSnapAt, quietMs, dropMs, stallMs }); sig = signatureOf(snap, ev); }
      if (!sameSig(lastSig, sig)) { if (lastSig) changes.push({ at: lastSnapAt, from: lastSig.state, to: sig.state, lead: sig.leadMessageId !== lastSig?.leadMessageId ? snap.leadText?.text ?? null : undefined, pending: sig.pending || undefined }); lastChangeAt = lastSnapAt; lastSig = sig; }
      // nudge once per run on a suspected unacknowledged delegation
      if (nudge && ev.state === "stalled" && /unacknowledged/.test(ev.hint ?? "") && !nudged) {
        try { await nudge(); nudged = true; changes.push({ at: Date.now(), nudged: true }); log("nudged the lead"); } catch (e) { log(`nudge failed: ${e.message}`); }
        ev = { ...ev, state: "running", reasons: ["nudged the lead; waiting for its wake", ...ev.reasons], nudged: true };
        sig = signatureOf(snap, ev); lastSig = sig; lastChangeAt = Date.now();
      }
      if (pendingFrames > 0) continue; // never conclude with unapplied frames
      const terminal = TERMINAL.has(ev.state);
      const changedSinceReport = !sameSig(reported, sig);
      if (terminal) { outcome = "terminal"; break; }
      if (until === "change" && changedSinceReport) { outcome = "change"; break; }
      if (until === "question" && ["needs-user", "attention"].includes(ev.state)) { outcome = "question"; break; }
      const remaining = deadline - Date.now();
      if (remaining <= 0) { outcome = "timeout"; break; }
      // wait for a frame, the receipts file, the poll interval, or the deadline
      await new Promise((resolve) => {
        const t = setTimeout(resolve, Math.min(pollMs, remaining));
        waiter = () => { clearTimeout(t); resolve(); };
      });
      if (Date.now() >= deadline && pendingFrames === 0) { outcome = "timeout"; break; }
    }
  } finally {
    controller.abort();
    receiptsWatcher?.close();
    await Promise.race([streamTask, sleep(500)]);
  }
  return {
    outcome, ev, snap, sig, changes, cursor, nudged, timedOut: outcome === "timeout", elapsedSec: Math.round((Date.now() - start) / 1000),
    changedSinceReport: !sameSig(reported, sig), pollingOnly, lastChangeAt,
    watermarks: { state: ev.state, cursor, lastLeadMessageId: snap.leadText?.id ?? null, lastChangeAt, quietSince: null, outcomes: snap.outcomes.map((o) => ({ id: o.id, at: o.at, kind: o.kind })), lastReported: sig },
  };
}
