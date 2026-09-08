import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startFake, makeRepo, runOmb, ROOT, tmpDir } from "./helpers.mjs";
import { statePaths, loadState, updateState } from "../skills/openmausbot-launcher/scripts/lib/state.mjs";
import { turnsFromEvents, nativeCalls, check042, renderMarkdown, bareCommand, mergedShaFrom, beadStatus } from "../skills/openmausbot-launcher/scripts/lib/report.mjs";

const PKG = path.join(ROOT, "tests", "fixtures", "dev-team.package.json");
const iso = (ms) => new Date(ms).toISOString();

test("turnsFromEvents and nativeCalls read the runtime and native logs", () => {
  const t0 = Date.UTC(2026, 8, 8, 1, 0, 0);
  const ev = [
    { turnId: "a", provider: "claude", type: "turn.started", createdAt: iso(t0) },
    { turnId: "a", provider: "claude", type: "session.started", createdAt: iso(t0 + 500), model: "claude-sonnet-5" },
    { turnId: "a", type: "item.started", itemType: "tool", createdAt: iso(t0 + 1000) },
    { turnId: "a", type: "thread.token-usage.updated", createdAt: iso(t0 + 2000), input: 100, output: 10, cachedInput: 50 },
    { turnId: "a", type: "turn.completed", createdAt: iso(t0 + 60_000), ok: true, usage: { input: 300, output: 40, cachedInput: 200 } },
    { turnId: "b", type: "turn.started", createdAt: iso(t0 + 120_000) },
    { turnId: "b", type: "thread.token-usage.updated", createdAt: iso(t0 + 130_000), input: 20, output: 5 },
    { turnId: "old", type: "turn.completed", createdAt: iso(t0 - 60_000), ok: true, usage: { input: 9, output: 9 } },
  ];
  const r = turnsFromEvents(ev, t0);
  assert.equal(r.turns.length, 2); assert.equal(r.turns[0].model, "claude-sonnet-5"); assert.equal(r.turns[0].tools, 1);
  assert.deepEqual(r.totals, { input: 320, output: 45, cachedInput: 200 }); assert.equal(r.seconds, 60);
  const native = [
    { at: iso(t0), dir: "out", msg: { type: "user", message: { role: "user", content: "Sudo, do T10" } } },
    { at: iso(t0 + 1000), dir: "in", msg: { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Delegating." }, { type: "tool_use", id: "tu1", name: "mcp__agents__list_bots", input: {} }] } } },
    { at: iso(t0 + 2000), dir: "in", msg: { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: [{ type: "text", text: "Sage, Vale" }] }] } } },
  ];
  const n = nativeCalls(native);
  assert.deepEqual(n.calls.map((c) => c.name), ["mcp__agents__list_bots"]); assert.equal(n.results.get("tu1").content, "Sage, Vale"); assert.equal(n.texts.length, 2);
});

test("check042 on a synthetic native log", () => {
  const t0 = Date.UTC(2026, 8, 8, 1, 0, 0);
  const stamp = "2026-09-08T01:30:00Z";
  const native = [
    { at: iso(t0 + 1000), msg: { type: "assistant", message: { content: [{ type: "tool_use", id: "l", name: "mcp__agents__list_bots", input: {} }] } } },
    { at: iso(t0 + 4000), msg: { type: "assistant", message: { content: [{ type: "tool_use", id: "d", name: "mcp__agents__ask_bot", input: { bot_id: "vale" } }] } } },
    { at: iso(t0 + 5000), msg: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "d", content: "@Vale replied to the delegated task:\n\nPlan approved: ready." }] } } },
    { at: iso(t0 + 9000), msg: { type: "assistant", message: { content: [{ type: "tool_use", id: "w", name: "Bash", input: { command: "git worktree add -b task/t10 .worktrees/t10 main" } }] } } },
    { at: iso(t0 + 20_000), msg: { type: "assistant", message: { content: [{ type: "tool_use", id: "t", name: "Bash", input: { command: "date -u +%FT%TZ" } }] } } },
    { at: iso(t0 + 21_000), msg: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t", content: `${stamp}\n` }] } } },
  ];
  let checks = check042({ native, taskLogText: `# Progress\n\n### ${stamp} — Sudo\nT10 merged.\n\n### 2026-09-01T00:00:00Z — old\n`, reviewer: { id: "vale", name: "Vale" }, sentAt: t0 });
  const by = Object.fromEntries(checks.map((c) => [c.id, c]));
  assert.equal(by["worktree-after-approval"].ok, true); assert.equal(by["record-time-from-date-u"].ok, true); assert.equal(by["no-host-listagents"].ok, true);
  const early = native.map((e) => (e.msg.message.content[0].id === "w" ? { ...e, at: iso(t0 + 2000) } : e));
  checks = check042({ native: early, taskLogText: `### ${stamp} — Sudo`, reviewer: { id: "vale", name: "Vale" }, sentAt: t0 });
  assert.equal(checks.find((c) => c.id === "worktree-after-approval").ok, null);
  checks = check042({ native: [...native, { at: iso(t0 + 3000), msg: { type: "assistant", message: { content: [{ type: "tool_use", id: "x", name: "ListAgents", input: {} }] } } }], taskLogText: `### 2026-09-08T01:31:00Z — Sudo`, reviewer: { id: "vale", name: "Vale" }, sentAt: t0 });
  assert.equal(checks.find((c) => c.id === "no-host-listagents").ok, false); assert.equal(checks.find((c) => c.id === "record-time-from-date-u").ok, false);
  checks = check042({ native: [], taskLogText: null, reviewer: { id: "vale", name: "Vale" }, sentAt: t0 });
  assert.ok(checks.every((c) => c.ok === null || c.id === "no-host-listagents"));
});

test("report: a full synthetic run passes --check-042, renders markdown, and closes the run; a failing suite fails it", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { dir, git } = makeRepo();
  const bin = fs.mkdtempSync("/tmp/oml-report-bin-"); t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
  fs.writeFileSync(path.join(bin, "bd"), '#!/bin/sh\nprintf \'[{"status":"closed"}]\\n\'\n', { mode: 0o755 });
  const env = { OMB_TOKEN: "", OMB_DATA_DIR: f.dataDir, PATH: `${bin}:${process.env.PATH}` };
  fs.writeFileSync(path.join(dir, "PROGRESS.md"), "# Progress log\n\n### 2026-09-01T00:00:00Z — seed\nSeed entry.\n");
  fs.mkdirSync(path.join(dir, ".beads")); fs.writeFileSync(path.join(dir, ".beads", "issues.jsonl"), "{}\n");
  git("add", "-A"); git("commit", "-q", "-m", "seed");
  assert.equal((await runOmb(["import", PKG, "--project", dir, "--url", f.url], { env })).code, 0);
  assert.equal((await runOmb(["bind", "--project", dir, "--default", "claude/claude-sonnet-5"], { env })).code, 0);
  assert.equal((await runOmb(["facts", "--project", dir, "--test", "node -e 'process.exit(0)'", "--task-log", "PROGRESS.md", "--tracker", "beads"], { env })).code, 0);
  const run = await runOmb(["task", "--todo", "T10", "--bead", "slg-1", "--project", dir], { env });
  assert.equal(run.code, 0, run.stdout);
  const st = loadState(statePaths(dir)); const lead = st.team.lead; const lt = run.json.leadThreadId;
  // the lead's work, as the data dir and the repository would show it
  const t0 = run.json.sentAt;
  const ev = (threadId, turnId, s, e, usage) => [{ turnId, provider: "claude", threadId, type: "turn.started", createdAt: iso(s) }, { turnId, threadId, type: "session.started", createdAt: iso(s + 100), model: "claude-sonnet-5" }, { turnId, threadId, type: "turn.completed", createdAt: iso(e), ok: true, usage }];
  const novaId = st.team.bots.find((b) => b.key === "nova").id;
  fs.writeFileSync(path.join(f.dataDir, "events", `${lt}.ndjson`), [...ev(lt, "t1", t0 + 1000, t0 + 60_000, { input: 1000, output: 100, cachedInput: 500 }), ...ev(lt, "t2", t0 + 120_000, t0 + 180_000, { input: 2000, output: 200, cachedInput: 900 })].map((x) => JSON.stringify(x)).join("\n") + "\n");
  fs.writeFileSync(path.join(f.dataDir, "events", `${run.json.threads[novaId]}.ndjson`), ev(run.json.threads[novaId], "n1", t0 + 70_000, t0 + 110_000, { input: 500, output: 50, cachedInput: 0 }).map((x) => JSON.stringify(x)).join("\n") + "\n");
  const stamp = new Date(t0 + 170_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  fs.mkdirSync(path.join(f.dataDir, "native"), { recursive: true });
  const nat = [
    { at: iso(t0 + 2000), msg: { type: "assistant", message: { content: [{ type: "tool_use", id: "l", name: "mcp__agents__list_bots", input: {} }] } } },
    { at: iso(t0 + 20_000), msg: { type: "assistant", message: { content: [{ type: "tool_use", id: "d", name: "mcp__agents__ask_bot", input: { bot_id: st.team.bots.find((b) => /plan review/i.test(b.title)).id } }] } } },
    { at: iso(t0 + 30_000), msg: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "d", content: "@Vale replied to the delegated task:\n\nready" }] } } },
    { at: iso(t0 + 40_000), msg: { type: "assistant", message: { content: [{ type: "tool_use", id: "w", name: "Bash", input: { command: "git worktree add -b task/t10 .worktrees/t10 main" } }] } } },
    { at: iso(t0 + 165_000), msg: { type: "assistant", message: { content: [{ type: "tool_use", id: "dt", name: "Bash", input: { command: "date -u +%FT%TZ" } }] } } },
    { at: iso(t0 + 166_000), msg: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "dt", content: `${stamp}\n` }] } } },
  ];
  fs.writeFileSync(path.join(f.dataDir, "native", `${lt}.ndjson`), nat.map((x) => JSON.stringify(x)).join("\n") + "\n");
  // the feature merged fast-forward, then the record commit
  fs.writeFileSync(path.join(dir, "feature.txt"), "done\n"); git("add", "-A"); git("commit", "-q", "-m", "feat: T10");
  const merged = git("rev-parse", "HEAD").trim();
  fs.writeFileSync(path.join(dir, "PROGRESS.md"), `# Progress log\n\n### ${stamp} — Sudo\nT10 merged as ${merged.slice(0, 7)}.\n\n### 2026-09-01T00:00:00Z — seed\nSeed entry.\n`);
  fs.writeFileSync(path.join(dir, ".beads", "issues.jsonl"), "{\"closed\":true}\n"); git("add", "-A"); git("commit", "-q", "-m", `docs(team): T10 merged as ${merged.slice(0, 7)}`);
  await f.control({ op: "echo", threadId: lt, fromBotId: novaId, name: "Nova", text: "implemented" });
  await f.control({ op: "receipt", sourceThreadId: lt, toBotName: "Nova", status: "completed" });
  await f.control({ op: "leadSay", threadId: lt, text: `Closing report: T10 merged as ${merged}; 1 test; record commit done.\n\nDONE ${run.json.tag}` });
  let r = await runOmb(["report", "--project", dir, "--check-042"], { env });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.json.state, "running", "a single snapshot is not settled");
  assert.equal(r.json.closed, false, "not closed while the state is not terminal"); assert.equal(r.json.result, "incomplete");
  const w = await runOmb(["watch", "--project", dir, "--max-seconds", "10", "--quiet-seconds", "1", "--poll", "1"], { env });
  assert.equal(w.json.state, "done", w.stdout);
  r = await runOmb(["report", "--project", dir, "--check-042"], { env });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.json.state, "done"); assert.equal(r.json.result, "passed", JSON.stringify(r.json.check042));
  assert.equal(r.json.closed, true); assert.equal(r.json.mergedSha, merged); assert.equal(r.json.ancestor, true);
  assert.equal(r.json.record.commit.length, 40); assert.equal(r.json.record.taskLogChanged, true); assert.equal(r.json.record.bead.ok, true);
  assert.equal(r.json.tests.ok, true);
  assert.equal(r.json.threads.find((x) => x.bot === "Sudo").turns, 2); assert.equal(r.json.threads.find((x) => x.bot === "Nova").totals.input, 500);
  assert.ok(r.json.check042.every((c) => c.ok === true), JSON.stringify(r.json.check042));
  const after = loadState(statePaths(dir));
  assert.equal(after.task, null); assert.equal(after.history.at(-1).result, "passed"); assert.equal(after.history.at(-1).runId, run.json.runId);
  const md = renderMarkdown(r.json);
  assert.match(md, /^## \d{4}-\d{2}-\d{2} — T10 \(passed\)/); assert.match(md, /\| Sudo \| 2 \|/); assert.match(md, /- merged-ancestor: yes/);
  r = await runOmb(["report", "--project", dir], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /no open run/); assert.match(r.json.hint, /--run last/);
  r = await runOmb(["report", "--project", dir, "--run", "last", "--check-042"], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.reReported, true); assert.equal(r.json.result, "passed"); assert.equal(r.json.runId, run.json.runId);
  assert.equal(loadState(statePaths(dir)).history.at(-1).reanalysis?.at(-1).at !== undefined, true);
  // a second run whose suite fails
  const run2 = await runOmb(["task", "--todo", "T11", "--project", dir], { env });
  assert.equal(run2.code, 0, run2.stdout);
  assert.equal((await runOmb(["facts", "--project", dir, "--test", "node -e 'process.exit(3)'"], { env })).code, 0);
  await f.control({ op: "leadSay", threadId: run2.json.leadThreadId, text: `Closing report: nothing merged.\n\nDONE ${run2.json.tag}` });
  assert.equal((await runOmb(["watch", "--project", dir, "--max-seconds", "10", "--quiet-seconds", "1", "--poll", "1"], { env })).json.state, "done");
  r = await runOmb(["report", "--project", dir, "--md"], { env });
  assert.equal(r.code, 6); assert.match(r.stdout, /^## .* — T11 \(failed\)/m); assert.match(r.stdout, /Tests: FAILED \(exit 3\)/);
  assert.equal(loadState(statePaths(dir)).history.at(-1).result, "failed");
});

test("bareCommand strips a trailing note; mergedShaFrom falls back to the record commit and a range", () => {
  assert.equal(bareCommand("python3 -m unittest discover -s tests -t . (run inside the task's worktree)"), "python3 -m unittest discover -s tests -t .");
  assert.equal(bareCommand("npm test"), "npm test");
  assert.equal(bareCommand("node -e 'process.exit(0)'"), "node -e 'process.exit(0)'");
  assert.equal(mergedShaFrom("Merged as abc1234.", null), "abc1234");
  assert.equal(mergedShaFrom("fast-forward into main (2f6d9d5..9127a0a)", "docs(team): T12 merged as 9127a0a"), "9127a0a");
  assert.equal(mergedShaFrom("fast-forward into main (`2f6d9d5..9127a0a`)", null), "9127a0a");
  assert.equal(mergedShaFrom("nothing merged", null), null);
});

const reviewStart = Date.UTC(2026, 8, 8);
const toolCall = (at, id, name, input) => ({ at: iso(reviewStart + at), msg: { message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } } });
const toolReply = (at, id, content) => ({ at: iso(reviewStart + at), msg: { message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] } } });
const worktree = toolCall(10000, "w", "Bash", { command: "git worktree add .worktrees/t task/t" });
const reviewCheck = (native, messages = []) => check042({ native, messages, leadThreadId: "lead-thread", reviewer: { id: "vale", name: "Vale" }, sentAt: reviewStart }).find((c) => c.id === "worktree-after-approval");

test("approval comes from the named reviewer's correlated reply, never a lead paraphrase", () => {
  const ask = toolCall(1000, "ask", "mcp__agents__ask_bot", { bot_id: "vale" });
  assert.equal(reviewCheck([ask, toolReply(2000, "ask", "Verdict: approved."), worktree]).ok, true);
  assert.equal(reviewCheck([ask, toolReply(2000, "unrelated", "@Vale Verdict: approved."), worktree]).ok, null);
  assert.equal(reviewCheck([toolCall(1000, "ask", "mcp__agents__ask_bot", { bot_id: "nova" }), toolReply(2000, "ask", "@Vale Verdict: approved."), worktree]).ok, null);
  assert.equal(reviewCheck([{ at: iso(reviewStart + 2000), msg: { message: { role: "assistant", content: "Vale approved the plan, ready." } } }, worktree]).ok, null);
});

test("the last attributable pre-worktree reply controls approval, including not ready and ambiguity", () => {
  const ask = toolCall(1000, "ask", "mcp__agents__ask_bot", { bot_id: "vale" });
  for (const text of ["Verdict: not ready.", "Verdict: revise.", "Verdict: rejected."]) assert.equal(reviewCheck([ask, toolReply(2000, "ask", text), worktree]).ok, false, text);
  for (const text of ["Not sure it is ready.", "Verdict: approved, but not ready.", "Ready after you fix the blockers."]) assert.equal(reviewCheck([ask, toolReply(2000, "ask", text), worktree]).ok, null, text);
  const ask2 = toolCall(3000, "ask2", "mcp__agents__ask_bot", { bot_id: "vale" });
  assert.equal(reviewCheck([ask, toolReply(2000, "ask", "Approved."), ask2, toolReply(4000, "ask2", "Verdict: not ready."), worktree]).ok, false);
  assert.equal(reviewCheck([ask, toolReply(2000, "ask", "Approved."), ask2, toolReply(11000, "ask2", "Verdict: not ready."), worktree]).ok, true);
  assert.equal(reviewCheck([ask, toolReply(-1, "ask", "Approved."), worktree]).ok, null);
});

test("a delegate verdict must be a server-authored echo on the run thread from reviewer id", () => {
  // OpenMausBot 0.1.56 server/index.ts:3383-3390 authors this echo and from.botId.
  const echo = { id: "echo", at: reviewStart + 2000, role: "bot", kind: "text", from: { botId: "vale", name: "Vale" }, text: "@Vale replied to the delegated task:\n\nVerdict: ready." };
  assert.equal(reviewCheck([worktree], [echo]).ok, true);
  assert.equal(reviewCheck([worktree], [{ ...echo, from: { botId: "nova", name: "Vale" } }]).ok, null);
  assert.equal(reviewCheck([worktree], [{ ...echo, threadId: "other-thread" }]).ok, null);
  assert.equal(reviewCheck([worktree], [{ ...echo, from: undefined }]).ok, null);
});

test("missing native evidence is unknown, and shell parentheses are executable syntax", () => {
  assert.ok(check042({ native: null, reviewer: { id: "vale", name: "Vale" } }).every((c) => c.ok === null));
  assert.equal(bareCommand("date\n(npm test)"), "date\n(npm test)");
  assert.equal(bareCommand("(npm test)"), "(npm test)");
  assert.equal(bareCommand("npm test (some other note)"), "npm test (some other note)");
});

test("approval checks use only native calls and results within the run, and reject failed tool results", () => {
  const ask = toolCall(1000, "ask", "mcp__agents__ask_bot", { bot_id: "vale" });
  const failed = toolReply(2000, "ask", "Approved."); failed.msg.message.content[0].is_error = true;
  assert.equal(reviewCheck([ask, failed, worktree]).ok, null);
  assert.equal(reviewCheck([toolCall(-1000, "ask", "mcp__agents__ask_bot", { bot_id: "vale" }), toolReply(2000, "ask", "Approved."), worktree]).ok, null);
});

test("archive reader obtains reviewer provenance from read-only SQLite and legacy message files", async (t) => {
  const { archivedMessages } = await import("../skills/openmausbot-launcher/scripts/lib/report.mjs");
  const { DatabaseSync } = await import("node:sqlite");
  const dataDir = fs.mkdtempSync("/tmp/oml-report-messages-"); t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  // OpenMausBot 0.1.56 server/message-db.ts:21,39-48,119-127 stores full JSON by thread_id.
  const db = new DatabaseSync(path.join(dataDir, "messages.db"));
  db.exec("CREATE TABLE messages (thread_id TEXT, json TEXT)");
  const echo = { id: "echo", at: reviewStart + 2000, role: "bot", kind: "text", from: { botId: "vale", name: "Vale" }, text: "@Vale replied to the delegated task:\n\nVerdict: approved." };
  db.prepare("INSERT INTO messages VALUES (?, ?)").run("lead-thread", JSON.stringify(echo)); db.close();
  assert.equal(reviewCheck([worktree], await archivedMessages(dataDir, "lead-thread")).ok, true);
  fs.writeFileSync(path.join(dataDir, "messages-legacy.json"), JSON.stringify({ messages: [echo] }));
  assert.deepEqual(await archivedMessages(dataDir, "legacy"), [echo]);
  assert.equal(await archivedMessages(dataDir, "missing"), null);
});

for (const [label, reply, expected] of [
  ["a final negative explanation", "Approved.\nFinal verdict: not ready because the rollback is unsafe.", false],
  ["a trailing condition", "Approved.\nOnly after you fix the blocking race.", null],
  ["a superseding final rejection", "Prior verdict:\nApproved.\nFinal verdict: rejected — unresolved blockers.", false],
  ["an ambiguous final verdict", "Approved.\nFinal verdict: undecided pending the rollback design.", null],
  ["a condition after the final verdict", "Final verdict: approved.\nOnly after the failing test is fixed.", null],
  ["a conditional final approval", "Approved.\nFinal verdict: approved if the rollback passes.", null],
  ["a contradiction in the final verdict", "Final verdict: approved, but not ready.", null],
  ["a final rejection after an earlier explicit approval", "Verdict: approved.\nFinal verdict: reject because the tests fail.", false],
  ["an unresolved contradiction before final approval", "This is not ready because the rollback is unsafe.\nFinal verdict: approved.", null],
]) test(`approval never passes ${label}`, () => {
  const ask = toolCall(1000, "ask", "mcp__agents__ask_bot", { bot_id: "vale" });
  assert.equal(reviewCheck([ask, toolReply(2000, "ask", reply), worktree]).ok, expected);
});

test("the archived T12 reviewer reply has an unqualified final approve verdict", () => {
  // Archived 0.1.56 native eb9e6184-f4ed-4670-8515-a3d474006f50:
  // Vale ask_bot 03:09:05.609Z -> correlated result 03:10:22.421Z, before worktree creation.
  const reply = "Vale replied:\nI’m rechecking the revised plan against the same repository evidence, with attention to the remaining accounting, test coverage, and whether the stated risks match the actual edits. I’ll remain read-only.\n1. **Low (non-blocking)** — The risk section says “six edits,” but Step 3 lists seven affected test methods/edit groups. Clarify the count for consistency.\n\nAll substantive issues are addressed: the invalid fixtures are fully accounted for, non-string separators are covered, acceptance criteria and tests are complete, scope is minimal, and no human decision remains.\n\n**Verdict: approve**";
  const ask = toolCall(1000, "ask", "mcp__agents__ask_bot", { bot_id: "vale" });
  assert.equal(reviewCheck([ask, toolReply(2000, "ask", reply), worktree]).ok, true);
});

for (const preamble of [
  "I cannot approve this plan as written.",
  "The plan still needs changes before work can begin.",
  "Approval depends on fixing issue 17 first.",
  "I can't recommend proceeding with this plan.",
  "The implementation should wait for the race fix.",
  "The rollback must be corrected.",
  "This requires another review pass.",
  "Proceed if the migration checks pass.",
  "Approval is contingent upon resolving the race.",
  "Assuming the blocker is fixed, proceed.",
  "The design is not acceptable.",
  "Approval is withheld until the evidence arrives.",
  "There are outstanding changes to make.",
  "I disapprove of the proposed rollback.",
  "Approval is denied for this implementation.",
  "No approval is granted for starting work.",
]) test(`approval is unknown despite final approval when context says: ${preamble}`, () => {
  const ask = toolCall(1000, "ask", "mcp__agents__ask_bot", { bot_id: "vale" });
  assert.equal(reviewCheck([ask, toolReply(2000, "ask", `${preamble}\nVerdict: approved.`), worktree]).ok, null);
});

const CODEX_LOG = path.join(ROOT, "tests", "fixtures", "native", "codex-lead.ndjson");
const CODEX_STAMP = "2026-09-08T11:13:54Z"; // what the fixture's `date -u +%FT%TZ` printed
// Real 0.1.56 codex.app-server records (native/712f8a5f-7b2d-4023-9f3b-8fc0ce218efa.ndjson, the T9 lead
// thread, trimmed; the date -u pair is from native/aec43e24-af2b-413d-95a6-32cec24e2e1e.ndjson).
const codexEntries = () => fs.readFileSync(CODEX_LOG, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));

test("nativeCalls reads a Codex lead's app-server items and normalises them like Claude tool blocks", () => {
  // OpenMausBot 0.1.56 server/drivers/codex.ts:903 logs every incoming app-server line; only
  // item/started and item/completed carry tool items, keyed by the same item.id.
  const n = nativeCalls(codexEntries());
  assert.deepEqual(n.calls.map((c) => c.name), ["mcp__agents__list_bots", "mcp__agents__ask_bot", "Bash", "Bash"]);
  const ask = n.calls.find((c) => c.name === "mcp__agents__ask_bot");
  assert.equal(ask.id, "exec-a2aaa8f8-2cc3-455e-857b-b16f47e3a440"); assert.equal(ask.at, "2026-09-07T11:52:02.239Z"); assert.equal(ask.input.bot_id, "f6826a89-d501-41f0-95e7-86f26f1d5208");
  const reply = n.results.get(ask.id);
  assert.equal(reply.ok, true); assert.equal(reply.at, "2026-09-07T11:53:33.771Z"); assert.match(reply.content, /^Vale replied:\n/); assert.match(reply.content, /\*\*Verdict: approve\*\*$/);
  const [worktree, date] = n.calls.filter((c) => c.name === "Bash");
  assert.equal(worktree.input.command, "/bin/bash -lc 'git worktree add -b task/t9-unique-slug-predicate .worktrees/t9-unique-slug-predicate main'");
  assert.equal(worktree.at, "2026-09-07T11:54:14.966Z", "a command is dated by its item/started");
  assert.equal(n.results.get(worktree.id).ok, true);
  assert.equal(n.results.get(date.id).content, `${CODEX_STAMP}\n`, "aggregatedOutput is the tool result");
  assert.deepEqual(n.texts.map((x) => x.role), ["user", "assistant"]);
  assert.match(n.texts[1].text, /^Vale approved the plan/); assert.equal(n.texts[1].at, "2026-09-07T11:53:55.589Z", "agentMessage text comes from item/completed only");
  // A denied MCP call (verbatim from a real log): status failed, result null, error message.
  const denied = { at: "2026-09-08T11:18:55.662Z", dir: "in", source: "codex.app-server", msg: { method: "item/completed", params: { item: { type: "mcpToolCall", id: "exec-65871e7f-cd07-4f8e-9102-78207ba0ccae", server: "agents", tool: "ask_bot", status: "failed", arguments: { bot_id: "fe2bbf47-7765-40eb-824f-efd32daba949", message: "Reply with the single word PONG" }, appContext: null, pluginId: null, readOnlyHint: null, result: null, error: { message: "user rejected MCP tool call" }, durationMs: 0 }, threadId: "01a080b9-488f-77f0-b09b-c003d5b45871", turnId: "01a080bd-a718-7a42-8d0d-4eb5c34fddf0", completedAtMs: 1788866335655 }, emittedAtMs: 1788866335661 } };
  const d = nativeCalls([denied]);
  assert.equal(d.calls.length, 1, "a completed item whose started line is missing still counts as a call");
  assert.deepEqual(d.results.get("exec-65871e7f-cd07-4f8e-9102-78207ba0ccae"), { at: denied.at, ok: false, content: "" });
  // One thread file can mix engines after a rebind: dispatch is per entry.
  const claude = { at: "2026-09-07T11:27:49.160Z", dir: "in", source: "claude.sdk.message", msg: { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_01WBh48HhYE4eKkziFiF1VAZ", name: "ListAgents", input: {} }] } } };
  assert.deepEqual(nativeCalls([claude, ...codexEntries()]).calls.map((c) => c.name), ["ListAgents", "mcp__agents__list_bots", "mcp__agents__ask_bot", "Bash", "Bash"]);
});

test("check042 on the Codex lead fixture: approval before the worktree, the date -u stamp, list_bots without ListAgents", () => {
  const native = codexEntries();
  const sentAt = Date.parse("2026-09-07T11:47:36.502Z");
  const reviewer = { id: "f6826a89-d501-41f0-95e7-86f26f1d5208", name: "Vale" };
  const by = Object.fromEntries(check042({ native, taskLogText: `# Progress\n\n### ${CODEX_STAMP} — Sudo\nT9 merged.\n`, reviewer, sentAt }).map((c) => [c.id, c]));
  assert.equal(by["worktree-after-approval"].ok, true, by["worktree-after-approval"].detail);
  assert.match(by["worktree-after-approval"].detail, /reply at 2026-09-07T11:53:33\.771Z: approved; git worktree add at 2026-09-07T11:54:14\.966Z/);
  assert.equal(by["record-time-from-date-u"].ok, true, by["record-time-from-date-u"].detail);
  assert.equal(by["no-host-listagents"].ok, true, by["no-host-listagents"].detail);
  assert.equal(check042({ native, taskLogText: "### 2026-09-08T11:00:00Z — Sudo", reviewer, sentAt }).find((c) => c.id === "record-time-from-date-u").ok, false);
  assert.equal(check042({ native, taskLogText: null, reviewer: { id: "someone-else", name: "Nova" }, sentAt }).find((c) => c.id === "worktree-after-approval").ok, null);
});

test("report --check-042 reads a Codex lead's native log through the fake", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { dir, git } = makeRepo();
  const env = { OMB_TOKEN: "", OMB_DATA_DIR: f.dataDir };
  fs.writeFileSync(path.join(dir, "PROGRESS.md"), "# Progress log\n\n### 2026-09-01T00:00:00Z — seed\nSeed entry.\n");
  git("add", "-A"); git("commit", "-q", "-m", "seed");
  assert.equal((await runOmb(["import", PKG, "--project", dir, "--url", f.url], { env })).code, 0);
  assert.equal((await runOmb(["bind", "--project", dir, "--default", "codex/gpt-6-astra/xhigh"], { env })).code, 0);
  assert.equal((await runOmb(["facts", "--project", dir, "--test", "node -e 'process.exit(0)'", "--task-log", "PROGRESS.md"], { env })).code, 0);
  const run = await runOmb(["task", "--todo", "T9", "--project", dir], { env });
  assert.equal(run.code, 0, run.stdout);
  const st = loadState(statePaths(dir)); const lt = run.json.leadThreadId;
  const vale = st.team.bots.find((b) => /plan review/i.test(b.title));
  // The fixture re-timed into this run: same relative order, first entry one second after dispatch, ask_bot aimed at this team's reviewer.
  const entries = codexEntries(); const base = Date.parse(entries[0].at);
  const native = entries.map((e) => { const item = e.msg.params.item; if (item.arguments?.bot_id) item.arguments.bot_id = vale.id; return { ...e, at: iso(run.json.sentAt + 1000 + Date.parse(e.at) - base) }; });
  fs.mkdirSync(path.join(f.dataDir, "native"), { recursive: true });
  fs.writeFileSync(path.join(f.dataDir, "native", `${lt}.ndjson`), native.map((e) => JSON.stringify(e)).join("\n") + "\n");
  fs.writeFileSync(path.join(dir, "feature.txt"), "done\n"); git("add", "-A"); git("commit", "-q", "-m", "feat: T9");
  const merged = git("rev-parse", "HEAD").trim();
  fs.writeFileSync(path.join(dir, "PROGRESS.md"), `# Progress log\n\n### ${CODEX_STAMP} — Sudo\nT9 merged as ${merged.slice(0, 7)}.\n\n### 2026-09-01T00:00:00Z — seed\nSeed entry.\n`);
  git("add", "-A"); git("commit", "-q", "-m", `docs(team): T9 merged as ${merged.slice(0, 7)}`);
  await f.control({ op: "leadSay", threadId: lt, text: `Closing report: T9 merged as ${merged}.\n\nDONE ${run.json.tag}` });
  assert.equal((await runOmb(["watch", "--project", dir, "--max-seconds", "10", "--quiet-seconds", "1", "--poll", "1"], { env })).json.state, "done");
  const r = await runOmb(["report", "--project", dir, "--check-042"], { env });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const by = Object.fromEntries(r.json.check042.map((c) => [c.id, c]));
  assert.equal(by["worktree-after-approval"].ok, true, by["worktree-after-approval"].detail);
  assert.equal(by["record-time-from-date-u"].ok, true, by["record-time-from-date-u"].detail);
  assert.equal(by["no-host-listagents"].ok, true, by["no-host-listagents"].detail);
  assert.equal(by["merged-ancestor"].ok, true); assert.equal(by["record-commit"].ok, true);
  assert.deepEqual([...r.json.nativeTools].sort(), ["Bash", "mcp__agents__ask_bot", "mcp__agents__list_bots"]);
});

test("beadStatus gives up on a hung bd within its timeout", (t) => {
  const bin = tmpDir("oml-bd-hang-");
  fs.writeFileSync(path.join(bin, "bd"), "#!/bin/sh\nsleep 5\n", { mode: 0o755 });
  const previous = process.env.PATH; process.env.PATH = `${bin}:${previous}`; t.after(() => { process.env.PATH = previous; });
  const started = performance.now();
  const r = beadStatus("slg-1", bin, { timeoutMs: 200 });
  assert.ok(performance.now() - started < 2000, "bd show returned only after sleep finished");
  assert.equal(r.ok, null); assert.match(r.detail, /^bd show slg-1 unavailable: spawnSync bd ETIMEDOUT/);
});
