import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startFake, makeRepo, runOmb, ROOT } from "./helpers.mjs";
import { statePaths, loadState, updateState } from "../skills/openmausbot-launcher/scripts/lib/state.mjs";
import { turnsFromEvents, nativeCalls, check042, renderMarkdown, bareCommand, mergedShaFrom } from "../skills/openmausbot-launcher/scripts/lib/report.mjs";

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
    { at: iso(t0 + 5000), msg: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "d", content: "@Vale replied to the delegated task:\n\nPlan approved: ready." }] } } },
    { at: iso(t0 + 9000), msg: { type: "assistant", message: { content: [{ type: "tool_use", id: "w", name: "Bash", input: { command: "git worktree add -b task/t10 .worktrees/t10 main" } }] } } },
    { at: iso(t0 + 20_000), msg: { type: "assistant", message: { content: [{ type: "tool_use", id: "t", name: "Bash", input: { command: "date -u +%FT%TZ" } }] } } },
    { at: iso(t0 + 21_000), msg: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t", content: `${stamp}\n` }] } } },
  ];
  let checks = check042({ native, taskLogText: `# Progress\n\n### ${stamp} — Sudo\nT10 merged.\n\n### 2026-09-01T00:00:00Z — old\n`, reviewerName: "Vale", sentAt: t0 });
  const by = Object.fromEntries(checks.map((c) => [c.id, c]));
  assert.equal(by["worktree-after-approval"].ok, true); assert.equal(by["record-time-from-date-u"].ok, true); assert.equal(by["no-host-listagents"].ok, true);
  const early = native.map((e) => (e.msg.message.content[0].id === "w" ? { ...e, at: iso(t0 + 2000) } : e));
  checks = check042({ native: early, taskLogText: `### ${stamp} — Sudo`, reviewerName: "Vale", sentAt: t0 });
  assert.equal(checks.find((c) => c.id === "worktree-after-approval").ok, false);
  checks = check042({ native: [...native, { at: iso(t0 + 3000), msg: { type: "assistant", message: { content: [{ type: "tool_use", id: "x", name: "ListAgents", input: {} }] } } }], taskLogText: `### 2026-09-08T01:31:00Z — Sudo`, reviewerName: "Vale", sentAt: t0 });
  assert.equal(checks.find((c) => c.id === "no-host-listagents").ok, false); assert.equal(checks.find((c) => c.id === "record-time-from-date-u").ok, false);
  checks = check042({ native: [], taskLogText: null, reviewerName: "Vale", sentAt: t0 });
  assert.ok(checks.every((c) => c.ok === null || c.id === "no-host-listagents"));
});

test("report: a full synthetic run passes --check-042, renders markdown, and closes the run; a failing suite fails it", async (t) => {
  const f = await startFake(); t.after(() => f.close());
  const { dir, git } = makeRepo();
  const env = { OMB_TOKEN: "", OMB_DATA_DIR: f.dataDir };
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
  assert.equal(r.json.record.commit.length, 40); assert.equal(r.json.record.taskLogChanged, true); assert.equal(r.json.record.bead.ok, null);
  assert.equal(r.json.tests.ok, true);
  assert.equal(r.json.threads.find((x) => x.bot === "Sudo").turns, 2); assert.equal(r.json.threads.find((x) => x.bot === "Nova").totals.input, 500);
  assert.ok(r.json.check042.every((c) => c.ok !== false), JSON.stringify(r.json.check042));
  const after = loadState(statePaths(dir));
  assert.equal(after.task, null); assert.equal(after.history.at(-1).result, "passed"); assert.equal(after.history.at(-1).runId, run.json.runId);
  const md = renderMarkdown(r.json);
  assert.match(md, /^## \d{4}-\d{2}-\d{2} — T10 \(passed\)/); assert.match(md, /\| Sudo \| 2 \|/); assert.match(md, /- merged-ancestor: yes/);
  r = await runOmb(["report", "--project", dir], { env });
  assert.equal(r.code, 3); assert.match(r.json.error, /no open run/); assert.match(r.json.hint, /--run last/);
  r = await runOmb(["report", "--project", dir, "--run", "last", "--check-042"], { env });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.reReported, true); assert.equal(r.json.result, "passed"); assert.equal(r.json.runId, run.json.runId);
  assert.equal(loadState(statePaths(dir)).history.at(-1).report.reReportedAt !== undefined, true);
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
