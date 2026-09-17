// The snapshot (REST truth) and the pure evaluation of a run (design,
// "Snapshot and evaluation"). Upstream's classifiers are mirrored from
// scripts/mcp-server.ts:652-672; the busy set from server/store.ts:407-409.
import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "./http.mjs";

export const BUSY = new Set(["working", "waiting-on-you", "no-signal"]);
const HEALTH = new Set(["dead", "no-signal"]); // fleet-wide, not one run's work
export const ECHO_RE = /^@.+? replied to the delegated task/s; // server/index.ts:3387 (and :3358); names may contain spaces
export const DELEGATION_RE = /^Delegation to @(.+?) (completed without a text reply|failed|waiting|dropped|canceled|denied)/; // index.ts:3392-3401, delegations.ts:495
export const DEFAULTS = { quietMs: 30_000, dropMs: 2 * 60_000, stallMs: 40 * 60_000 };

// The chips a lead's own thread carries about its delegations. They name BOTS,
// never ids and never a source thread, so a run's open delegations can only be
// counted from its own lead thread, by name, between its dispatch and now.
const QUEUED_RE = /^Delegated to @(.+?)(?::\s|$)/; // delegations.ts:302
const ASK_CONVERTED_RE = /^@(.+?) is still working — ask converted to a delegation$/; // index.ts:7915
const SETTLED_RE = /^Delegation to @(.+?) (?:completed without a text reply|failed —|canceled|denied by user)/; // index.ts:3396-3399, delegations.ts:506, 535
const RETRY_RE = /^Delegation to @(.+?) waiting — /; // delegations.ts:491 — a retry; the delegation is still open
const START_FAILED_RE = /^error: delegation to @(.+?) could not start — /; // index.ts:3499
const FAILED_UNNAMED_RE = /^error: delegation failed — /; // delegations.ts:381
const DROPPED_RE = /^\d+ queued delegations? dropped — the turn did not finish$/; // delegations.ts:441
const REPLIED_RE = /^@(.+?) replied to the delegated task/s; // index.ts:3387

/**
 * How many delegations this run still waits on, counted from its lead thread's
 * chips since `sinceAt`. Ambiguity never settles anything: a settlement whose
 * target was never seen queued — a renamed bot, a chip older than the window —
 * leaves the count where it is and sets `unknown`, so a run with an open count
 * keeps reading as inflight rather than as finished.
 */
export function openDelegations(leadTail, sinceAt = null) {
  // A drop names a count, not its targets. Match each removal to a queue
  // preceding it; a named reply may revise which earlier item was dropped.
  // A scalar drop debt could otherwise consume a later batch's queue entry.
  const queues = []; const removals = []; const matches = [];
  let unknown = false; let overflow = null;
  const eligible = (q, r) => q < r.before && (r.name === null || queues[q] === r.name);
  const assign = (r, seen = new Set()) => {
    for (let q = 0; q < queues.length; q++) {
      if (seen.has(q) || !eligible(q, r)) continue;
      seen.add(q);
      if (!matches[q] || assign(matches[q], seen)) { matches[q] = r; return true; }
    }
    return false;
  };
  const possible = () => {
    // Moving an unmatched queue through an alternating path finds every
    // queue that could survive some valid assignment of the anonymous drops.
    const live = new Set(queues.map((_, q) => q).filter((q) => !matches[q]));
    const pending = [...live];
    for (let i = 0; i < pending.length; i++) {
      const free = pending[i];
      for (let q = 0; q < queues.length; q++) {
        if (live.has(q) || !matches[q] || !eligible(free, matches[q])) continue;
        live.add(q); pending.push(q);
      }
    }
    const counts = new Map();
    for (const q of live) counts.set(queues[q], (counts.get(queues[q]) ?? 0) + 1);
    return Object.fromEntries(counts);
  };
  const reserve = () => {
    if (!overflow && queues.length + removals.length >= 512) {
      // Bound the ambiguity search. In a pathological unbroken batch, keep
      // conservative ownership and an open count rather than invent closure.
      overflow = { counts: new Map(Object.entries(possible())), total: queues.length - removals.length };
      unknown = true;
    }
    return !overflow;
  };
  const open = (name) => {
    if (reserve()) queues.push(name);
    else { overflow.counts.set(name, (overflow.counts.get(name) ?? 0) + 1); overflow.total++; }
  };
  const remove = (name, count = 1) => {
    if (overflow) return;
    if (!Number.isSafeInteger(count) || count < 1 || count > queues.length - removals.length) { unknown = true; return; }
    for (let i = 0; i < count; i++) {
      if (!reserve()) return;
      const removal = { name, before: queues.length };
      if (assign(removal)) removals.push(removal); else { unknown = true; return; }
    }
    if (queues.length === removals.length) { queues.length = 0; removals.length = 0; matches.length = 0; }
    else if (name === null) unknown = true;
  };
  for (const m of leadTail ?? []) {
    if (sinceAt != null && typeof m.at === "number" && m.at < sinceAt) continue;
    if (m.kind === "activity" && typeof m.tool?.name === "string") {
      const chip = m.tool.name.trim();
      let x;
      if ((x = QUEUED_RE.exec(chip)) || (x = ASK_CONVERTED_RE.exec(chip))) open(x[1]);
      else if ((x = SETTLED_RE.exec(chip)) || (x = START_FAILED_RE.exec(chip))) remove(x[1]);
      // S: server/delegations.ts:408-442 drops only pending queue entries;
      // already-started work is acknowledged separately and can remain open.
      else if (DROPPED_RE.test(chip)) remove(null, Number.parseInt(chip, 10));
      else if (FAILED_UNNAMED_RE.test(chip)) unknown = true;
      else if (RETRY_RE.test(chip)) continue;
    } else if (m.role === "bot" && m.kind === "text" && m.from) {
      const x = REPLIED_RE.exec(m.text ?? "");
      if (x) remove(x[1]);
    }
  }
  return { byName: overflow ? Object.fromEntries(overflow.counts) : possible(), total: overflow?.total ?? queues.length - removals.length, unknown };
}

/**
 * When each delegation from this run was open, by target name: from the chip
 * that opened it to the settlement that closed it, `to` null while it is still
 * open. A turn on a thread two runs share can only be attributed inside one of
 * these, and `kind` says how to read the start: a `queued` delegation's turn
 * begins after its chip, while a `converted` one is an ask whose turn was
 * ALREADY running when the wait timed out (index.ts:7894-7917).
 */
export function delegationWindows(leadTail, sinceAt = null) {
  const out = {};
  const openFor = (name) => (out[name] ??= []).find((w) => w.to === null);
  for (const m of leadTail ?? []) {
    if (sinceAt != null && typeof m.at === "number" && m.at < sinceAt) continue;
    let name = null; let settles = false; let kind = "queued";
    if (m.kind === "activity" && typeof m.tool?.name === "string") {
      const chip = m.tool.name.trim();
      let x;
      if ((x = QUEUED_RE.exec(chip))) name = x[1];
      else if ((x = ASK_CONVERTED_RE.exec(chip))) { name = x[1]; kind = "converted"; }
      else if ((x = SETTLED_RE.exec(chip)) || (x = START_FAILED_RE.exec(chip))) { name = x[1]; settles = true; }
      else if (DROPPED_RE.test(chip)) {
        // The drop names no targets, so these windows cannot prove ownership
        // of later shared-thread turns. openDelegations independently keeps
        // the possible work still awaiting a reply.
        for (const list of Object.values(out)) for (const w of list) if (w.to === null) w.to = m.at;
        continue;
      }
    } else if (m.role === "bot" && m.kind === "text" && m.from) {
      const x = REPLIED_RE.exec(m.text ?? "");
      if (x) { name = x[1]; settles = true; }
    }
    if (!name) continue;
    if (!settles) { (out[name] ??= []).push({ from: m.at, to: null, kind }); continue; }
    const live = openFor(name);
    if (live) live.to = m.at;
  }
  return out;
}

/**
 * Which lead thread is running the turn, when the runtime log says so. A bot is
 * busy as a whole (store.ts:407-409); the log is the only place that names the
 * thread, and a turn may be pinned to a thread that is not the active one
 * (index.ts:3225-3233). Null unless exactly one candidate has an unfinished
 * turn, because a guess here would hand one run another run's work.
 */
export async function executingThread(dataDir, threadIds, { deadline = performance.now() + 5_000, signal } = {}) {
  if (!dataDir) return null;
  const open = [];
  for (const threadId of threadIds) {
    if (!threadId || outOfBudget(deadline, signal)) return null;
    let text;
    try { text = await withinDeadline((opts) => fs.readFile(path.join(dataDir, "events", `${threadId}.ndjson`), { encoding: "utf8", signal: opts.signal }), deadline, signal); }
    catch { return null; }
    const live = new Set();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let e; try { e = JSON.parse(line); } catch { return null; }
      // S: server/harness/bus.ts:14-15,42-75: missing durable events cannot
      // prove that another thread has no unfinished turn.
      if (e.type === "runtime.error" && /Canonical event history is incomplete/.test(e.message ?? "")) return null;
      if (!e.turnId) continue;
      if (e.type === "turn.started") live.add(e.turnId);
      else if (e.type === "turn.completed") live.delete(e.turnId);
    }
    if (live.size) open.push(threadId);
  }
  return open.length === 1 ? open[0] : null;
}

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

/** Is the observation budget spent? Millisecond timeouts are whole numbers, so
 * less than one millisecond left is already too little to spend on a request.
 * Every caller that guards a `withinDeadline` must ask this same question:
 * a guard that compared raw times instead let the sub-millisecond window
 * through, and the rejection escaped `watch` as exit 1 rather than a timeout. */
export const outOfBudget = (deadline, signal) => Math.floor(deadline - performance.now()) <= 0 || Boolean(signal?.aborted);

/** A single monotonic budget covers REST, pagination, and local receipt reads. */
export async function withinDeadline(fn, deadline, signal) {
  if (outOfBudget(deadline, signal)) throw new Error("observation deadline reached");
  const remaining = Math.floor(deadline - performance.now());
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

/** How a pending request is remembered: its request id, else the message it came on. */
export const cardKeyOf = (p) => p.requestId ?? p.messageId ?? `${p.kind}:${p.botId}`;

/** Real option cards have no kind: skill/routine requests precede tool approval.
 * The full JSON metadata is actionable; only brief() shortens human text. */
export function pendingMessage(m, { threadId, botId, botName }) {
  const card = m.card;
  const cardKind = card ? card.skillRequest ? "skill" : card.routineRequest ? "routine" : card.tool ? "approval" : "question" : null;
  return {
    threadId, botId, botName, at: m.at, kind: card ? "card" : m.connector ? "connector" : "secret",
    requestId: card?.requestId ?? null, cardKind, messageId: m.id,
    // How `answer --request` names it: a card has a request id, a connection
    // or credential card has only the message it arrived on (store.ts:69-99).
    handle: card?.requestId ?? m.id,
    // A connection request puts its copy on the payload and leaves the
    // transcript text empty (index.ts:8383-8395).
    text: m.text || card?.subtitle || card?.title || m.connector?.description || m.secret?.description || "",
    ...(card ? { card, title: card.title, subtitle: card.subtitle, options: card.options, tool: card.tool, held: card.held, approvalScope: card.approvalScope, allowKey: card.allowKey, skillRequest: card.skillRequest, routineRequest: card.routineRequest } : {}),
    ...(m.connector ? { connector: m.connector } : {}), ...(m.secret ? { secret: m.secret } : {}),
  };
}

/**
 * Gather REST truth once and cut it into one view per run (design,
 * "Attribution"). Every view has the shape a single run always had — the
 * caller that passes `task` gets that view back directly — with the lead
 * thread, outcomes, busy bots, delegations and cards that belong to that run.
 * Failed or deadline-cutoff reads produce incomplete truth for every view.
 */
export async function snapshot(client, state, { dataDir = null, runtimeTrusted = true, now = Date.now(), deadline = performance.now() + 15_000, signal } = {}) {
  const team = state.team; const leadId = team.lead.id;
  const single = state.task ?? null;
  const runs = [...(state.runs ?? (single ? [single] : []))].filter(Boolean);
  if (single && !runs.some((r) => r.runId === single.runId)) runs.unshift(single);
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
  // Every thread worth reading: each run's own, and each bot's current one for
  // the bots no run pins. Ownership is decided per view, from one set of reads.
  const threadOwners = new Map();
  const requiredThreads = new Set([...runs.flatMap((r) => [...Object.values(r.threads ?? {}), r.leadThreadId]), ...bots.map((b) => b.threadId)].filter(Boolean));
  for (const run of runs) for (const [botId, threadId] of Object.entries(run.threads ?? {})) if (threadId) threadOwners.set(threadId, botId);
  // Closing a run does not settle the requests it observed. Its history is
  // still provenance, although it no longer contributes work claims.
  const ownershipRuns = [...runs, ...(state.history ?? [])];
  const rememberedCards = ownershipRuns.flatMap((r) => [...Object.values(r.cards ?? {}), ...Object.values(r.lastEval?.cardOwners ?? {})]);
  const rememberedThreads = new Set();
  // A helper leaving this section does not settle a request already observed
  // on its thread. Card provenance outlives current fleet membership.
  for (const card of rememberedCards) if (card?.threadId && card.botId) {
    threadOwners.set(card.threadId, card.botId); rememberedThreads.add(card.threadId);
  }
  // Legacy boolean owners contain no thread identity. Read the team's task
  // lists as well before concluding that one of those cards has settled.
  if (rememberedCards.some((c) => c === true)) for (const bot of fleet?.bots ?? []) {
    if (ids.has(bot.id)) for (const task of bot.tasks ?? []) if (task.threadId) {
      threadOwners.set(task.threadId, bot.id); rememberedThreads.add(task.threadId);
    }
  }
  for (const bot of bots) if (bot.threadId && !threadOwners.has(bot.threadId)) threadOwners.set(bot.threadId, bot.id);
  for (const run of runs) {
    if (run.leadThreadId) threadOwners.set(run.leadThreadId, leadId);
    else incomplete.push("lead thread is missing");
  }
  if (!runs.length) {
    if (lead?.threadId) threadOwners.set(lead.threadId, leadId);
    else incomplete.push("lead thread is missing");
  }
  const stamps = runs.map((r) => r.sentAt).filter((v) => typeof v === "number");
  const sentAt = stamps.length ? Math.min(...stamps) : null;
  // A connection whose account is live no longer needs the user, so it is not
  // pending — but until its bot has been resumed it is still the one thing
  // `answer --resume` acts on, and its siblings decide whether that resume is
  // allowed (index.ts:6687-6697). Keep it beside the pending set, out of the
  // evaluation, so a request id can still reach it.
  const pendingAll = []; const resumableAll = []; const tails = new Map(); const seenCards = new Set(); let failedTails = 0;
  await Promise.all([...threadOwners].map(async ([threadId, botId]) => {
    const tail = await get(`thread ${threadId}`, async () => {
      try { return await readTail(client, threadId, { sentAt: rememberedThreads.has(threadId) ? null : sentAt, deadline, signal }); }
      catch (e) {
        // Deleting an old task deletes its requests too. Only that positive
        // absence retires historical provenance; current run reads must work.
        // S: server/index.ts:8641-8643,11149-11166; store.ts:1656-1667.
        if (!requiredThreads.has(threadId) && e instanceof HttpError && e.status === 404 && e.body?.error === "no such conversation") return [];
        throw e;
      }
    });
    if (!tail) { failedTails++; return; }
    tails.set(threadId, tail);
    const botName = bots.find((b) => b.id === botId)?.name ?? null;
    for (const m of tail) {
      if (m.card || m.connector || m.secret) seenCards.add(cardKeyOf(pendingMessage(m, { threadId, botId, botName })));
      if (messageNeedsInput(m)) pendingAll.push(pendingMessage(m, { threadId, botId, botName }));
      else if (m.connector && m.connector.status === "connected" && !m.connector.resumed && !m.connector.dismissed) resumableAll.push(pendingMessage(m, { threadId, botId, botName }));
    }
  }));
  for (const run of ownershipRuns) for (const [key, card] of Object.entries(run.cards ?? {})) {
    if (card === true && !seenCards.has(key) && !bots.some((bot) => key === `waiting:${bot.id}`)) incomplete.push(`remembered request ${key} has no recorded thread and was not observed`);
  }
  for (const b of bots) if (b.activity === "waiting-on-you" && !pendingAll.some((p) => p.botId === b.id)) pendingAll.push({ threadId: b.threadId, botId: b.id, botName: b.name, kind: "waiting", requestId: null, cardKind: null, text: `${b.name} is waiting on you` });
  const receipts = await get("receipts", () => readReceipts(dataDir, { deadline, signal }));
  // Optional evidence: a missing or unreadable runtime log is not incomplete
  // truth, it only means the busy lead cannot be placed on one run's thread.
  let executing = null;
  if (runs.length > 1 && runtimeTrusted && !runs.some((r) => r.lastEval?.runtimeUntrusted)) { try { executing = await executingThread(dataDir, runs.map((r) => r.leadThreadId), { deadline, signal }); } catch { executing = null; } }
  const dels = new Map(runs.map((r) => [r.runId, openDelegations(tails.get(r.leadThreadId) ?? [], r.sentAt ?? null)]));
  const unresolvedTarget = (run) => Object.keys(dels.get(run.runId)?.byName ?? {}).some((name) => !bots.some((b) => b.name === name));

  // A bot this run cannot claim contributes no work state to its evidence: its
  // turns starting and finishing are the other run's business. Only the
  // fleet-wide health states stay, because a dead or silent bot is everyone's.
  const scopedState = (bot, run) => {
    const ours = attributable(bot, run);
    if (run && bot.id === leadId) return { ...bot, threadId: run.leadThreadId, busy: ours && bot.busy, activity: ours || HEALTH.has(bot.activity) ? bot.activity : "idle" };
    if (!ours) return { ...bot, busy: false, activity: HEALTH.has(bot.activity) ? bot.activity : null, threadId: null };
    // The lead's active task can be another run's even while our turn is
    // pinned here. Switching that active task is not progress on this run.
    return bot;
  };

  /** Might this run be waiting on this bot? Ours when a chip or the dispatch says
   * so; another run's when only its chips or its claim say so; otherwise every
   * open run has to keep waiting — ambiguity never hands one run exclusive
   * ownership, and never lets the others call themselves finished. */
  const attributable = (bot, run) => {
    if (!bot) return false;
    if (!run || runs.length < 2) return true;
    if (bot.id === leadId) return executing === null || executing === run.leadThreadId;
    if (unresolvedTarget(run) || (dels.get(run.runId)?.byName[bot.name] ?? 0) > 0 || run.implementer?.id === bot.id) return true;
    const others = runs.filter((r) => r.runId !== run.runId);
    const elsewhere = others.some((r) => (dels.get(r.runId)?.byName[bot.name] ?? 0) > 0 || r.implementer?.id === bot.id);
    return !elsewhere;
  };
  /** Who owns a pending request: whoever saw it first, else the run whose lead
   * thread it is on or whose delegate raised it. None or several is shared. */
  const ownersOf = (p) => {
    const key = cardKeyOf(p);
    const seenOwners = new Set(ownershipRuns.flatMap((r) => r.lastEval?.cardOwners?.[key]?.owners ?? []));
    for (const r of ownershipRuns) if (r.cards?.[key]) seenOwners.add(r.runId);
    if (seenOwners.size) return [...seenOwners].map((runId) => ({ runId }));
    // Reading an older owner's thread may reveal requests nobody observed.
    // A later dispatch cannot be their origin, even if it now holds the bot.
    const candidates = runs.filter((r) => r.sentAt == null || p.at == null || p.at >= r.sentAt);
    const direct = candidates.filter((r) => p.threadId === r.leadThreadId || (dels.get(r.runId)?.byName[p.botName] ?? 0) > 0 || r.implementer?.id === p.botId);
    const possible = candidates.filter((r) => p.botId !== leadId && unresolvedTarget(r) && !direct.includes(r));
    const owners = [...direct, ...possible];
    // An unresolved name supplies possible owners, never an exclusive claim.
    owners.uncertain = possible.length > 0;
    return owners;
  };
  const pendingOwners = new Map([...pendingAll, ...resumableAll].map((p) => [cardKeyOf(p), ownersOf(p)]));
  const cardsByRun = Object.fromEntries(runs.map((r) => [r.runId, {}]));
  const cardOwners = {};
  for (const p of pendingAll) {
    const key = cardKeyOf(p); const owners = pendingOwners.get(key);
    if (owners.length !== 1 || owners.uncertain) continue;
    const location = { threadId: p.threadId, botId: p.botId };
    if (cardsByRun[owners[0].runId]) cardsByRun[owners[0].runId][key] = location;
    cardOwners[key] = { ...location, owners: [owners[0].runId] };
  }

  const view = (run) => {
    const leadThreadId = run?.leadThreadId ?? lead?.threadId ?? null;
    const msgs = ((leadThreadId ? tails.get(leadThreadId) : null) ?? []).filter((m) => run?.sentAt == null || typeof m.at !== "number" || m.at >= run.sentAt);
    const leadTexts = msgs.filter((m) => isLeadText(m, leadId));
    const lastLead = leadTexts.at(-1); const latestUser = msgs.findLast((m) => m.role === "user");
    const observedOutcomes = [];
    for (const m of msgs) {
      if (isEcho(m, leadId)) observedOutcomes.push({ id: m.id, at: m.at, kind: "echo", name: m.from?.name ?? null, text: m.text, ok: true });
      else if (m.kind === "activity" && typeof m.tool?.name === "string") { const d = DELEGATION_RE.exec(m.tool.name); if (d) observedOutcomes.push({ id: m.id, at: m.at, kind: "delegation", name: d[1], variant: d[2], text: m.text ?? null, tool: m.tool, ok: m.tool.ok === true }); }
    }
    let receiptsForRun = null;
    if (receipts && leadThreadId) {
      receiptsForRun = receipts.filter((r) => r.sourceThreadId === leadThreadId && (run?.sentAt == null || r.finishedAt >= run.sentAt));
      for (const r of receiptsForRun) observedOutcomes.push({ ...r, id: `receipt:${r.id}`, at: r.finishedAt, kind: "receipt", name: r.toBotName ?? null, status: r.status ?? null, ok: r.status === "completed" });
    }
    const del = dels.get(run?.runId) ?? openDelegations(msgs, run?.sentAt ?? null);
    const scoped = bots.map((b) => scopedState(b, run));
    const pending = []; const claims = [];
    for (const p of pendingAll) {
      const owners = run ? pendingOwners.get(cardKeyOf(p)) : [null];
      if (!run) { pending.push(p); continue; }
      if (owners.length !== 1 || owners.uncertain || !cardsByRun[owners[0].runId]) { pending.push({ ...p, shared: true }); continue; }
      if (owners[0].runId !== run.runId) continue;
      pending.push({ ...p, shared: false, run: run.runId });
      if (!run.cards?.[cardKeyOf(p)]) claims.push(cardKeyOf(p));
    }
    // A resumable connection stays visible to every view: its siblings may
    // belong to another run and a resume needs all of them, so ownership only
    // decides whether it can be picked without `--request`.
    const resumable = resumableAll.map((p) => {
      if (!run) return p;
      const owners = pendingOwners.get(cardKeyOf(p));
      const mine = owners.length === 1 && !owners.uncertain && owners[0].runId === run.runId;
      return { ...p, shared: !mine, ...(mine ? { run: run.runId } : {}) };
    });
    const runThreads = run
      ? [...new Set([...Object.values(run.threads ?? {}), leadThreadId].filter(Boolean))].map((threadId) => ({ threadId, botId: threadOwners.get(threadId) ?? null }))
      : [...threadOwners].map(([threadId, botId]) => ({ threadId, botId }));
    return {
      at: now, complete: incomplete.length === 0, incomplete,
      bots: scoped, lead: scoped.find((b) => b.id === leadId) ?? null,
      teamMap: { queued: tm.queued.filter((q) => attributable(bots.find((b) => b.id === q.targetBotId), run)), running: tm.running.filter((r) => attributable(bots.find((b) => b.id === r.targetBotId), run)) },
      leadThreadId, runThreads, leadTail: msgs, executing,
      // Whose work counts for this run right now, by the same rule the busy
      // flags above were masked with. A watch needs the set, not the reasons.
      attributedBots: bots.filter((b) => attributable(b, run)).map((b) => b.id),
      // The stream must also cover current/discovered threads and remembered
      // cards on bots whose work now belongs to another run. These observation
      // inputs are separate from run evidence: foreign task switches are not
      // this run's progress.
      observedBots: bots, observedThreads: [...threadOwners.keys()],
      attributedThreads: [...new Set([leadThreadId, ...[...threadOwners].filter(([, botId]) => botId !== leadId && attributable(bots.find((b) => b.id === botId), run)).map(([id]) => id), ...pending.map((p) => p.threadId)].filter(Boolean))],
      cardsByRun, cardOwners,
      leadText: lastLead ? { id: lastLead.id, at: lastLead.at, text: lastLead.text } : null,
      lastUser: latestUser ? { id: latestUser.id, at: latestUser.at, text: latestUser.text } : null,
      outcomes: mergeOutcomes(run?.lastEval?.outcomes, observedOutcomes),
      pending, resumable, claims, openDelegations: del,
      markerSeen: run?.tag ? leadTexts.filter((m) => markerRe(run.tag).test(m.text)).map((m) => ({ id: m.id, at: m.at })).at(-1) ?? null : null,
      dispatchFailed: dispatchFailedAfterLatestUser(msgs),
      receipts: { supported: receipts !== null, forRun: receiptsForRun?.length ?? null }, truncatedTails: failedTails,
    };
  };

  if (performance.now() >= deadline || signal?.aborted) incomplete.push("observation deadline reached");
  // A caller that names one run gets that run's view, whether or not it also
  // handed over the other open runs for the ownership decisions above.
  if (single) return view(single);
  // No run at all is the team's own view: the lead's current thread, every bot.
  if (!state.runs || !runs.length) return view(null);
  return {
    at: now, complete: incomplete.length === 0, incomplete, bots, lead, teamMap: tm, executing,
    runThreads: [...threadOwners].map(([threadId, botId]) => ({ threadId, botId })), truncatedTails: failedTails,
    receipts: { supported: receipts !== null, forRun: null },
    views: Object.fromEntries(runs.map((r) => [r.runId, view(r)])),
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
  return canonical({ version: 2, complete: snap.complete, leadThreadId: snap.leadThreadId, lead: snap.lead, leadText: snap.leadText, lastUser: snap.lastUser, markerSeen: snap.markerSeen, openDelegations: snap.openDelegations ?? null,
    leadOrder: (snap.leadTail ?? []).filter((m) => m.id === snap.leadText?.id || m.id === snap.lastUser?.id || snap.outcomes.some((o) => o.id === m.id)).map((m) => m.id),
    outcomes: ordered(mergeOutcomes(snap.outcomes)), pending: ordered(snap.pending), bots: ordered(snap.bots), teamMap: { queued: ordered(snap.teamMap.queued), running: ordered(snap.teamMap.running) }, dispatchFailed: snap.dispatchFailed });
}

export function carriedVerdict(snap, task) {
  const last = task?.lastEval;
  if (!last?.evidence || !["done", "attention", "stalled", "failed"].includes(last.state)) return null;
  // The busy flags are already this run's (another run's working bot reads as
  // idle here), so trust them rather than the whole-fleet activity string.
  if (!snap.complete || !snap.lead || snap.pending.length || snap.bots.some((b) => b.busy) || snap.teamMap.queued.length || snap.teamMap.running.length || (snap.openDelegations?.total ?? 0) > 0) return null;
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
  const openDel = snap.openDelegations?.total ?? 0;
  const inflight = busy.length > 0 || snap.teamMap.queued.length > 0 || snap.teamMap.running.length > 0 || openDel > 0;
  const quietFor = !inflight && quiet.since !== null ? now - quiet.since : 0;
  const isQuiet = !inflight && quietFor >= quietMs;
  const base = { inflight, busy: busy.map((b) => b.name), quietFor, quiet: isQuiet };
  if (!snap.complete || !snap.lead) return { state: "running", unknown: true, reasons: ["incomplete snapshot", ...snap.incomplete], ...base };
  if (snap.pending.length) return { state: "needs-user", reasons: snap.pending.map((p) => `${p.botName ?? p.botId}: ${p.kind}${p.requestId ? ` ${p.requestId}` : ""}`), pending: snap.pending, ...base };
  if (snap.lead?.activity === "dead") return { state: "failed", reasons: ["the lead is dead"], ...base };
  if (!isQuiet) {
    if (snap.lead?.activity === "no-signal") return { state: "stalled", reasons: ["the lead sends no signal"], hint: 'interrupt, then send "status?"', ...base };
    if (lastChangeAt !== null && now - lastChangeAt > stallMs) return { state: "stalled", reasons: [`no change for ${Math.round((now - lastChangeAt) / 60000)} min`], hint: 'send "status?"', ...base };
    const working = busy.length ? `working: ${busy.map((b) => b.name).join(", ")}`
      : snap.teamMap.queued.length || snap.teamMap.running.length ? `delegations queued ${snap.teamMap.queued.length}, running ${snap.teamMap.running.length}`
      : `${openDel} delegation(s) open: ${Object.entries(snap.openDelegations?.byName ?? {}).map(([n, c]) => (c > 1 ? `${n} x${c}` : n)).join(", ")}`;
    return { state: "running", reasons: inflight ? [working] : [`idle for ${Math.round(quietFor / 1000)} s, not yet settled`], ...base };
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
      const id = p?.handle ?? p?.requestId ?? p?.messageId;
      if (p?.kind === "card" && p.cardKind === "question") return `${slug} · NEEDS YOU · ${p.botName}: "${summarize(p.text, 100)}" → omb answer --message "…" --request ${id}`;
      if (p?.kind === "card" && p.cardKind === "approval") return `${slug} · APPROVAL · ${p.botName}: "${summarize(p.text, 100)}" (request ${id}) → omb answer --allow --request ${id}`;
      // A skill is approved by its hash, so the line carries the hash and
      // never the preview: the preview is read to the user from `pending[]`.
      if (p?.kind === "card" && p.cardKind === "skill") return `${slug} · SKILL · ${p.botName}: ${summarize(p.title, 80)} sha256 ${String(p.skillRequest?.sha256 ?? "").slice(0, 8)}… → omb answer --allow --reviewed ${p.skillRequest?.sha256} --request ${id} | --deny`;
      if (p?.kind === "card" && p.cardKind === "routine") return `${slug} · ROUTINE · ${p.botName}: ${summarize(p.title, 100)} → omb answer --confirm --request ${id} | --cancel`;
      // Once the link has been handed over the card reads `authorizing`, and
      // what is missing is the status read that refreshes it and resumes the
      // bot (index.ts:12255-12276) — not another trip to the provider.
      if (p?.kind === "connector") return `${slug} · CONNECT · ${p.botName} needs ${p.connector?.label ?? p.connector?.slug}${p.connector?.alias ? ` (${p.connector.alias})` : ""} (${p.connector?.status}) → omb answer ${["authorizing", "connected"].includes(p.connector?.status) ? "--resume" : "--connect"} --request ${id}`;
      // The value is named, never shown: it reaches the driver through the
      // environment or stdin, so the line says where to put it.
      if (p?.kind === "secret") return `${slug} · CREDENTIAL · ${p.botName} needs the ${p.secret?.label ?? p.secret?.target} → OMB_SECRET=… omb answer --provide --request ${id} | --dismiss`;
      if (p?.kind === "waiting") return `${slug} · NEEDS YOU · ${p.botName} is waiting on you → read its chat`;
      return `${slug} · NEEDS YOU · ${p?.botName ?? lead} has a ${p?.kind ?? "request"} the driver cannot answer → open the app`;
    }
    case "attention": return `${slug} · ATTENTION · settled without the run marker · ${say} → read, then omb send "…"`;
    case "stalled": return `${slug} · STALLED · ${ev.reasons[0]} → ${ev.hint ?? 'omb send "status?"'}`;
    case "failed": return `${slug} · FAILED · ${ev.reasons[0]} → read the lead's chat`;
    default: return `${slug} · running ${elapsed} · ${ev.busy?.length ? `${ev.busy.join(", ")} working` : ev.reasons[0]} · outcomes ${snap.outcomes.length} · ${say}`;
  }
}
