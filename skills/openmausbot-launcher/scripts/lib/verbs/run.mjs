// status (and, in later steps, task, send, answer, interrupt, watch).
import { verb, EXIT, Fail } from "../cli.mjs";
import { resolveConfig } from "../config.mjs";
import { createClient } from "../http.mjs";
import { snapshot, evaluate, brief, TERMINAL } from "../snapshot.mjs";

export function requireTeam(cfg) {
  if (!cfg.state?.team) throw new Fail(EXIT.PRECONDITION, "no team is recorded for this project", { hint: "run import <package.json> or import --adopt <section>" });
  return cfg.state.team;
}

/** What a fresh invocation may carry from the last watch: the change watermark, never quiet evidence (design, "quiet"). */
export function carriedInputs(task) {
  return { quiet: { since: null }, lastChangeAt: task?.lastEval?.lastChangeAt ?? task?.sentAt ?? null };
}

verb("status", {
  options: { bots: { type: "boolean" }, tail: { type: "string" } },
  handler: async ({ flags }) => {
    const cfg = resolveConfig(flags);
    const team = requireTeam(cfg);
    const client = createClient(cfg);
    const task = cfg.state.task && cfg.state.task.status !== "closed" ? cfg.state.task : null;
    const snap = await snapshot(client, { team, task }, { dataDir: cfg.dataDirReadable ? cfg.dataDir : null });
    if (!task) {
      const busy = snap.bots.filter((b) => b.busy).map((b) => b.name);
      return { result: { run: null, complete: snap.complete, incomplete: snap.incomplete, bots: snap.bots, busy, pending: snap.pending }, brief: `status · no run · ${busy.length ? `${busy.join(", ")} working` : "team idle"}${snap.pending.length ? ` · ${snap.pending.length} pending request(s)` : ""}` };
    }
    const carried = carriedInputs(task);
    // A single snapshot cannot establish settlement; keep the last watch's terminal verdict when nothing moved since.
    let ev = evaluate(snap, task, carried);
    const last = task.lastEval;
    const unchanged = last && last.lastLeadMessageId === (snap.leadText?.id ?? null) && (last.outcomes?.length ?? 0) === snap.outcomes.length && !snap.pending.length;
    if (ev.state === "running" && last && TERMINAL.has(last.state) && unchanged && !ev.inflight) ev = { ...ev, state: last.state, reasons: [`from the last watch: ${last.state}`, ...ev.reasons], carried: true };
    const line = brief(ev, snap, task);
    const tail = Number(flags.tail ?? 0);
    return {
      result: { run: { runId: task.runId, status: task.status, title: task.title, slug: task.slug, sentAt: task.sentAt }, state: ev.state, reasons: ev.reasons, hint: ev.hint, inflight: ev.inflight, busy: ev.busy, quietFor: ev.quietFor, pending: snap.pending, outcomes: snap.outcomes, lead: snap.leadText, lastUser: snap.lastUser, marker: snap.markerSeen, complete: snap.complete, incomplete: snap.incomplete, receipts: snap.receipts, ...(flags.bots ? { bots: snap.bots, teamMap: snap.teamMap } : {}), ...(tail > 0 ? { tail: snap.leadTail.slice(-tail).map((m) => ({ id: m.id, at: m.at, role: m.role, kind: m.kind, from: m.from?.name ?? null, text: summarizeLong(m) })) } : {}), brief: line },
      brief: line,
    };
  },
});

const summarizeLong = (m) => (m.text ?? m.tool?.name ?? "").replace(/\s+/g, " ").slice(0, 400);
