// The snapshot (REST truth) and the pure evaluation of a run (design,
// "Snapshot and evaluation"). Upstream's classifiers are mirrored from
// scripts/mcp-server.ts:652-672; the busy set from server/store.ts:407-409.
import fs from "node:fs/promises";
import path from "node:path";

export const BUSY = new Set(["working", "waiting-on-you", "no-signal"]);
export const ECHO_RE = /^@.+? replied to the delegated task/s; // server/index.ts:3386; names may contain spaces
export const DELEGATION_RE = /^Delegation to @(.+?) (completed without a text reply|failed|waiting|dropped|canceled|denied)/; // index.ts:3392-3401, delegations.ts:495
export const DEFAULTS = { quietMs: 30_000, dropMs: 2 * 60_000, stallMs: 40 * 60_000 };

export const markerLine = (tag) => `DONE ${tag}`;
export const markerRe = (tag) => new RegExp(`^${markerLine(tag).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");

/** Direct turn text carries no `from` (index.ts:2731-2736); room text and echoes do. */
export const isLeadText = (m, leadId) => m.role === "bot" && m.kind === "text" && Boolean(m.text?.trim()) && (!m.from || m.from.botId === leadId) && !ECHO_RE.test(m.text);
export const isEcho = (m, leadId) => m.role === "bot" && m.kind === "text" && Boolean(m.from) && m.from.botId !== leadId && ECHO_RE.test(m.text ?? "");

/** mcp-server.ts:652-660 */
export function messageNeedsInput(m) {
  const card = m.card && m.card.requestId && !m.card.answered && !m.card.dismissed;
  const connector = m.connector && !m.connector.dismissed && !m.connector.resumed && m.connector.status !== "connected";
  const secret = m.secret && !m.secret.provided && !m.secret.dismissed;
  return Boolean(card || connector || secret);
}

/** mcp-server.ts:662-672: no bot text after the last user message, and an `error:` activity with ok false. */
export function dispatchFailedAfterLatestUser(messages) {
  const lastUser = messages.findLastIndex((m) => m.role === "user");
  const turn = messages.slice(lastUser + 1);
  if (turn.some((m) => m.role === "bot" && m.kind === "text" && m.text?.trim())) return false;
  return turn.some((m) => m.kind === "activity" && m.tool?.ok === false && typeof m.tool?.name === "string" && /^error:/i.test(m.tool.name.trim()));
}

/** One line, short enough for a phone (server/notify.ts:38). */
export function summarize(text, max = 140) {
  const line = String(text ?? "").replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** A single monotonic budget covers REST, pagination, and local receipt reads. */
export async function withinDeadline(fn, deadline, signal) {
  const remaining = Math.floor(deadline - performance.now());
  if (remaining <= 0 || signal?.aborted) throw new Error("observation deadline reached");
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let timer; let onAbort;
  try {
    return await Promise.race([
      new Promise((_, reject) => {
        onAbort = () => reject(new Error("observation deadline reached"));
        combined.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(() => controller.abort(), remaining);
      }),
      Promise.resolve().then(() => {
        const timeoutMs = Math.floor(deadline - performance.now());
        if (timeoutMs <= 0 || combined.aborted) throw new Error("observation deadline reached");
        return fn({ timeoutMs, signal: combined });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    combined.removeEventListener("abort", onAbort);
  }
}

export async function readReceipts(dataDir, { deadline = performance.now() + 15_000, signal } = {}) {
  if (!dataDir) return null;
  try {
    const raw = await withinDeadline((opts) => fs.readFile(path.join(dataDir, "delegation-receipts.json"), { encoding: "utf8", signal: opts.signal }), deadline, signal);
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : null;
  } catch (e) {
    if (performance.now() >= deadline || signal?.aborted || /observation deadline/.test(e.message)) throw e;
    return null;
  }
}

/** Keep full outcome evidence by ID, even after upstream's receipts file is pruned.
 * Sequence numbers from older checkpoints are slice-relative and never reusable. */
export function mergeOutcomes(...lists) {
  const byId = new Map();
  for (const list of lists) for (const outcome of list ?? []) {
    const { seq, ...value } = outcome;
    byId.set(value.id, { ...byId.get(value.id), ...value });
  }
  return [...byId.values()].sort((a, b) => a.at - b.at || String(a.id).localeCompare(String(b.id)));
}

const getWithinDeadline = (client, route, deadline, signal) => withinDeadline(
  (opts) => client.get(route, opts),
  Math.min(deadline, performance.now() + (client.timeoutMs ?? 15_000)), signal,
);

/** Page every run thread to the dispatch boundary (including timestamp ties). */
async function readTail(client, threadId, { sentAt, deadline, signal }) {
  let all = []; let before = null;
  const seen = new Set();
  for (;;) {
    const page = await getWithinDeadline(client, `/api/threads/${encodeURIComponent(threadId)}/messages?limit=100${before ? `&before=${encodeURIComponent(before)}` : ""}`, deadline, signal);
    if (!Array.isArray(page?.messages)) throw new Error("missing messages array");
    const msgs = page.messages;
    all = [...msgs, ...all];
    if (!page.hasMore || (sentAt != null && msgs.some((m) => m.at < sentAt))) {
      return all.filter((m) => sentAt == null || m.at >= sentAt);
    }
    const next = msgs[0]?.id;
    if (!next || seen.has(next)) throw new Error("pagination did not reach the run boundary");
    seen.add(next); before = next;
  }
}

/** Real option cards have no kind: skill/routine requests precede tool approval.
 * The full JSON metadata is actionable; only brief() shortens human text. */
export function pendingMessage(m, { threadId, botId, botName }) {
  const card = m.card;
  const cardKind = card ? card.skillRequest ? "skill" : card.routineRequest ? "routine" : card.tool ? "approval" : "question" : null;
  return {
    threadId, botId, botName, kind: card ? "card" : m.connector ? "connector" : "secret",
    requestId: card?.requestId ?? null, cardKind, messageId: m.id,
    text: m.text ?? card?.subtitle ?? card?.title ?? "",
    ...(card ? { card, title: card.title, subtitle: card.subtitle, options: card.options, tool: card.tool, held: card.held, approvalScope: card.approvalScope, allowKey: card.allowKey, skillRequest: card.skillRequest, routineRequest: card.routineRequest } : {}),
    ...(m.connector ? { connector: m.connector } : {}), ...(m.secret ? { secret: m.secret } : {}),
  };
}

/** Gather REST truth; failed or deadline-cutoff reads produce incomplete truth. */
export async function snapshot(client, state, { dataDir = null, now = Date.now(), deadline = performance.now() + 15_000, signal } = {}) {
  const team = state.team; const task = state.task; const leadId = team.lead.id;
  const incomplete = [];
  const get = async (label, fn) => { try { return await fn(); } catch (e) { incomplete.push(`${label}: ${e.message}`); return null; } };
  const [fleet, teamMap] = await Promise.all([
    get("bots", () => getWithinDeadline(client, "/api/bots?messages=0", deadline, signal)),
    get("team-map", () => getWithinDeadline(client, "/api/team-map", deadline, signal)),
  ]);
  if (!Array.isArray(fleet?.bots)) incomplete.push("missing fleet bots");
  if (!Array.isArray(teamMap?.queued) || !Array.isArray(teamMap?.running)) incomplete.push("missing team-map queues");
  const known = new Map(team.bots.map((b) => [b.id, b]));
  const bots = [];
  if (Array.isArray(fleet?.bots)) {
    for (const b of fleet.bots) {
      if (b.hidden) continue;
      if (known.has(b.id) || b.id === leadId || (team.section && b.section === team.section)) {
        const k = known.get(b.id);
        bots.push({ id: b.id, name: b.name, key: k?.key ?? null, title: b.title ?? k?.title ?? null, busy: Boolean(b.busy) || BUSY.has(b.activity), activity: b.activity ?? (b.busy ? "working" : "idle"), threadId: b.threadId, discovered: !known.has(b.id) });
      }
    }
    for (const b of team.bots) if (!bots.some((x) => x.id === b.id)) incomplete.push(`bot ${b.name} is missing from the fleet`);
  }
  const ids = new Set(bots.map((b) => b.id));
  const lead = bots.find((b) => b.id === leadId) ?? null;
  if (!lead) incomplete.push("lead is missing from the fleet");
  const tm = { queued: (teamMap?.queued ?? []).filter((q) => ids.has(q.sourceBotId) && ids.has(q.targetBotId)), running: (teamMap?.running ?? []).filter((r) => ids.has(r.sourceBotId) && ids.has(r.targetBotId)) };
  const leadThreadId = task?.leadThreadId ?? lead?.threadId ?? null;
  const runThreads = new Map();
  for (const [botId, threadId] of Object.entries(task?.threads ?? {})) if (threadId) runThreads.set(threadId, botId);
  for (const bot of bots) {
    if ((!task || !task.threads?.[bot.id]) && bot.threadId) runThreads.set(bot.threadId, bot.id);
  }
  if (leadThreadId) runThreads.set(leadThreadId, leadId);
  else incomplete.push("lead thread is missing");
  const pending = []; let msgs = []; let failedTails = 0;
  await Promise.all([...runThreads].map(async ([threadId, botId]) => {
    const tail = await get(`thread ${threadId}`, () => readTail(client, threadId, { sentAt: task?.sentAt, deadline, signal }));
    if (!tail) { failedTails++; return; }
    const botName = bots.find((b) => b.id === botId)?.name ?? null;
    for (const m of tail) if (messageNeedsInput(m)) pending.push(pendingMessage(m, { threadId, botId, botName }));
    if (threadId === leadThreadId) msgs = tail;
  }));
  for (const b of bots) if (b.activity === "waiting-on-you" && !pending.some((p) => p.botId === b.id)) pending.push({ threadId: b.threadId, botId: b.id, botName: b.name, kind: "waiting", requestId: null, cardKind: null, text: `${b.name} is waiting on you` });
  const leadTexts = msgs.filter((m) => isLeadText(m, leadId));
  const lastLead = leadTexts.at(-1); const latestUser = msgs.findLast((m) => m.role === "user");
  const leadText = lastLead ? { id: lastLead.id, at: lastLead.at, text: lastLead.text } : null;
  const lastUser = latestUser ? { id: latestUser.id, at: latestUser.at, text: latestUser.text } : null;
  const observedOutcomes = [];
  for (const m of msgs) {
    if (isEcho(m, leadId)) observedOutcomes.push({ id: m.id, at: m.at, kind: "echo", name: m.from?.name ?? null, text: m.text, ok: true });
    else if (m.kind === "activity" && typeof m.tool?.name === "string") { const d = DELEGATION_RE.exec(m.tool.name); if (d) observedOutcomes.push({ id: m.id, at: m.at, kind: "delegation", name: d[1], variant: d[2], text: m.text ?? null, tool: m.tool, ok: m.tool.ok === true }); }
  }
  const receipts = await get("receipts", () => readReceipts(dataDir, { deadline, signal }));
  let receiptsForRun = null;
  if (receipts && leadThreadId) {
    receiptsForRun = receipts.filter((r) => r.sourceThreadId === leadThreadId && (task?.sentAt == null || r.finishedAt >= task.sentAt));
    for (const r of receiptsForRun) observedOutcomes.push({ ...r, id: `receipt:${r.id}`, at: r.finishedAt, kind: "receipt", name: r.toBotName ?? null, status: r.status ?? null, ok: r.status === "completed" });
  }
  const outcomes = mergeOutcomes(task?.lastEval?.outcomes, observedOutcomes);
  const markerSeen = task?.tag ? leadTexts.filter((m) => markerRe(task.tag).test(m.text)).map((m) => ({ id: m.id, at: m.at })).at(-1) ?? null : null;
  if (performance.now() >= deadline || signal?.aborted) incomplete.push("observation deadline reached");
  return {
    at: now, complete: incomplete.length === 0, incomplete,
    bots, lead, teamMap: tm, leadThreadId, runThreads: [...runThreads].map(([threadId, botId]) => ({ threadId, botId })), leadTail: msgs, leadText, lastUser, outcomes, pending, markerSeen,
    dispatchFailed: dispatchFailedAfterLatestUser(msgs), receipts: { supported: receipts !== null, forRun: receiptsForRun?.length ?? null }, truncatedTails: failedTails,
  };
}

/** Timestamp ties are knowable only for messages present in this hydration. */
function leadAfter(snap, other) {
  if (!snap.leadText || !other) return false;
  if (snap.leadText.at !== other.at) return snap.leadText.at > other.at;
  const leadIndex = snap.leadTail.findIndex((m) => m.id === snap.leadText.id);
  const otherIndex = snap.leadTail.findIndex((m) => m.id === other.id);
  return leadIndex >= 0 && otherIndex >= 0 && leadIndex > otherIndex;
}

// Stable keys and set ordering avoid false changes due solely to API ordering.
const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, canonical(v[k])])) : v;
const stable = (v) => JSON.stringify(canonical(v));
const ordered = (list) => [...(list ?? [])].map(canonical).sort((a, b) => stable(a).localeCompare(stable(b)));

/** Persist all evidence needed to conservatively carry a terminal verdict. */
export function evidenceOf(snap) {
  return canonical({ version: 1, complete: snap.complete, leadThreadId: snap.leadThreadId, lead: snap.lead, leadText: snap.leadText, lastUser: snap.lastUser, markerSeen: snap.markerSeen,
    outcomes: ordered(mergeOutcomes(snap.outcomes)), pending: ordered(snap.pending), bots: ordered(snap.bots), teamMap: { queued: ordered(snap.teamMap.queued), running: ordered(snap.teamMap.running) }, dispatchFailed: snap.dispatchFailed });
}

export function carriedVerdict(snap, task) {
  const last = task?.lastEval;
  if (!last?.evidence || !["done", "attention", "stalled", "failed"].includes(last.state)) return null;
  if (!snap.complete || !snap.lead || snap.pending.length || snap.bots.some((b) => b.busy || BUSY.has(b.activity)) || snap.teamMap.queued.length || snap.teamMap.running.length) return null;
  if (stable(last.evidence) !== stable(evidenceOf(snap))) return null;
  if (["done", "attention"].includes(last.state) && evaluate(snap, task, { quiet: { since: 0 }, quietMs: 0 }).state !== last.state) return null;
  return last.state;
}

/**
 * Pure classification. `quiet` = { since } maintained by the caller across
 * consecutive complete snapshots; `lastChangeAt` likewise.
 */
export function evaluate(snap, task, { now = Date.now(), quiet = { since: null }, lastChangeAt = null, quietMs = DEFAULTS.quietMs, dropMs = DEFAULTS.dropMs, stallMs = DEFAULTS.stallMs } = {}) {
  const reasons = [];
  const busy = snap.bots.filter((b) => b.busy);
  const inflight = busy.length > 0 || snap.teamMap.queued.length > 0 || snap.teamMap.running.length > 0;
  const quietFor = !inflight && quiet.since !== null ? now - quiet.since : 0;
  const isQuiet = !inflight && quietFor >= quietMs;
  const base = { inflight, busy: busy.map((b) => b.name), quietFor, quiet: isQuiet };
  if (!snap.complete || !snap.lead) return { state: "running", unknown: true, reasons: ["incomplete snapshot", ...snap.incomplete], ...base };
  if (snap.pending.length) return { state: "needs-user", reasons: snap.pending.map((p) => `${p.botName ?? p.botId}: ${p.kind}${p.requestId ? ` ${p.requestId}` : ""}`), pending: snap.pending, ...base };
  if (snap.lead?.activity === "dead") return { state: "failed", reasons: ["the lead is dead"], ...base };
  if (!isQuiet) {
    if (snap.lead?.activity === "no-signal") return { state: "stalled", reasons: ["the lead sends no signal"], hint: 'interrupt, then send "status?"', ...base };
    if (lastChangeAt !== null && now - lastChangeAt > stallMs) return { state: "stalled", reasons: [`no change for ${Math.round((now - lastChangeAt) / 60000)} min`], hint: 'send "status?"', ...base };
    return { state: "running", reasons: inflight ? [busy.length ? `working: ${busy.map((b) => b.name).join(", ")}` : `delegations queued ${snap.teamMap.queued.length}, running ${snap.teamMap.running.length}`] : [`idle for ${Math.round(quietFor / 1000)} s, not yet settled`], ...base };
  }
  if (snap.dispatchFailed) return { state: "failed", reasons: ["the lead's turn failed to dispatch (error activity, no reply)"], ...base };
  const out = snap.outcomes.filter((o) => !leadAfter(snap, o)).at(-1) ?? null;
  const leadAt = snap.leadText?.at ?? 0;
  if (out) {
    const age = now - out.at;
    if (age > dropMs) return { state: "stalled", reasons: [`${out.kind} from ${out.name ?? "a teammate"} at ${new Date(out.at).toISOString()} is newer than the lead's last text`], hint: 'suspected unacknowledged delegation: send "status?"', ...base };
    return { state: "running", reasons: [`outcome from ${out.name ?? "a teammate"} awaits the lead's wake (${Math.round(age / 1000)} s)`], ...base };
  }
  const answered = snap.lastUser ? leadAfter(snap, snap.lastUser) : leadAt > (task?.sentAt ?? 0);
  if (snap.leadText && leadAt >= (task?.sentAt ?? 0) && answered) {
    if (snap.markerSeen && snap.markerSeen.id === snap.leadText.id && task?.tag && markerRe(task.tag).test(snap.leadText.text)) return { state: "done", reasons: ["the lead's last text carries the run marker"], ...base };
    return { state: "attention", reasons: ["settled without the run marker: the lead stopped early"], hint: "read the lead's last text; answer with send", ...base };
  }
  if (lastChangeAt !== null && now - lastChangeAt > stallMs) return { state: "stalled", reasons: [`no change for ${Math.round((now - lastChangeAt) / 60000)} min`], hint: 'send "status?"', ...base };
  return { state: "running", reasons: [snap.lastUser && leadAt < snap.lastUser.at ? "the lead has not answered the latest message yet" : "the lead has not spoken since the dispatch"], ...base };
}

export const EXIT_FOR = { done: 0, "needs-user": 5, attention: 5, stalled: 6, failed: 6, running: 4 };
export const TERMINAL = new Set(["done", "needs-user", "attention", "stalled", "failed"]);

const ago = (ms) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)}m` : `${(ms / 3_600_000).toFixed(1)}h`);

/** One phone-sized line. */
export function brief(ev, snap, task, now = Date.now()) {
  const slug = task?.slug ?? task?.title ?? "run";
  const lead = snap.lead?.name ?? "the lead";
  const elapsed = task?.sentAt ? ago(now - task.sentAt) : "";
  const say = snap.leadText ? `${lead} ${ago(now - snap.leadText.at)} ago: "${summarize(snap.leadText.text, 110)}"` : `${lead} has not spoken`;
  switch (ev.state) {
    case "done": return `${slug} · DONE after ${elapsed} · ${lead}: "${summarize(snap.leadText?.text ?? "", 120)}"`;
    case "needs-user": {
      const p = ev.pending?.[0];
      if (p?.kind === "card" && p.cardKind === "question") return `${slug} · NEEDS YOU · ${p.botName}: "${summarize(p.text, 100)}" → omb answer --message "…" --request ${p.requestId}`;
      if (p?.kind === "card" && p.cardKind === "approval") return `${slug} · APPROVAL · ${p.botName}: "${summarize(p.text, 100)}" (request ${p.requestId}) → omb answer --allow --request ${p.requestId}`;
      if (p?.kind === "waiting") return `${slug} · NEEDS YOU · ${p.botName} is waiting on you → read its chat`;
      return `${slug} · NEEDS YOU · ${p?.botName ?? lead} has a ${p?.kind ?? "request"} the driver cannot answer → open the app`;
    }
    case "attention": return `${slug} · ATTENTION · settled without the run marker · ${say} → read, then omb send "…"`;
    case "stalled": return `${slug} · STALLED · ${ev.reasons[0]} → ${ev.hint ?? 'omb send "status?"'}`;
    case "failed": return `${slug} · FAILED · ${ev.reasons[0]} → read the lead's chat`;
    default: return `${slug} · running ${elapsed} · ${ev.busy?.length ? `${ev.busy.join(", ")} working` : ev.reasons[0]} · outcomes ${snap.outcomes.length} · ${say}`;
  }
}
