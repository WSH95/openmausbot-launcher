// Post-run forensics from the data dir and the repository, the record-step
// verification, the 0.4.2 pack checks, and the evidence section
// (design: the report row and "Real run = the 0.4.2 pack validation").
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { git, reconcileCheck } from "./git.mjs";

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
      else if (c.type === "tool_result") results.set(c.tool_use_id, { at: e.at, content: typeof c.content === "string" ? c.content : Array.isArray(c.content) ? c.content.map((x) => x.text ?? "").join("\n") : "" });
      else if (c.type === "text" && c.text) texts.push({ at: e.at, role: m.message?.role ?? m.type, text: c.text });
    }
  }
  return { calls, results, texts };
}

const commandOf = (call) => (typeof call.input?.command === "string" ? call.input.command : JSON.stringify(call.input));

/** The 0.4.2 pack checks (docs/design.md, "Real run"). Each check is ok true, false, or null (unknown). */
export function check042({ native, taskLogText, reviewerName, sentAt, toolNames }) {
  const checks = [];
  const put = (id, ok, detail) => checks.push({ id, ok, detail });
  const { calls, results, texts } = nativeCalls(native);
  const worktreeAdd = calls.find((c) => c.name === "Bash" && /git worktree add/.test(commandOf(c)));
  const approval = [...texts, ...[...results.values()].map((r) => ({ at: r.at, text: r.content }))]
    .filter((t) => Date.parse(t.at) >= (sentAt ?? 0) && reviewerName && new RegExp(reviewerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(t.text ?? "") && /\b(ready|approved)\b/i.test(t.text ?? ""))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
  if (!worktreeAdd) put("worktree-after-approval", null, "no `git worktree add` in the lead's native log");
  else if (!approval) put("worktree-after-approval", null, `git worktree add at ${worktreeAdd.at}; no plan-review verdict from ${reviewerName ?? "the reviewer"} found in the log`);
  else put("worktree-after-approval", Date.parse(worktreeAdd.at) > Date.parse(approval.at), `git worktree add at ${worktreeAdd.at}, ${reviewerName}'s verdict at ${approval.at}`);
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
  put("no-host-listagents", !names.has("ListAgents") && names.has("mcp__agents__list_bots"), `tools used: ${[...names].filter((n) => /list_bots|ListAgents/i.test(n)).join(", ") || "neither list_bots nor ListAgents"}`);
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
export const bareCommand = (command) => String(command ?? "").replace(/\s*\([^()]*\)\s*$/, "").trim();

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
