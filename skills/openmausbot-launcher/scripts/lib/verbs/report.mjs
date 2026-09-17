// Historical and live evidence reports.
import fs from "node:fs";
import path from "node:path";
import { verb, EXIT, Fail } from "../cli.mjs";
import { resolveConfig } from "../config.mjs";
import { createClient } from "../http.mjs";
import { snapshot, evaluate, carriedVerdict, delegationWindows, DEFAULTS, TERMINAL as TERMINAL_STATES } from "../snapshot.mjs";
import { updateState } from "../state.mjs";
import { openRuns, selectRun, runLabel } from "../runs.mjs";
import { requireTeam, requireDataDir, requireSameEnvironment, runContext } from "../session.mjs";
import { readNdjson, turnsFromEvents, nativeCalls, check042, beadStatus, commitsSince, runTests, renderMarkdown, mergedShaFrom, historicalContext, archivedMessages, namesRun, taskLogEntry, allocateTurns, totalsOf, secondsOf } from "../report.mjs";
import { reconcileCheck as rootCheck, git as gitRun } from "../git.mjs";

verb("report", {
  options: { md: { type: "boolean" }, "check-042": { type: "boolean" }, "no-tests": { type: "boolean" }, close: { type: "boolean" }, "no-close": { type: "boolean" }, run: { type: "string" } },
  handler: async ({ flags }) => {
    const cfg = resolveConfig(flags);
    const history = cfg.state?.history ?? [];
    const open = openRuns(cfg.state);
    let task = null;
    if (flags.run) task = selectRun(cfg.state, flags.run);
    else if (open.length > 1) throw new Fail(EXIT.PRECONDITION, `${open.length} runs are open; pass --run`, { hint: open.map(runLabel).join(", ") });
    else task = open[0] ?? null;
    if (!task) throw new Fail(EXIT.PRECONDITION, "no open run to report", { hint: history.length ? "report --run last re-reports the last closed run" : "the history is empty" });
    const fromHistory = task.status === "closed";

    let context; let team; let snap; let ev; let env;
    if (fromHistory) {
      context = historicalContext(task, cfg.state, flags["data-dir"]);
      cfg.dataDir = context.dataDir;
      team = context.team;
      // A closed evaluation describes the past. It is not a fresh live snapshot.
      ev = { state: task.report?.state ?? task.lastEval?.state ?? "unknown", historical: true };
      snap = { outcomes: task.report?.outcomes ?? task.lastEval?.outcomes ?? [], leadText: { text: task.report?.closing ?? task.lastEval?.evidence?.leadText?.text ?? null } };
      env = context.server;
    } else {
      requireDataDir(cfg, "report");
      team = requireTeam(cfg);
      const client = createClient(cfg);
      env = await requireSameEnvironment(cfg, client);
      context = { ...runContext(cfg), ok: true, source: "active run" };
      snap = await snapshot(client, { team, task, runs: open, history: cfg.state?.history }, { dataDir: cfg.dataDir });
      ev = evaluate(snap, task, { quiet: { since: null }, lastChangeAt: task.lastEval?.lastChangeAt ?? task.sentAt ?? null });
      const prior = carriedVerdict(snap, task);
      if (ev.state === "running" && prior) ev = { ...ev, state: prior, carried: true };
    }
    const sinceMs = task.sentAt ?? 0;
    const untilMs = task.closedAt ? Date.parse(task.closedAt) : Date.now();
    const readLog = (folder, threadId) => cfg.dataDir ? readNdjson(path.join(cfg.dataDir, folder, `${threadId}.ndjson`)) : null;
    const messages = fromHistory ? context.ok ? await archivedMessages(cfg.dataDir, task.leadThreadId) : null : snap.leadTail;
    // A thread another run also recorded carries both runs' turns. Only the
    // ones inside this run's open-delegation windows are this run's; the rest
    // are counted as shared rather than claimed (design, "Attribution").
    const windows = delegationWindows(messages ?? [], sinceMs);
    // Every other dispatch, open or closed: their threads are shared, and their
    // names can stand in the same task log and the same closing text as this one.
    const others = [...(cfg.state?.history ?? []), ...Object.values(cfg.state?.runs ?? {})].filter((r) => r.runId !== task.runId);
    const elsewhere = new Set(others.flatMap((other) => Object.values(other.threads ?? {})));
    const counted = new Set();
    const threads = Object.entries(task.threads ?? {}).map(([botId, threadId]) => {
      const bot = team?.bots.find((b) => b.id === botId);
      const events = context.ok ? readLog("events", threadId) : null;
      const t = turnsFromEvents(events, sinceMs);
      const shareable = elsewhere.has(threadId) && threadId !== task.leadThreadId;
      const { mine, shared } = shareable ? allocateTurns(t.turns, windows[bot?.name] ?? []) : { mine: t.turns, shared: 0 };
      for (const turn of mine) counted.add(`${threadId}:${turn.turnId}`);
      return { bot: bot?.name ?? botId, threadId, available: events !== null, turns: mine.length, shared, seconds: secondsOf(mine), totals: totalsOf(mine), models: [...new Set(mine.map((x) => x.model).filter(Boolean))] };
    });
    const native = context.ok ? readLog("native", task.leadThreadId) : null;
    // Only commits inside this run's own window, naming this run.
    const commits = commitsSince(cfg.projectDir, task.sentSha).filter((c) => !Number.isFinite(c.at) || (c.at + 999 >= sinceMs && c.at <= untilMs + 1000));
    const facts = context.facts ?? {};
    const taskLog = facts.taskLog && facts.taskLog !== "none" ? facts.taskLog : null;
    const taskLogText = taskLog ? (() => { try { return fs.readFileSync(path.join(cfg.projectDir, taskLog), "utf8"); } catch { return null; } })() : null;
    const recordCommit = taskLog ? commits.find((c) => /^docs\(team\): .* merged as [0-9a-f]{7,}/.test(c.subject) && namesRun(c.subject, task) && c.files.length > 0 && c.files.every((f) => f === taskLog || f.startsWith(".beads/"))) : null;
    const logEntry = taskLog ? taskLogEntry(taskLogText, task, { others, sinceMs, untilMs }) : null;
    // The task log moved for this run when a commit in its window touched it
    // AND the log carries an entry that names the run. A log that cannot be
    // read — deleted, or unreadable — proves neither, so it stays unknown: a
    // commit that touches the path is not evidence that a record was written.
    const taskLogChanged = !taskLog ? null : taskLogText === null ? null : commits.some((c) => c.files.includes(taskLog)) && logEntry !== null;
    const bead = { ...beadStatus(task.bead, cfg.projectDir), applicable: Boolean(task.bead) };
    const closing = snap.leadText?.text ?? null;
    const mergedSha = mergedShaFrom(closing, recordCommit?.subject, { run: task, others });
    // Tests are required evidence even when unset or intentionally skipped.
    const tests = flags["no-tests"] || cfg.dryRun || !context.ok ? { ran: false, ok: null, detail: cfg.dryRun ? "skipped: dry run" : flags["no-tests"] ? "skipped with --no-tests" : "unknown run facts" } : runTests(facts.test, cfg.projectDir);
    tests.applicable = true;
    // A passing suite can dirty the checkout; observe the root after it ran.
    // Per run: the worktrees and branches the other open runs own are theirs,
    // not leftovers. Closing the last run checks the whole repository again.
    const owners = open.filter((r) => r.runId !== task.runId);
    const reconcile = rootCheck(cfg.projectDir, facts, { runs: owners });
    const ownersChecked = owners.map((r) => r.runId).sort().join(",");
    let ancestor = null;
    if (mergedSha) { try { gitRun(["merge-base", "--is-ancestor", mergedSha, reconcile.defaultBranch], cfg.projectDir); ancestor = true; } catch { ancestor = false; } }
    const recordRequired = taskLog !== null || Boolean(task.bead);
    const recordChecks = [
      ...(taskLog ? [{ id: "task-log-changed", ok: taskLogChanged }, { id: "record-commit", ok: Boolean(recordCommit) }] : []),
      ...(task.bead ? [{ id: "bead-closed", ok: bead.ok }] : []),
    ];
    const record = { taskLog, taskLogChanged, taskLogEntry: logEntry, commit: recordCommit?.sha ?? null, commitSubject: recordCommit?.subject ?? null, bead, applicable: recordRequired, ok: !recordRequired ? null : recordChecks.some((c) => c.ok === false) ? false : recordChecks.every((c) => c.ok === true) ? true : null };
    let checks = null;
    if (flags["check-042"]) {
      const reviewer = team?.bots.find((b) => /plan review/i.test(b.title ?? ""));
      checks = check042({ native, messages: messages ?? [], leadThreadId: task.leadThreadId, taskLogText, taskLogEntry: taskLog ? logEntry : undefined, reviewer, sentAt: sinceMs });
      checks.push({ id: "bead-closed", ok: bead.ok, detail: bead.detail });
      checks.push({ id: "record-commit", ok: taskLog ? Boolean(recordCommit) : null, detail: recordCommit ? `${recordCommit.sha.slice(0, 7)} ${recordCommit.subject} (${recordCommit.files.join(", ")})` : "no attributable docs(team) record commit since dispatch" });
      checks.push({ id: "merged-ancestor", ok: ancestor, detail: mergedSha ? `${mergedSha.slice(0, 7)} ${ancestor ? "is" : "is not"} an ancestor of ${reconcile.defaultBranch}` : "the closing report names no merged commit" });
      // The other open runs' branches and worktrees are theirs; this asks that
      // nothing is left with no owner, and with no run open that is everything.
      checks.push({ id: "task-branch-and-worktree-absent", ok: reconcile.unownedBranches.length === 0 && reconcile.unownedWorktrees.length === 0, detail: `${reconcile.unownedBranches.length} task branch(es) and ${reconcile.unownedWorktrees.length} worktree(s) with no owner; ${reconcile.taskBranches.length} task branch(es) and ${reconcile.worktrees.length - 1} worktree(s) in all` });
      checks.push({ id: "root-clean", ok: reconcile.clean, detail: reconcile.clean ? "clean" : reconcile.problems.join("; ") });
      checks.push({ id: "tests-pass", ok: tests.ok, detail: tests.ran ? `exit ${tests.status} in ${tests.seconds} s` : tests.detail });
    }
    const evidence = [
      { id: "run-context", ok: context.ok },
      { id: "run-done", ok: ev.state === "done" ? true : ev.state === "unknown" || ev.unknown ? null : false },
      { id: "tests-pass", ok: tests.ok }, { id: "root-clean", ok: reconcile.clean },
      ...recordChecks, ...(mergedSha ? [{ id: "merged-ancestor", ok: ancestor }] : []), ...(checks ?? []),
    ];
    const unknown = [...new Set(evidence.filter((c) => c.ok == null).map((c) => c.id))];
    const failedChecks = [...new Set(evidence.filter((c) => c.ok === false).map((c) => c.id))];
    const result = ev.state === "failed" || tests.ok === false ? "failed" : evidence.every((c) => c.ok === true) ? "passed" : "incomplete";
    const shouldClose = !fromHistory && !flags["no-close"] && (TERMINAL_STATES.has(ev.state) || flags.close);
    // One live snapshot cannot see a quiet window, so an idle run reads as
    // running here however long it has been idle. Say what does settle it, but
    // only where the window alone would (`quietSettles`): a run whose lead owes
    // a wake or an answer needs the lead, not a longer watch. `--close` is the
    // operator recording the run as it is, and asks nothing.
    const quietSeconds = Math.round(DEFAULTS.quietMs / 1000);
    const ref = task.slug ?? task.runId;
    const settlement = !fromHistory && snap.complete && !ev.carried && ev.state === "running" && ev.quietSettles === true && !flags.close
      ? `the run has not settled; run watch --run ${ref} with --max-seconds ${quietSeconds + 5} or more (${quietSeconds} s default quiet window) until it settles, then report --run ${ref} again; report --close records the current result without establishing settlement`
      : null;
    const report = {
      date: new Date().toISOString().slice(0, 10), runId: task.runId, tag: task.tag, title: task.title, slug: task.slug, branch: task.branch ?? null, implementer: task.implementer ?? null, openRuns: open.filter((r) => r.runId !== task.runId).map((r) => r.slug ?? r.runId), project: cfg.projectDir, version: env?.version ?? context.server?.version ?? null,
      lead: team?.lead.name ?? "unknown", leadModel: team?.lead.model ?? null, sentAt: task.sentAt ? new Date(task.sentAt).toISOString() : null, sentSha: task.sentSha, state: ev.state, carried: ev.carried === true, result, hint: settlement ?? undefined,
      historical: fromHistory, contextSource: context.source, unknown, failedChecks,
      threads, outcomes: snap.outcomes, commits, record, tests, reconcile: { clean: reconcile.clean, problems: reconcile.problems, defaultBranch: reconcile.defaultBranch }, mergedSha, ancestor, check042: checks, closing, decisions: null,
      nativeTools: [...new Set(nativeCalls(native).calls.map((c) => c.name))], durationSec: fromHistory ? task.report?.durationSec ?? null : task.sentAt ? Math.round((Date.now() - task.sentAt) / 1000) : null, closed: false,
    };
    if (shouldClose && !cfg.dryRun) {
      await updateState(cfg.paths, (d) => {
        if (JSON.stringify(d.runs?.[task.runId]) !== JSON.stringify(task)) throw new Fail(EXIT.PRECONDITION, "the run changed while reporting; report again");
        // The repository check above counted the other open runs' worktrees and
        // branches as theirs. If one of them closed meanwhile, those are nobody's
        // now and this run cannot pass on a check that no longer describes the repository.
        if (openRuns(d).filter((r) => r.runId !== task.runId).map((r) => r.runId).sort().join(",") !== ownersChecked) {
          throw new Fail(EXIT.PRECONDITION, "the other open runs changed while reporting; report again", { hint: "the repository check for this run treated their worktrees and branches as theirs" });
        }
        if (JSON.stringify(d.facts) !== JSON.stringify(cfg.state.facts) || JSON.stringify(d.team) !== JSON.stringify(cfg.state.team) || JSON.stringify(d.server) !== JSON.stringify(cfg.state.server)) throw new Fail(EXIT.PRECONDITION, "the run context changed while reporting; report again");
        const closedRun = { ...d.runs[task.runId], context: runContext({ ...cfg, state: d }), status: "closed", result, closedAt: new Date().toISOString(), report: { state: ev.state, result, mergedSha, recordCommit: record.commit, tests: tests.ok, durationSec: report.durationSec, closing, outcomes: snap.outcomes, unknown, failedChecks } };
        d.history = [...(d.history ?? []), closedRun]; delete d.runs[task.runId]; return d;
      });
      report.closed = true;
    }
    if (fromHistory && !cfg.dryRun) {
      await updateState(cfg.paths, (d) => {
        const matches = (d.history ?? []).filter((h) => h.runId === task.runId);
        if (matches.length !== 1 || JSON.stringify(matches[0]) !== JSON.stringify(task)) throw new Fail(EXIT.PRECONDITION, "the closed run changed while reporting; report again");
        matches[0].reanalysis = [...(matches[0].reanalysis ?? []), { at: new Date().toISOString(), report: structuredClone({ ...report, closed: true }) }];
        return d;
      });
      report.closed = true; report.reReported = true;
    }
    const md = renderMarkdown(report);
    return { code: result === "failed" ? EXIT.STALLED : EXIT.OK, ok: result !== "failed", result: { ...report, markdown: flags.md ? md : undefined }, brief: flags.md ? md : `report · ${task.title} · ${fromHistory ? "historical " : ""}${ev.state} · ${result}${report.closed ? " · run closed" : " · run left open"}${tests.ran ? ` · tests ${tests.ok ? "passed" : "FAILED"}` : ""}${settlement ? ` · ${settlement}` : ""}` };
  },
});
