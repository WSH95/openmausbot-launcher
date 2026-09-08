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

/** Tool calls, tool results, and texts from a Claude-SDK native log (entries {at, dir, msg}). */
export function nativeCalls(native) {
  const calls = []; const results = new Map(); const texts = [];
  for (const e of native ?? []) {
    const m = e.msg; if (!m) continue;
    const content = m.message?.content;
    if (typeof content === "string") { texts.push({ at: e.at, role: m.message?.role ?? m.type, text: content }); continue; }
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c.type === "tool_use") calls.push({ at: e.at, id: c.id, name: c.name, input: c.input ?? {} });
      else if (c.type === "tool_result") results.set(c.tool_use_id, { at: e.at, ok: c.is_error !== true, content: typeof c.content === "string" ? c.content : Array.isArray(c.content) ? c.content.map((x) => x.text ?? "").join("\n") : "" });
      else if (c.type === "text" && c.text) texts.push({ at: e.at, role: m.message?.role ?? m.type, text: c.text });
    }
  }
  return { calls, results, texts };
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
export function check042({ native, messages = [], leadThreadId, taskLogText, reviewer, sentAt = 0, toolNames }) {
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
    const firstHeading = taskLogText.split("\n").find((l) => /^#{2,4} /.test(l)) ?? "";
    put("record-time-from-date-u", firstHeading.includes(stamp), `date -u returned ${stamp}; the task log's first entry heading is "${firstHeading.trim()}"`);
  }
  const names = new Set(calls.map((c) => c.name).concat(toolNames ?? []));
  put("no-host-listagents", names.has("ListAgents") ? false : names.has("mcp__agents__list_bots") && native?.length ? true : null, `tools used: ${[...names].filter((n) => /list_bots|ListAgents/i.test(n)).join(", ") || "neither list_bots nor ListAgents"}`);
  return checks;
}

export function beadStatus(id, cwd) {
  if (!id) return { ok: null, detail: "no bead named in the run" };
  const r = spawnSync("bd", ["show", id, "--json"], { cwd, encoding: "utf8" });
  if (r.error || r.status !== 0) return { ok: null, detail: `bd show ${id} unavailable: ${(r.stderr || r.error?.message || "").trim().slice(0, 120)}` };
  try { const j = JSON.parse(r.stdout); const issue = Array.isArray(j) ? j[0] : j; return { ok: issue?.status === "closed", detail: `bead ${id} is ${issue?.status ?? "unknown"}` }; } catch { return { ok: null, detail: "bd show returned no JSON" }; }
}

export function commitsSince(projectDir, sinceSha) {
  let out = "";
  try { out = git(["log", "--format=%H%x09%s", `${sinceSha}..HEAD`], projectDir); } catch { return []; }
  return out ? out.split("\n").filter(Boolean).map((l) => { const [sha, ...rest] = l.split("\t"); let files = []; try { files = git(["diff-tree", "--no-commit-id", "--name-only", "-r", sha], projectDir).split("\n").filter(Boolean); } catch {} return { sha, subject: rest.join("\t"), files }; }) : [];
}

/** A Project facts test command may carry a note for the bots, e.g. "npm test (run inside the task's worktree)"; strip it before running. */
export const bareCommand = (command) => String(command ?? "").replace(/\s*\(run inside the task's worktree\)\s*$/, "").trim();

export function runTests(command, cwd, { timeoutMs = 10 * 60_000 } = {}) {
  command = bareCommand(command);
  if (!command || command === "none" || command === "<fill in>") return { ran: false, ok: null, detail: "no test command in Project facts" };
  const t0 = Date.now();
  const r = spawnSync("sh", ["-c", command], { cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  return { ran: true, ok: r.status === 0, status: r.status, seconds: Math.round((Date.now() - t0) / 1000), tail: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-8).join("\n") };
}

/** The merged commit: the closing text's "merged as <sha>", else the record commit's subject, else a "<a>..<b>" range in the closing text. */
export function mergedShaFrom(closing, recordSubject) {
  const m1 = closing ? /merged as `?([0-9a-f]{7,40})`?/i.exec(closing) : null;
  if (m1) return m1[1];
  const m2 = recordSubject ? /merged as ([0-9a-f]{7,40})/i.exec(recordSubject) : null;
  if (m2) return m2[1];
  const m3 = closing ? /`?[0-9a-f]{7,40}\.\.([0-9a-f]{7,40})`?/.exec(closing) : null;
  return m3 ? m3[1] : null;
}

export function renderMarkdown(r) {
  const yes = (v) => (v === true ? "yes" : v === false ? "no" : "unknown");
  const lines = [];
  lines.push(`## ${r.date} — ${r.title} (${r.result})`, "");
  lines.push(`Run ${r.runId}, tag ${r.tag}, OpenMausBot ${r.version ?? "unknown"}, lead ${r.lead} (${r.leadModel ?? "model unknown"}), project ${r.project}, dispatched ${r.sentAt} from ${r.sentSha?.slice(0, 7)}; final state ${r.state}.`, "");
  lines.push("| Thread | Turns | Bot seconds | Input | Cached | Output |", "|---|---|---|---|---|---|");
  for (const t of r.threads) lines.push(`| ${t.bot} | ${t.turns} | ${Math.round(t.seconds)} | ${t.totals.input} | ${t.totals.cachedInput} | ${t.totals.output} |`);
  lines.push("", `Outcomes: ${r.outcomes.length}${r.outcomes.length ? ` (${r.outcomes.map((o) => `${o.kind} ${o.name ?? ""}`.trim()).join(", ")})` : ""}. Commits since dispatch: ${r.commits.length}${r.commits.length ? ` (${r.commits.map((c) => `${c.sha.slice(0, 7)} ${c.subject}`).join("; ")})` : ""}.`, "");
  lines.push(`Record step: task log ${yes(r.record.taskLogChanged)}, record commit ${r.record.commit ? r.record.commit.slice(0, 7) : "none"}, ${r.record.bead.detail}. Tests: ${r.tests.ran ? (r.tests.ok ? `passed in ${r.tests.seconds} s` : `FAILED (exit ${r.tests.status})`) : r.tests.detail}. Root: ${r.reconcile.clean ? "clean" : r.reconcile.problems.join("; ")}.`, "");
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
  const matching = ids?.length > 0 && new Set(ids).size === ids.length && ids.length === runIds.length && ids.every((id) => runIds.includes(id));
  const identity = saved.team?.environmentId && saved.server?.environmentId && environmentId === saved.team.environmentId && environmentId === saved.server.environmentId;
  const bound = matching && task.leadThreadId && task.threads?.[saved.team?.lead?.id] === task.leadThreadId;
  if (task.context && bound && identity) return { ...saved, dataDir, ok: true, source: "run context" };
  if (!task.context && bound && identity) return { ...saved, dataDir, ok: true, source: "corroborated legacy binding" };
  return { server: task.context?.server ?? null, team: null, facts: null, dataDir, ok: null, source: "run context unavailable or archive identity does not match" };
}
