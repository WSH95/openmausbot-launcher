// The snapshot (REST truth) and the pure evaluation of a run (design,
// "Snapshot and evaluation"). Upstream's classifiers are mirrored from
// scripts/mcp-server.ts:652-672; the busy set from server/store.ts:407-409.
import fs from "node:fs";
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

export function readReceipts(dataDir) {
  if (!dataDir) return null;
  try { const list = JSON.parse(fs.readFileSync(path.join(dataDir, "delegation-receipts.json"), "utf8")); return Array.isArray(list) ? list : null; } catch { return null; }
}

/** Page a thread backwards until `enough(messages)` or nothing is left. Oldest first. */
async function readTail(client, threadId, { limit, enough, maxPages = 10 }) {
  let all = []; let before = null; let pages = 0;
  for (;;) {
    const page = await client.get(`/api/threads/${threadId}/messages?limit=${limit}${before ? `&before=${before}` : ""}`);
    const msgs = page.messages ?? [];
    all = [...msgs, ...all];
    pages++;
    if (!page.hasMore || !msgs.length || pages >= maxPages || enough(all)) return { messages: all, truncated: Boolean(page.hasMore) && !enough(all) };
    before = msgs[0].id;
  }
}

/** Gather REST truth for the team and the current run. Never throws for a single failed read: marks the snapshot incomplete. */
export async function snapshot(client, state, { dataDir = null, now = Date.now() } = {}) {
  const team = state.team; const task = state.task;
  const leadId = team.lead.id;
  const incomplete = [];
  const get = async (label, fn) => { try { return await fn(); } catch (e) { incomplete.push(`${label}: ${e.message}`); return null; } };
  const [fleet, teamMap] = await Promise.all([get("bots", () => client.get("/api/bots?messages=0")), get("team-map", () => client.get("/api/team-map"))]);
  const known = new Map(team.bots.map((b) => [b.id, b]));
  const bots = [];
  if (fleet?.bots) {
    for (const b of fleet.bots) {
      if (b.hidden) continue;
      if (known.has(b.id) || (team.section && b.section === team.section)) {
        const k = known.get(b.id);
        bots.push({ id: b.id, name: b.name, key: k?.key ?? null, title: b.title ?? k?.title ?? null, busy: Boolean(b.busy) || BUSY.has(b.activity), activity: b.activity ?? (b.busy ? "working" : "idle"), threadId: b.threadId, discovered: !known.has(b.id) });
      }
    }
    for (const b of team.bots) if (!bots.some((x) => x.id === b.id)) incomplete.push(`bot ${b.name} is missing from the fleet`);
  }
  const ids = new Set(bots.map((b) => b.id));
  const lead = bots.find((b) => b.id === leadId) ?? null;
  const tm = { queued: (teamMap?.queued ?? []).filter((q) => ids.has(q.sourceBotId) && ids.has(q.targetBotId)), running: (teamMap?.running ?? []).filter((r) => ids.has(r.sourceBotId) && ids.has(r.targetBotId)) };
  const leadThreadId = task?.leadThreadId ?? lead?.threadId ?? null;
  const runThreads = task?.threads ? Object.entries(task.threads).map(([botId, threadId]) => ({ botId, threadId })) : bots.map((b) => ({ botId: b.id, threadId: b.threadId }));
  const pending = [];
  let leadTail = { messages: [], truncated: false };
  const tails = await Promise.all(runThreads.map(async ({ botId, threadId }) => {
    if (!threadId) return null;
    const isLead = botId === leadId;
    const enough = isLead
      ? (msgs) => msgs.some((m) => isLeadText(m, leadId)) && (msgs.some((m) => m.role === "user") || !task)
      : () => true;
    const tail = await get(`thread ${threadId}`, () => readTail(client, threadId, { limit: isLead ? 20 : 10, enough }));
    if (!tail) return null;
    const bot = bots.find((b) => b.id === botId);
    for (const m of tail.messages) {
      if (!messageNeedsInput(m)) continue;
      pending.push({ threadId, botId, botName: bot?.name ?? null, kind: m.card ? "card" : m.connector ? "connector" : "secret", requestId: m.card?.requestId ?? null, cardKind: m.card?.kind ?? null, text: summarize(m.text ?? m.card?.subtitle ?? ""), messageId: m.id });
    }
    if (isLead) leadTail = tail;
    return tail;
  }));
  for (const b of bots) if (b.activity === "waiting-on-you" && !pending.some((p) => p.botId === b.id)) pending.push({ threadId: b.threadId, botId: b.id, botName: b.name, kind: "waiting", requestId: null, cardKind: null, text: `${b.name} is waiting on you` });
  const msgs = leadTail.messages;
  const leadTexts = msgs.filter((m) => isLeadText(m, leadId));
  const leadText = leadTexts.at(-1) ? { id: leadTexts.at(-1).id, at: leadTexts.at(-1).at, text: leadTexts.at(-1).text } : null;
  const users = msgs.filter((m) => m.role === "user");
  const lastUser = users.at(-1) ? { id: users.at(-1).id, at: users.at(-1).at, text: users.at(-1).text } : null;
  const outcomes = [];
  for (const m of msgs) {
    if (isEcho(m, leadId)) outcomes.push({ id: m.id, at: m.at, kind: "echo", name: m.from?.name ?? null, ok: true });
    else if (m.kind === "activity" && typeof m.tool?.name === "string") { const d = DELEGATION_RE.exec(m.tool.name); if (d) outcomes.push({ id: m.id, at: m.at, kind: "delegation", name: d[1], variant: d[2], ok: m.tool.ok === true }); }
  }
  const receipts = readReceipts(dataDir);
  let receiptsForRun = null;
  if (receipts && leadThreadId) {
    receiptsForRun = receipts.filter((r) => r.sourceThreadId === leadThreadId && (!task?.sentAt || r.finishedAt >= task.sentAt));
    for (const r of receiptsForRun) outcomes.push({ id: `receipt:${r.id}`, at: r.finishedAt, kind: "receipt", name: r.toBotName ?? null, status: r.status ?? null, ok: r.status === "completed" });
  }
  outcomes.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const markerSeen = task?.tag ? leadTexts.filter((m) => markerRe(task.tag).test(m.text)).map((m) => ({ id: m.id, at: m.at })).at(-1) ?? null : null;
  const tailWarnings = tails.filter((t) => t?.truncated).length;
  return {
    at: now, complete: incomplete.length === 0 && Boolean(fleet) && Boolean(teamMap) && Boolean(lead), incomplete,
    bots, lead, teamMap: tm, leadThreadId, leadTail: msgs, leadText, lastUser, outcomes, pending, markerSeen,
    dispatchFailed: dispatchFailedAfterLatestUser(msgs), receipts: { supported: receipts !== null, forRun: receiptsForRun?.length ?? null }, truncatedTails: tailWarnings,
  };
}

/** Which outcomes are newer than the lead's last own text. */
const newestOutcome = (snap) => snap.outcomes.at(-1) ?? null;

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
  if (!snap.complete) return { state: "running", unknown: true, reasons: ["incomplete snapshot", ...snap.incomplete], ...base };
  if (snap.pending.length) return { state: "needs-user", reasons: snap.pending.map((p) => `${p.botName ?? p.botId}: ${p.kind}${p.requestId ? ` ${p.requestId}` : ""}`), pending: snap.pending, ...base };
  if (snap.lead?.activity === "dead") return { state: "failed", reasons: ["the lead is dead"], ...base };
  if (!isQuiet) {
    if (snap.lead?.activity === "no-signal") return { state: "stalled", reasons: ["the lead sends no signal"], hint: 'interrupt, then send "status?"', ...base };
    if (lastChangeAt !== null && now - lastChangeAt > stallMs) return { state: "stalled", reasons: [`no change for ${Math.round((now - lastChangeAt) / 60000)} min`], hint: 'send "status?"', ...base };
    return { state: "running", reasons: inflight ? [busy.length ? `working: ${busy.map((b) => b.name).join(", ")}` : `delegations queued ${snap.teamMap.queued.length}, running ${snap.teamMap.running.length}`] : [`idle for ${Math.round(quietFor / 1000)} s, not yet settled`], ...base };
  }
  if (snap.dispatchFailed) return { state: "failed", reasons: ["the lead's turn failed to dispatch (error activity, no reply)"], ...base };
  const out = newestOutcome(snap);
  const leadAt = snap.leadText?.at ?? 0;
  if (out && out.at >= leadAt) {
    const age = now - out.at;
    if (age > dropMs) return { state: "stalled", reasons: [`${out.kind} from ${out.name ?? "a teammate"} at ${new Date(out.at).toISOString()} is newer than the lead's last text`], hint: 'suspected unacknowledged delegation: send "status?"', ...base };
    return { state: "running", reasons: [`outcome from ${out.name ?? "a teammate"} awaits the lead's wake (${Math.round(age / 1000)} s)`], ...base };
  }
  const answered = snap.lastUser ? leadAt > snap.lastUser.at : leadAt > (task?.sentAt ?? 0);
  if (snap.leadText && leadAt >= (task?.sentAt ?? 0) && answered) {
    if (snap.markerSeen && snap.markerSeen.id === snap.leadText.id) return { state: "done", reasons: ["the lead's last text carries the run marker"], ...base };
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
      if (p?.kind === "card") return `${slug} · APPROVAL · ${p.botName}: "${summarize(p.text, 100)}" (request ${p.requestId}) → omb answer --allow --request ${p.requestId}`;
      if (p?.kind === "waiting") return `${slug} · NEEDS YOU · ${p.botName} is waiting on you → read its chat`;
      return `${slug} · NEEDS YOU · ${p?.botName ?? lead} has a ${p?.kind ?? "request"} the driver cannot answer → open the app`;
    }
    case "attention": return `${slug} · ATTENTION · settled without the run marker · ${say} → read, then omb send "…"`;
    case "stalled": return `${slug} · STALLED · ${ev.reasons[0]} → ${ev.hint ?? 'omb send "status?"'}`;
    case "failed": return `${slug} · FAILED · ${ev.reasons[0]} → read the lead's chat`;
    default: return `${slug} · running ${elapsed} · ${ev.busy?.length ? `${ev.busy.join(", ")} working` : ev.reasons[0]} · outcomes ${snap.outcomes.length} · ${say}`;
  }
}
