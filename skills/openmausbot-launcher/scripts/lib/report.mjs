// Post-run forensics from the data dir and the repository, the record-step
// verification, the 0.4.2 pack checks, and the evidence section
// (design: the report row and "Real run = the 0.4.2 pack validation").
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { git } from "./git.mjs";

export function readNdjson(file) {
  let text; try { text = fs.readFileSync(file, "utf8"); } catch { return null; }
  const out = [];
  for (const line of text.split("\n")) { if (!line.trim()) continue; try { out.push(JSON.parse(line)); } catch {} }
  return out;
}

/** Turns and token usage from a thread's runtime events since `sinceMs`. */
export function turnsFromEvents(events, sinceMs = 0) {
  const turns = new Map();
  for (const e of events ?? []) {
    const at = Date.parse(e.createdAt ?? "");
    if (!e.turnId || Number.isNaN(at) || at < sinceMs) continue;
    const t = turns.get(e.turnId) ?? { turnId: e.turnId, provider: e.provider ?? null, startedAt: null, completedAt: null, ok: null, usage: null, model: null, tools: 0 };
    if (e.type === "turn.started") t.startedAt = e.createdAt;
    else if (e.type === "session.started") t.model = e.model ?? t.model;
    else if (e.type === "turn.completed") { t.completedAt = e.createdAt; t.ok = e.ok !== false; if (e.usage) t.usage = e.usage; }
    else if (e.type === "thread.token-usage.updated" && !t.usage) t.lastTokens = { input: e.input, output: e.output, cachedInput: e.cachedInput ?? 0 };
    else if (e.type === "item.started" && e.itemType === "tool") t.tools++;
    turns.set(e.turnId, t);
  }
  const list = [...turns.values()].map((t) => ({ ...t, usage: t.usage ?? t.lastTokens ?? null })).sort((a, b) => Date.parse(a.startedAt ?? a.completedAt ?? 0) - Date.parse(b.startedAt ?? b.completedAt ?? 0));
  const totals = list.reduce((acc, t) => ({ input: acc.input + (t.usage?.input ?? 0), output: acc.output + (t.usage?.output ?? 0), cachedInput: acc.cachedInput + (t.usage?.cachedInput ?? 0) }), { input: 0, output: 0, cachedInput: 0 });
  return { turns: list, totals, seconds: list.reduce((s, t) => s + (t.startedAt && t.completedAt ? (Date.parse(t.completedAt) - Date.parse(t.startedAt)) / 1000 : 0), 0) };
}

/** Tool calls, tool results, and texts from the lead's native log. One record
 * per line, {at, dir, source, msg} (0.1.56 server/drivers/native.ts:11-25,
 * server/thread-events.ts:18-24). A thread rebound between engines mixes both
 * shapes in one file, so every entry is classified on its own: Claude SDK
 * messages (source claude.sdk.message; claude.ts:1043 in, :664-668 out) and
 * Codex app-server notifications (source codex.app-server; codex.ts:903 in,
 * :596-604 out). */
export function nativeCalls(native) {
  const acc = { calls: [], results: new Map(), texts: [], seen: new Set() };
  for (const e of native ?? []) {
    if (!e?.msg) continue;
    if (isCodexEntry(e)) codexEntry(e, acc); else claudeEntry(e, acc);
  }
  return { calls: acc.calls, results: acc.results, texts: acc.texts };
}

const isCodexEntry = (e) => e.source === "codex.app-server" || (typeof e.msg?.method === "string" && typeof e.msg?.params?.item?.type === "string");

/** Claude: content blocks tool_use {id,name,input}, tool_result {tool_use_id,is_error,content}, text. */
function claudeEntry(e, acc) {
  const m = e.msg;
  const content = m.message?.content;
  if (typeof content === "string") { acc.texts.push({ at: e.at, role: m.message?.role ?? m.type, text: content }); return; }
  if (!Array.isArray(content)) return;
  for (const c of content) {
    if (c.type === "tool_use") acc.calls.push({ at: e.at, id: c.id, name: c.name, input: c.input ?? {} });
    else if (c.type === "tool_result") acc.results.set(c.tool_use_id, { at: e.at, ok: c.is_error !== true, content: typeof c.content === "string" ? c.content : Array.isArray(c.content) ? c.content.map((x) => x.text ?? "").join("\n") : "" });
    else if (c.type === "text" && c.text) acc.texts.push({ at: e.at, role: m.message?.role ?? m.type, text: c.text });
  }
}

const joinedText = (content) => (Array.isArray(content) ? content.map((x) => x.text ?? "").join("\n") : "");

/** Codex: only item/started and item/completed carry tool items, with the same
 * item.id on both (an interrupted item has no completed). commandExecution is a
 * Bash call whose command is the verbatim "/bin/bash -lc '…'" string and whose
 * result is aggregatedOutput; mcpToolCall is mcp__<server>__<tool> (server is the
 * bare mount name, codex.ts:532) with `arguments` as input and result.content[].text
 * as the reply; ok follows codex.ts:831 (neither failed nor declined) plus a null
 * error (a denial is status failed, result null, error.message). agentMessage text
 * is "" on started and complete on completed; userMessage carries content[].text.
 * reasoning, fileChange, webSearch and the rest are not tool calls here. */
function codexEntry(e, acc) {
  const m = e.msg; const item = m.params?.item;
  if (!item?.id || (m.method !== "item/started" && m.method !== "item/completed")) return;
  const completed = m.method === "item/completed";
  let call = null; let content = "";
  if (item.type === "commandExecution") { call = { name: "Bash", input: { command: item.command } }; content = item.aggregatedOutput ?? ""; }
  else if (item.type === "mcpToolCall") { call = { name: `mcp__${item.server}__${item.tool}`, input: item.arguments ?? {} }; content = joinedText(item.result?.content); }
  else if (completed && item.type === "agentMessage" && item.text) acc.texts.push({ at: e.at, role: "assistant", text: item.text });
  else if (completed && item.type === "userMessage" && joinedText(item.content)) acc.texts.push({ at: e.at, role: "user", text: joinedText(item.content) });
  if (!call) return;
  if (!acc.seen.has(item.id)) { acc.seen.add(item.id); acc.calls.push({ at: e.at, id: item.id, ...call }); }
  if (completed) acc.results.set(item.id, { at: e.at, ok: item.status !== "failed" && item.status !== "declined" && !item.error, content });
}

const commandOf = (call) => (typeof call.input?.command === "string" ? call.input.command : JSON.stringify(call.input));

/** The final explicit verdict controls, including an unrecognized verdict.
 * Approval must be an unqualified final line, with no contradictory or
 * conditional language elsewhere in the reply. Unknown prose is not a vote. */
function approvalVerdict(text) {
  const lines = String(text ?? "").replace(/[*`_]/g, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;
  const verdictLine = /^(?:(?:final|plan)\s+)?verdict\s*:\s*(.*)$/i;
  const index = lines.findLastIndex((line) => verdictLine.test(line));
  const candidate = index >= 0 ? verdictLine.exec(lines[index])[1] : lines.at(-1).replace(/^plan\s+/i, "");
  // An explicit refusal may include its reason; it must not be discarded in
  // favour of an earlier approval. Contradictions in that same line are unknown.
  if (/^(?:not[ -]?ready|revise|reject(?:ed)?)\b/i.test(candidate)) {
    return /\b(?:approve|approved)\b/i.test(candidate) ? null : false;
  }
  if (!/^(?:approve|approved|ready)(?::\s*(?:approve|approved|ready))?[.!]?$/i.test(candidate)) return null;
  if (index >= 0 && index !== lines.length - 1) return null;
  // Do not silently drop a conditional or conflicting line just because it
  // does not have a short machine-recognizable verdict. Non-blocking findings
  // are allowed (the archived T12 review has one before its final approval).
  const context = lines.slice(0, -1).join("\n").replace(/\bnon[ -]blocking\b/gi, "advisory");
  const unresolved = [
    // Negation applies to arbitrary verbs, not just "approve" or "ready".
    /\b(?:not|never|cannot|can['’]t|won['’]t|(?:could|would|should|must|do|does|did|is|are|was|were|has|have|had)n['’]t|withheld|reject(?:ed|ion)?|revise|disapprov(?:e|es|ed|al)|den(?:y|ies|ied|ial)|refus(?:e|es|ed|al)|veto(?:ed)?)\b/i,
    /\bno\s+(?:approval|permission|authorization|go[- ]ahead)\b/i,
    // Modal requirements and dependencies make an apparent approval conditional.
    /\b(?:must|shall|should|ought|needs?|requir(?:e|es|ed|ement|ements)|necessary|mandatory|prerequisites?|depends?|dependent|contingent|conditions?|conditional(?:ly)?|assuming|provided|pending)\b/i,
    /\b(?:if|unless|until|before|after|once|when|subject to|as long as|have to|has to|had to)\b/i,
    /(?:^|\s)only\b/i, // excludes descriptive compounds such as "read-only"
    // An unresolved or uncertain state conflicts with an unqualified approval.
    /\b(?:still|yet|outstanding|unresolved|block(?:ing|er|ers)|unsafe|undecided|uncertain|ambiguous|maybe|perhaps)\b/i,
  ];
  return unresolved.some((pattern) => pattern.test(context)) ? null : true;
}

const timestamp = (value) => typeof value === "number" ? value : Date.parse(value ?? "");

/** The 0.4.2 pack checks. Each check is true, false, or null (unknown).
 * `messages` must be server-authored messages from the lead's run thread. */
export function check042({ native, messages = [], leadThreadId, taskLogText, taskLogEntry = undefined, reviewer, sentAt = 0, toolNames }) {
  const checks = [];
  const put = (id, ok, detail) => checks.push({ id, ok, detail });
  const parsed = nativeCalls(native);
  const calls = parsed.calls.filter((c) => timestamp(c.at) >= sentAt);
  const results = parsed.results;
  const worktreeAdd = calls.filter((c) => c.name === "Bash" && /git worktree add/.test(commandOf(c))).sort((a, b) => timestamp(a.at) - timestamp(b.at))[0];
  const replies = [];
  if (reviewer?.id) {
    // 0.1.56 server/drivers/agents-proxy.ts:249-259 defines ask_bot.bot_id;
    // drivers/claude.ts:1099-1100 correlates tool_result by tool_use_id.
    for (const call of calls) {
      if (!call.id || call.name !== "mcp__agents__ask_bot" || call.input.bot_id !== reviewer.id) continue;
      const reply = results.get(call.id);
      if (reply && timestamp(reply.at) >= timestamp(call.at)) replies.push({ at: timestamp(reply.at), text: reply.ok ? reply.content : null });
    }
    // 0.1.56 server/index.ts:3383-3390 authors the echo on the source thread
    // with from.botId. Native prose that merely mentions @Name is not proof.
    for (const m of messages) {
      if (m.threadId && m.threadId !== leadThreadId) continue;
      if (m.role === "bot" && m.kind === "text" && m.from?.botId === reviewer.id && /^@.+? replied to the delegated task:\s*/s.test(m.text ?? "")) {
        replies.push({ at: timestamp(m.at), text: m.text.replace(/^@.+? replied to the delegated task:\s*/s, "") });
      }
    }
  }
  const approval = replies.filter((r) => r.at >= sentAt && r.at < timestamp(worktreeAdd?.at)).sort((a, b) => a.at - b.at).at(-1);
  const verdict = approval ? approvalVerdict(approval.text) : null;
  if (!worktreeAdd) put("worktree-after-approval", null, "no `git worktree add` in the lead's native log");
  else if (!approval) put("worktree-after-approval", null, `git worktree add at ${worktreeAdd.at}; no attributable pre-worktree reply from ${reviewer?.name ?? "the reviewer"}`);
  else put("worktree-after-approval", verdict, `${reviewer.name}'s last pre-worktree reply at ${new Date(approval.at).toISOString()}: ${verdict === true ? "approved" : verdict === false ? "not approved" : "verdict unknown"}; git worktree add at ${worktreeAdd.at}`);
  const dateCall = calls.filter((c) => c.name === "Bash" && /date -u/.test(commandOf(c))).at(-1);
  const stamp = dateCall ? (results.get(dateCall.id)?.content ?? "").trim().split("\n").find((l) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(l.trim()))?.trim() : null;
  if (!dateCall) put("record-time-from-date-u", null, "no `date -u` call in the lead's native log");
  else if (!stamp) put("record-time-from-date-u", null, "the `date -u` call has no timestamp result in the log");
  else if (!taskLogText) put("record-time-from-date-u", null, "no task log to compare with");
  else {
    // With two runs writing one log, the newest heading may be the other run's;
    // compare against this run's own entry when the report found one.
    const heading = taskLogEntry !== undefined ? taskLogEntry ?? "" : taskLogText.split("\n").find((l) => /^#{2,4} /.test(l)) ?? "";
    put("record-time-from-date-u", heading.includes(stamp), `date -u returned ${stamp}; ${taskLogEntry !== undefined ? "this run's" : "the task log's first"} entry heading is "${heading.trim()}"`);
  }
  // ListAgents is a Claude Code built-in (0.1.56 claude.ts:777-781); a Codex lead has no
  // equivalent, so for Codex this check reduces to "the lead called mcp__agents__list_bots".
  const names = new Set(calls.map((c) => c.name).concat(toolNames ?? []));
  put("no-host-listagents", names.has("ListAgents") ? false : names.has("mcp__agents__list_bots") && native?.length ? true : null, `tools used: ${[...names].filter((n) => /list_bots|ListAgents/i.test(n)).join(", ") || "neither list_bots nor ListAgents"}`);
  return checks;
}

export function beadStatus(id, cwd, { timeoutMs = 30_000 } = {}) {
  if (!id) return { ok: null, detail: "no bead named in the run" };
  const r = spawnSync("bd", ["show", id, "--json"], { cwd, encoding: "utf8", timeout: timeoutMs });
  if (r.error || r.status !== 0) return { ok: null, detail: `bd show ${id} unavailable: ${(r.stderr || r.error?.message || "").trim().slice(0, 120)}` };
  try { const j = JSON.parse(r.stdout); const issue = Array.isArray(j) ? j[0] : j; return { ok: issue?.status === "closed", detail: `bead ${id} is ${issue?.status ?? "unknown"}` }; } catch { return { ok: null, detail: "bd show returned no JSON" }; }
}

export function commitsSince(projectDir, sinceSha) {
  let out = "";
  try { out = git(["log", "--format=%H%x09%ct%x09%s", `${sinceSha}..HEAD`], projectDir); } catch { return []; }
  return out ? out.split("\n").filter(Boolean).map((l) => { const [sha, at, ...rest] = l.split("\t"); let files = []; try { files = git(["diff-tree", "--no-commit-id", "--name-only", "-r", sha], projectDir).split("\n").filter(Boolean); } catch {} return { sha, at: Number(at) * 1000, subject: rest.join("\t"), files }; }) : [];
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const wholeWord = (n) => new RegExp(`(?<![\\w-])${escapeRe(n)}(?![\\w-])`, "i");

/** Where this text first names the run — its slug, its title, or the bead it
 * carries — as a whole word, or -1. "T10" and "foo-10" must not answer for T1
 * and foo-1, or one run's record commit and log entry would close the other. */
export function namedAt(text, run) {
  const hay = String(text ?? "");
  let at = -1;
  for (const n of [run?.slug, run?.title, run?.bead].filter(Boolean)) {
    const m = wholeWord(n).exec(hay);
    if (m && (at < 0 || m.index < at)) at = m.index;
  }
  return at;
}

export const namesRun = (text, run) => namedAt(text, run) >= 0;

const identifiers = (run) => [run?.slug, run?.title, run?.bead, run?.tag].filter(Boolean);

// Shared names exclude a rival only outside its evidence window, or when an
// exclusive target identifier resolves them without an exclusive rival one.
const namesRival = (text, rival, run, at) => {
  const ours = new Set(identifiers(run).map((s) => s.toLowerCase()));
  const theirs = new Set(identifiers(rival).map((s) => s.toLowerCase()));
  const named = [...theirs].filter((id) => wholeWord(id).test(text));
  if (!named.length) return false;
  const exclusive = named.some((id) => !ours.has(id));
  const outside = Number.isFinite(at) && (at < (rival.sentAt ?? -Infinity) - 1000 || at > (rival.closedAt ? Date.parse(rival.closedAt) : Date.now()) + 1000);
  return exclusive || (!outside && ![...ours].some((id) => !theirs.has(id) && wholeWord(id).test(text)));
};

// A heading is dated only by a full RFC 3339 time: a bare date carries no time
// of day and would fall outside every run's window by hours, and an offset
// dropped from the end would move the heading by hours as well.
const headingTime = (heading) => {
  const m = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/.exec(heading);
  const at = m ? Date.parse(m[0]) : NaN;
  return Number.isNaN(at) ? null : at;
};

/** Everything a run answers to, built once per call: the names that make a
 * section "about" it (slug, title, bead) and every identifier that can tell it
 * apart from another dispatch (the tag too). Each field is read exactly once. */
function matchersFor(run) {
  const [slug, title, bead, tag] = ["slug", "title", "bead", "tag"].map((k) => run?.[k]);
  return {
    named: [slug, title, bead].filter(Boolean).map(wholeWord),
    ids: [slug, title, bead, tag].filter(Boolean).map((id) => ({ id: id.toLowerCase(), re: wholeWord(id) })),
  };
}
const firstMention = (text, m) => {
  let at = -1;
  for (const re of m.named) { const x = re.exec(text); if (x && (at < 0 || x.index < at)) at = x.index; }
  return at;
};

/**
 * The task log entry this run wrote, read section by section:
 *
 * 1. a section that does not name this run at all is not its entry (that test
 *    comes first, so a long history costs nothing on the sections it skips);
 * 2. a dated heading is claimable only by the runs whose window contains it
 *    (`sentAt` to `closedAt`, or to now, ±1 s), this run included — the window
 *    excludes before any identifier is weighed; an undated heading admits all;
 * 3. among the admitted runs the section is about whichever it names first —
 *    heading included, in any order of slug, title and bead — so an entry that
 *    mentions another run afterwards stays its author's;
 * 4. when another dispatch answers to that same mention, the section is this
 *    run's only if it names an identifier of this run that the twin does not
 *    have and names no identifier of the twin that this run does not have. A
 *    twin the window already excluded still speaks here: naming its bead says
 *    the entry is about that dispatch. Anything else is `null`, never a guess.
 *
 * Among this run's own entries: dated before undated, newest first, top-most on
 * a tie.
 */
export function taskLogEntry(text, run, { others = [], sinceMs = null, untilMs = null } = {}) {
  if (!text) return null;
  const now = Date.now();
  const target = { ...matchersFor(run), window: { from: sinceMs === null ? -Infinity : sinceMs - 1000, to: untilMs === null ? Infinity : untilMs + 1000 } };
  const rivals = others.map((other) => ({ ...matchersFor(other), window: { from: (other.sentAt ?? -Infinity) - 1000, to: (other.closedAt ? Date.parse(other.closedAt) : now) + 1000 } }));
  const lines = text.split("\n");
  const heads = [];
  for (let i = 0; i < lines.length; i++) if (/^#{2,4} /.test(lines[i])) heads.push(i);
  const mine = [];
  for (let k = 0; k < heads.length; k++) {
    const section = lines.slice(heads[k], k + 1 < heads.length ? heads[k + 1] : lines.length).join("\n");
    const at = firstMention(section, target);
    if (at < 0) continue;
    const headingAt = headingTime(lines[heads[k]]);
    const admits = (m) => headingAt === null || (headingAt >= m.window.from && headingAt <= m.window.to);
    if (!admits(target)) continue;
    const twins = []; let named = true;
    for (const m of rivals) {
      const mAt = firstMention(section, m);
      if (mAt < 0) continue;
      if (mAt === at) twins.push({ m, admitted: admits(m) });
      else if (mAt < at && admits(m)) named = false;
    }
    if (!named) continue;
    if (twins.length) {
      const ours = new Set(target.ids.map((x) => x.id));
      const theirs = new Set(twins.flatMap(({ m }) => m.ids.map((x) => x.id)));
      if (twins.some(({ m }) => m.ids.some((x) => !ours.has(x.id) && x.re.test(section)))) continue;
      if (!target.ids.some((x) => !theirs.has(x.id) && x.re.test(section)) && twins.some((t) => t.admitted)) continue;
    }
    mine.push({ heading: lines[heads[k]].trim(), at: headingAt, line: heads[k] });
  }
  mine.sort((a, b) => (a.at === null) - (b.at === null) || (b.at ?? 0) - (a.at ?? 0) || a.line - b.line);
  return mine[0]?.heading ?? null;
}

/** Turns on a thread two runs share: only those inside one of this run's
 * open-delegation windows are this run's; the rest are counted, and labelled,
 * as shared. How a window opened decides what "inside" means. A queued
 * delegation's turn STARTS after its chip (delegations.ts:302 enqueues, the
 * target's turn follows), so a turn already running when the chip was written
 * belongs to whoever started it. An ask converted to a delegation is the other
 * way round: the wait timed out because that turn was already running
 * (index.ts:7894-7917), so overlap is the right test there. */
export function allocateTurns(turns, windows) {
  const inside = (turn) => {
    const from = Date.parse(turn.startedAt ?? turn.completedAt ?? "");
    const to = Date.parse(turn.completedAt ?? turn.startedAt ?? "");
    if (Number.isNaN(from) && Number.isNaN(to)) return false;
    const started = Number.isNaN(from) ? to : from;
    const ended = Number.isNaN(to) ? from : to;
    return (windows ?? []).some((w) => {
      const closed = w.to ?? Infinity;
      return w.kind === "converted" ? ended >= w.from && started <= closed : started >= w.from && started <= closed;
    });
  };
  const mine = turns.filter(inside);
  return { mine, shared: turns.length - mine.length };
}

export function totalsOf(turns) {
  return turns.reduce((acc, t) => ({ input: acc.input + (t.usage?.input ?? 0), output: acc.output + (t.usage?.output ?? 0), cachedInput: acc.cachedInput + (t.usage?.cachedInput ?? 0) }), { input: 0, output: 0, cachedInput: 0 });
}
export const secondsOf = (turns) => turns.reduce((s, t) => s + (t.startedAt && t.completedAt ? (Date.parse(t.completedAt) - Date.parse(t.startedAt)) / 1000 : 0), 0);

/** A Project facts test command may carry a note for the bots, e.g. "npm test (run inside the task's worktree)"; strip it before running. */
export const bareCommand = (command) => String(command ?? "").replace(/\s*\(run inside the task's worktree\)\s*$/, "").trim();

export function runTests(command, cwd, { timeoutMs = 10 * 60_000 } = {}) {
  command = bareCommand(command);
  if (!command || command === "none" || command === "<fill in>") return { ran: false, ok: null, detail: "no test command in Project facts" };
  const t0 = Date.now();
  const r = spawnSync("sh", ["-c", command], { cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  return { ran: true, ok: r.status === 0, status: r.status, seconds: Math.round((Date.now() - t0) / 1000), tail: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-8).join("\n") };
}

// "merged as <sha>", and "merged [<object>] into|to|onto <branch> as|at <sha>".
// A branch position on its own ("`main` at `<sha>`") says where a branch is,
// not what was merged. 7 to 40 hex, bounded by non-word characters.
const HEX = String.raw`\`?([0-9a-f]{7,40})\`?(?![\w-])`;
const TOKEN = String.raw`(?:\`[^\`]+\`|[\w./-]+)`;
const mergedRe = () => new RegExp(String.raw`(?<![\w-])merged\s+(?:${TOKEN}\s+)?(?:into|to|onto)\s+${TOKEN}\s+(?:as|at)\s+${HEX}|(?<![\w-])merged\s+as\s+${HEX}`, "gi");
// Both endpoints are bounded like the merge forms: hex inside a word, or a
// forty-first digit, is not a commit at either end of `a..b`.
const rangeRe = () => new RegExp(String.raw`(?<![\w-])\`?[0-9a-f]{7,40}\.\.${HEX}`, "gi");
const NEGATED = /\b(?:not|never)\b|n['’]t\b/i;

/** Clauses, split outside backticked spans on newlines, `;`, the ` - ` bullets
 * of a flattened report, and sentence-ending punctuation before whitespace or
 * the end. Commas never split, and the `.` in `release/1.2` or `a..b` is not a
 * sentence end. Masking keeps the offsets, so each slice is the original text. */
function clausesOf(text) {
  const masked = String(text).replace(/`[^`]*`/g, (m) => "x".repeat(m.length));
  const re = /\n+|\s*;\s*|\s+-\s+|[.!?](?=\s|$)/g;
  const out = []; let start = 0;
  for (let m; (m = re.exec(masked)); ) {
    out.push(text.slice(start, m.index + (/^[.!?]$/.test(m[0]) ? 1 : 0)));
    start = m.index + m[0].length;
  }
  out.push(text.slice(start));
  return out.filter((c) => c.trim());
}

/** The sha this run's own clauses assert: `undefined` when the text asserts
 * none, `null` when it cannot say whose merge it describes. A clause naming no
 * run continues the nearest earlier one that does; with none, the text is this
 * run's own lead thread. Unresolved rivals make a shared clause ambiguous. */
function ownedSha(text, run, others, pattern, at) {
  if (!text) return undefined;
  const found = new Set();
  let owners = [];
  for (const clause of clausesOf(text)) {
    const named = [run, ...others].filter((r) => r && (r === run ? namesRun(clause, run) : namesRival(clause, r, run, at)));
    if (named.length) owners = named;
    const mine = owners.length === 0 || (owners.length === 1 && owners[0] === run);
    const shared = owners.length > 1 && owners.includes(run);
    for (const m of clause.matchAll(pattern())) {
      const predicate = clause.slice(0, m.index).split(/\b(?:but|however|instead|(?<!\b(?:not|never)\s+|n['’]t\s+)yet)\b/i).at(-1);
      if (NEGATED.test(predicate)) continue;
      if (shared) return null;
      if (mine) found.add(m[1] ?? m[2]);
    }
  }
  return found.size === 1 ? [...found][0] : found.size ? null : undefined;
}

/** The sha a `docs(team): …` subject records for this run, or null. The subject
 * is comma-separated segments, one per run the commit records; a segment
 * qualifies when its task text names this run and no unresolved rival. Its sha
 * is the LAST `merged as`, so a title carrying the phrase is not evidence.
 * Exactly one qualifying segment is a record — none, or several, is not, even
 * when they agree. This is what makes a commit this run's record commit and
 * what reads the sha out of it: the two must not disagree. */
export function recordCommitSha(subject, run, others = [], { at } = {}) {
  const text = String(subject ?? "");
  if (!/^docs\(team\):\s/i.test(text)) return null;
  const qualifying = [];
  for (const segment of text.replace(/^docs\(team\):\s*/i, "").split(",")) {
    const m = /^(.*)(?<![\w-])merged as `?([0-9a-f]{7,40})`?$/i.exec(segment.trim());
    if (!m || !namesRun(m[1], run) || others.some((r) => namesRival(m[1], r, run, at))) continue;
    qualifying.push(m[2]);
  }
  return qualifying.length === 1 ? qualifying[0] : null;
}

/** The commit this run was merged as: its own clause in the closing text, else
 * the record commit's subject, else a "<a>..<b>" range this run's text owns. */
export function mergedShaFrom(closing, recordSubject, { run = null, others = [], closingAt, recordAt } = {}) {
  const asserted = ownedSha(closing, run, others, mergedRe, closingAt);
  if (asserted !== undefined) return asserted;
  const recorded = recordCommitSha(recordSubject, run, others, { at: recordAt });
  if (recorded !== null) return recorded;
  return ownedSha(closing, run, others, rangeRe, closingAt) ?? null;
}

export function renderMarkdown(r) {
  const yes = (v) => (v === true ? "yes" : v === false ? "no" : "unknown");
  const lines = [];
  lines.push(`## ${r.date} — ${r.title} (${r.result})`, "");
  lines.push(`Run ${r.runId}, tag ${r.tag}, OpenMausBot ${r.version ?? "unknown"}, lead ${r.lead} (${r.leadModel ?? "model unknown"})${r.implementer ? `, implementer ${r.implementer.name}` : ""}${r.branch ? `, branch ${r.branch}` : ""}, project ${r.project}, dispatched ${r.sentAt} from ${r.sentSha?.slice(0, 7)}; final state ${r.state}${r.openRuns?.length ? `; still open: ${r.openRuns.join(", ")}` : ""}.`, "");
  lines.push("| Thread | Turns | Bot seconds | Input | Cached | Output |", "|---|---|---|---|---|---|");
  for (const t of r.threads) lines.push(`| ${t.bot}${t.shared ? ` (+${t.shared} shared)` : ""} | ${t.turns} | ${Math.round(t.seconds)} | ${t.totals.input} | ${t.totals.cachedInput} | ${t.totals.output} |`);
  lines.push("", `Outcomes: ${r.outcomes.length}${r.outcomes.length ? ` (${r.outcomes.map((o) => `${o.kind} ${o.name ?? ""}`.trim()).join(", ")})` : ""}. Commits since dispatch: ${r.commits.length}${r.commits.length ? ` (${r.commits.map((c) => `${c.sha.slice(0, 7)} ${c.subject}`).join("; ")})` : ""}.`, "");
  lines.push(`Record step: task log ${yes(r.record.taskLogChanged)}, record commit ${r.record.commit ? r.record.commit.slice(0, 7) : "none"}, ${r.record.bead.detail}. Tests: ${r.tests.ran ? (r.tests.ok ? `passed in ${r.tests.seconds} s` : `FAILED (exit ${r.tests.status})`) : r.tests.detail}. Root: ${r.reconcile.clean ? "clean" : r.reconcile.problems.join("; ")}.`, "");
  if (r.hint) lines.push(r.hint, "");
  if (r.check042) { lines.push("0.4.2 checks:", ""); for (const c of r.check042) lines.push(`- ${c.id}: ${yes(c.ok)} — ${c.detail}`); lines.push(""); }
  lines.push(`Closing report from ${r.lead}: "${(r.closing ?? "").replace(/\s+/g, " ").slice(0, 400)}"`, "");
  return lines.join("\n");
}

/** Offline transcript access; never imports legacy data or opens a writable DB.
 * OpenMausBot 0.1.56 server/message-db.ts:21,119-127,141-145. */
export async function archivedMessages(dataDir, threadId) {
  if (!dataDir || !threadId) return null;
  const file = path.join(dataDir, "messages.db");
  if (fs.existsSync(file)) {
    let db;
    try {
      const { DatabaseSync } = await import("node:sqlite");
      db = new DatabaseSync(file, { readOnly: true });
      const rows = db.prepare("SELECT json FROM messages WHERE thread_id = ? ORDER BY rowid").all(threadId);
      if (rows.length) return rows.map((r) => JSON.parse(r.json));
    } catch { return null; }
    finally { db?.close(); }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, `messages-${threadId}.json`), "utf8"));
    return Array.isArray(raw) ? raw : Array.isArray(raw?.messages) ? raw.messages : null;
  } catch { return null; }
}

/** Legacy metadata is usable only when both roster and archive identity
 * corroborate that the saved binding is still this run's original binding. */
export function historicalContext(task, state, dataDirOverride) {
  const saved = task.context ?? { server: state?.server, team: state?.team, facts: state?.facts };
  const dataDir = dataDirOverride ?? saved.server?.dataDir;
  let environmentId = null;
  try { environmentId = fs.readFileSync(path.join(dataDir, "environment-id"), "utf8").trim(); } catch {}
  const roster = saved.team?.bots;
  const ids = roster?.map((b) => b.id);
  const runIds = Object.keys(task.threads ?? {});
  // A later run records a thread only for the bots it uses, so the roster is
  // the superset: every thread must belong to a roster bot, not the reverse.
  const matching = ids?.length > 0 && new Set(ids).size === ids.length && runIds.length > 0 && runIds.every((id) => ids.includes(id));
  const identity = saved.team?.environmentId && saved.server?.environmentId && environmentId === saved.team.environmentId && environmentId === saved.server.environmentId;
  const bound = matching && task.leadThreadId && task.threads?.[saved.team?.lead?.id] === task.leadThreadId;
  if (task.context && bound && identity) return { ...saved, dataDir, ok: true, source: "run context" };
  if (!task.context && bound && identity) return { ...saved, dataDir, ok: true, source: "corroborated legacy binding" };
  return { server: task.context?.server ?? null, team: null, facts: null, dataDir, ok: null, source: "run context unavailable or archive identity does not match" };
}
