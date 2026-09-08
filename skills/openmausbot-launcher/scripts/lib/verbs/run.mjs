// status (and, in later steps, task, send, answer, interrupt, watch).
import fs from "node:fs";
import path from "node:path";
import { verb, EXIT, Fail, VERBS } from "../cli.mjs";
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

// ── task, send, answer, interrupt (design: "Task lifecycle") ──
import { createHash, randomBytes } from "node:crypto";
import { withLock, loadState, commitState, updateState, initState } from "../state.mjs";
import { HttpError, precondition } from "../http.mjs";
import { reconcileCheck, git } from "../git.mjs";
import * as srv from "../server.mjs";
import { findBot } from "../team.mjs";
import { markerLine } from "../snapshot.mjs";

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "run";
const tagOf = (runId) => `oml:${runId.slice(0, 8)}`;

export function composeBrief({ leadName, brief, todo, bead, facts, tag }) {
  let text = brief;
  if (!text) {
    const test = facts?.test && facts.test !== "<fill in>" ? facts.test : null;
    text = `${leadName}, do ${todo} from TODO.md in this project.${test ? ` Test command: ${test} (run inside the task's worktree).` : ""}${facts?.setup ? ` Setup command: ${facts.setup}.` : ""}${bead ? ` Bead: ${bead}.` : ""}`;
  } else if (bead && !/\bBead:/.test(text)) text = `${text.trimEnd()} Bead: ${bead}.`;
  return `${text.trimEnd()}\n\nWhen the task is finished, end your closing report with a line containing only \`${markerLine(tag)}\`.`;
}

async function requireSameEnvironment(cfg, client) {
  const env = await srv.environment(client);
  const recorded = cfg.state?.team?.environmentId;
  if (recorded && env?.environmentId && env.environmentId !== recorded) throw new Fail(EXIT.PRECONDITION, "the server is not the one this team was imported on", { hint: "re-import the package or run import --adopt" });
}

/** The tasks on a bot whose title carries this run's tag. */
const taggedTasks = (bot, tag) => (bot.tasks ?? []).filter((t) => typeof t.title === "string" && t.title.includes(`[${tag}]`));

verb("task", {
  options: { todo: { type: "string" }, bead: { type: "string" }, title: { type: "string" }, resume: { type: "boolean" }, abandon: { type: "boolean" }, "no-fresh-threads": { type: "boolean" } },
  allowPositionals: true,
  handler: async ({ flags, positionals }) => {
    const cfg = resolveConfig(flags);
    if (cfg.mode === "remote") throw new Fail(EXIT.PRECONDITION, "task needs the project checkout on the server's machine", { hint: "remote hosts can status, watch, send, answer, and interrupt" });
    const team = requireTeam(cfg);
    const current = cfg.state.task && cfg.state.task.status !== "closed" ? cfg.state.task : null;
    if (flags.abandon) {
      if (!current) throw new Fail(EXIT.PRECONDITION, "no open run to abandon");
      if (cfg.dryRun) return { result: { dryRun: true, abandon: current.runId } };
      const doc = await updateState(cfg.paths, (d) => { const t = { ...d.task, status: "closed", result: "abandoned", closedAt: new Date().toISOString() }; d.history = [...(d.history ?? []), t]; d.task = null; return d; });
      return { result: { abandoned: current.runId, title: current.title, history: doc.history.length }, brief: `task · abandoned ${current.title}` };
    }
    const client = createClient(cfg);
    await requireSameEnvironment(cfg, client);
    const briefArg = positionals[0];
    if (flags.resume) {
      if (!current) throw new Fail(EXIT.PRECONDITION, "no open run to resume", { hint: "start one with task" });
      if (briefArg || flags.todo) throw new Fail(EXIT.USAGE, "--resume continues the recorded run; it takes no new brief");
    } else {
      if (current) throw new Fail(EXIT.PRECONDITION, `a run is ${current.status}: ${current.title} (${current.runId})`, { hint: "task --resume continues it; task --abandon closes it; report closes a finished one" });
      if (!briefArg && !flags.todo) throw new Fail(EXIT.USAGE, 'usage: task "<brief>" | task --todo T10 [--bead ID] [--title T]');
    }
    // Read-only preconditions (design step 1).
    const fleet = await client.get("/api/bots?messages=0");
    const teamMap = await client.get("/api/team-map");
    const ids = new Set(team.bots.map((b) => b.id));
    const live = (fleet.bots ?? []).filter((b) => ids.has(b.id) || (team.section && b.section === team.section && !b.hidden));
    const busy = live.filter((b) => b.busy);
    if (busy.length) throw new Fail(EXIT.PRECONDITION, `bots are working: ${busy.map((b) => b.name).join(", ")}`, { hint: "wait, or interrupt" });
    const inflight = [...(teamMap.queued ?? []), ...(teamMap.running ?? [])].filter((e) => ids.has(e.sourceBotId) && ids.has(e.targetBotId));
    if (inflight.length) throw new Fail(EXIT.PRECONDITION, `${inflight.length} delegation(s) queued or running`, { hint: "wait for them to settle" });
    const check = reconcileCheck(cfg.projectDir, cfg.state.facts);
    if (!check.clean) throw new Fail(EXIT.PRECONDITION, `the repository is not reconciled: ${check.problems.join("; ")}`, { hint: "run reconcile; a stopped task keeps its worktree until you pass --remove <slug>" });
    const leadLive = live.find((b) => b.id === team.lead.id);
    if (!leadLive) throw new Fail(EXIT.PRECONDITION, `the lead ${team.lead.name} is not on the server`);
    const sentSha = git(["rev-parse", "HEAD"], cfg.projectDir);
    if (cfg.dryRun && !flags.resume) {
      const runId = randomBytes(8).toString("hex"); const tag = tagOf(runId);
      const title = flags.title ?? flags.todo ?? briefArg.split("\n")[0].slice(0, 60);
      return { result: { dryRun: true, title, tag, brief: composeBrief({ leadName: team.lead.name, brief: briefArg, todo: flags.todo, bead: flags.bead, facts: cfg.state.facts, tag }), threadsFor: live.map((b) => b.name) } };
    }
    // Everything from here runs under the lock (design steps 2-4).
    return withLock(cfg.paths, async () => {
      let doc = loadState(cfg.paths) ?? initState(cfg.projectDir);
      let run = doc.task && doc.task.status !== "closed" ? doc.task : null;
      if (flags.resume) { if (!run) throw new Fail(EXIT.PRECONDITION, "the run was closed by another launcher"); }
      else {
        if (run) throw new Fail(EXIT.PRECONDITION, `a run is ${run.status}: ${run.title}`, { hint: "another launcher started it; task --resume or task --abandon" });
        const runId = randomBytes(8).toString("hex"); const tag = tagOf(runId);
        const title = flags.title ?? flags.todo ?? briefArg.split("\n")[0].slice(0, 60);
        run = { runId, status: "preparing", slug: slugify(title), title, tag, brief: composeBrief({ leadName: team.lead.name, brief: briefArg, todo: flags.todo, bead: flags.bead, facts: doc.facts, tag }), bead: flags.bead ?? null,
          sendId: `task-${runId}`, sentAt: null, sentSha, sendReceipt: null, leadThreadId: null, threads: {}, freshThreads: !flags["no-fresh-threads"], createdAt: new Date().toISOString(), nudgedAt: null, lastEval: null };
        doc.task = run; doc = commitState(cfg.paths, doc);
      }
      const threadTitle = `${run.title} [${run.tag}]`;
      const order = [leadLive, ...live.filter((b) => b.id !== leadLive.id)];
      for (const bot of order) {
        if (run.threads[bot.id]) continue;
        let threadId;
        if (!run.freshThreads) threadId = bot.threadId;
        else {
          const tagged = taggedTasks(bot, run.tag);
          if (tagged.length > 1) throw new Fail(EXIT.PRECONDITION, `${bot.name} has ${tagged.length} tasks tagged ${run.tag}`, { hint: "delete the extra task in the app, then task --resume" });
          if (tagged.length === 1) threadId = tagged[0].threadId;
          else {
            let res;
            try { res = await client.post(`/api/bots/${bot.id}/tasks`, { title: threadTitle }); } catch (e) { throw precondition(e, "the bot became busy; task --resume when it is idle"); }
            threadId = res.task?.threadId ?? res.bot?.threadId;
            if (!threadId) throw new Fail(EXIT.ERROR, `no thread id in the task response for ${bot.name}`);
          }
        }
        run.threads[bot.id] = threadId;
        if (bot.id === leadLive.id) run.leadThreadId = threadId;
        doc.task = run; doc = commitState(cfg.paths, doc);
      }
      if (run.status === "preparing") {
        let receipt;
        try { receipt = await client.post(`/api/bots/${leadLive.id}/messages`, { text: run.brief, threadId: run.leadThreadId, sendId: run.sendId }); }
        catch (e) { throw precondition(e, e instanceof HttpError && /switched tasks/.test(e.body?.error ?? "") ? "the lead's active task moved; delete the tagged task or task --abandon" : undefined); }
        run.sentAt = receipt.message?.at ?? Date.now();
        run.sendReceipt = { steered: receipt.steered === true, queued: receipt.queued === true, messageId: receipt.message?.id ?? null, queueId: receipt.queueId ?? null };
        run.status = "dispatched";
        run.lastEval = { state: "running", lastChangeAt: run.sentAt, outcomes: [], quietSince: null, lastLeadMessageId: null, cursor: null, lastReported: null };
        doc.task = run; doc = commitState(cfg.paths, doc);
      }
      return { result: { runId: run.runId, status: run.status, title: run.title, slug: run.slug, tag: run.tag, leadThreadId: run.leadThreadId, threads: run.threads, sentAt: run.sentAt, sentSha: run.sentSha, sendReceipt: run.sendReceipt, resumed: flags.resume === true, brief: run.brief },
        brief: `task · ${run.title} · ${run.status} · lead thread ${run.leadThreadId} · ${Object.keys(run.threads).length} fresh thread(s)` };
    }, { waitMs: 60_000 });
  },
});

const sendIdFor = (scope, threadId, text) => `send-${createHash("sha1").update(`${scope}|${threadId}|${text}`).digest("hex").slice(0, 16)}`;

async function deliver(client, cfg, { botId, threadId, text, sendId }) {
  let receipt;
  try { receipt = await client.post(`/api/bots/${botId}/messages`, { text, threadId, sendId }); }
  catch (e) {
    if (e instanceof HttpError && e.status === 409 && /switched tasks|no longer exists/.test(e.body?.error ?? "")) {
      let active = null; try { active = (await client.get("/api/bots?messages=0")).bots?.find((b) => b.id === botId)?.threadId ?? null; } catch {}
      throw new Fail(EXIT.PRECONDITION, `${e.body.error} (target thread ${threadId})`, { status: 409, hint: `the bot's active task is ${active ?? "unknown"}; nothing was retargeted: pass --thread ${active ?? "<id>"} to send there on purpose` });
    }
    throw precondition(e);
  }
  if (receipt.dryRun) return { dryRun: true, ...receipt };
  return { threadId: receipt.threadId, messageId: receipt.message?.id ?? null, steered: receipt.steered === true, queued: receipt.queued === true, queueId: receipt.queueId ?? null };
}

verb("send", {
  options: { bot: { type: "string" }, thread: { type: "string" } },
  allowPositionals: true,
  handler: async ({ flags, positionals }) => {
    const cfg = resolveConfig(flags);
    const team = requireTeam(cfg);
    const text = positionals.join(" ").trim();
    if (!text) throw new Fail(EXIT.USAGE, 'usage: send "<text>" [--bot <name>] [--thread <id>]');
    const client = createClient(cfg);
    const bot = flags.bot ? findBot(team, flags.bot) : team.lead;
    if (!bot) throw new Fail(EXIT.USAGE, `no team bot named ${flags.bot}`);
    const task = cfg.state.task && cfg.state.task.status !== "closed" ? cfg.state.task : null;
    let threadId = flags.thread ?? (task?.threads?.[bot.id]) ?? null;
    if (!threadId) { const live = (await client.get("/api/bots?messages=0")).bots?.find((b) => b.id === bot.id); threadId = live?.threadId; }
    const sendId = sendIdFor(task?.runId ?? "no-run", threadId, text);
    const r = await deliver(client, cfg, { botId: bot.id, threadId, text, sendId });
    if (!r.dryRun && task) await updateState(cfg.paths, (d) => { if (d.task?.runId === task.runId) d.task.lastEval = { ...(d.task.lastEval ?? {}), lastChangeAt: Date.now() }; return d; });
    return { result: { bot: bot.name, ...r, sendId }, brief: `send · ${bot.name} · ${r.queued ? "queued" : r.steered ? "steered" : "delivered"}` };
  },
});

verb("answer", {
  options: { allow: { type: "boolean" }, deny: { type: "boolean" }, message: { type: "string" }, request: { type: "string" } },
  allowPositionals: true,
  handler: async ({ flags, positionals }) => {
    const cfg = resolveConfig(flags);
    const team = requireTeam(cfg);
    const client = createClient(cfg);
    const bare = positionals.join(" ").trim();
    const modes = [flags.allow && "allow", flags.deny && "deny", flags.message !== undefined && "answer"].filter(Boolean);
    if (modes.length > 1) throw new Fail(EXIT.USAGE, "pass one of --allow, --deny, --message");
    const task = cfg.state.task && cfg.state.task.status !== "closed" ? cfg.state.task : null;
    if (!modes.length) {
      if (!bare) throw new Fail(EXIT.USAGE, 'usage: answer --allow|--deny|--message "<text>" [--request ID]  |  answer "<text>"');
      const out = await VERBS.get("send").handler({ flags: { ...flags }, positionals: [bare], verb: "send" });
      return { result: { viaSend: true, ...out.result }, brief: out.brief };
    }
    const snap = await snapshot(client, { team, task }, { dataDir: null });
    const cards = snap.pending.filter((p) => p.kind !== "waiting");
    let target;
    if (flags.request) { target = cards.find((p) => p.requestId === flags.request) ?? null; if (!target) throw new Fail(EXIT.PRECONDITION, `no pending request ${flags.request}`, { hint: cards.length ? `pending: ${cards.map((c) => `${c.requestId ?? c.kind} (${c.botName})`).join(", ")}` : "nothing is pending; a plain question is answered with send" }); }
    else if (cards.length === 1) target = cards[0];
    else if (cards.length === 0) throw new Fail(EXIT.PRECONDITION, "nothing is pending", { hint: 'a plain-text question is answered with send "…"' });
    else throw new Fail(EXIT.PRECONDITION, `${cards.length} requests are pending; pass --request`, { hint: cards.map((c) => `${c.requestId ?? c.kind}: ${c.botName} ${c.text}`).join(" | ") });
    if (target.kind !== "card") throw new Fail(EXIT.NEEDS_USER, `${target.botName} has a ${target.kind} request the driver cannot answer`, { hint: target.kind === "connector" ? "connect the app in OpenMausBot's UI (connector cards use /api/bots/:id/connector-cards)" : "provide the credential in OpenMausBot's UI (secret cards use /api/bots/:id/secret-cards)" });
    const behavior = modes[0];
    if (behavior === "answer" && target.cardKind && target.cardKind !== "question") throw new Fail(EXIT.USAGE, `request ${target.requestId} is an approval card: use --allow or --deny`);
    if (behavior !== "answer" && target.cardKind === "question") throw new Fail(EXIT.USAGE, `request ${target.requestId} is a question: use --message`);
    if (cfg.dryRun) return { result: { dryRun: true, requestId: target.requestId, threadId: target.threadId, behavior } };
    const res = await client.post(`/api/threads/${target.threadId}/respond`, { requestId: target.requestId, behavior, ...(behavior === "answer" ? { message: flags.message } : {}) });
    const outcome = res.outcome ?? "unknown";
    let fellBackToSend = false; let sent = null;
    if (outcome === "unavailable") {
      if (behavior === "answer" && task && target.threadId === task.leadThreadId) {
        sent = await deliver(client, cfg, { botId: team.lead.id, threadId: task.leadThreadId, text: flags.message, sendId: sendIdFor(task.runId, task.leadThreadId, flags.message) });
        fellBackToSend = true;
      } else {
        throw new Fail(EXIT.NEEDS_USER, `the card is no longer answerable (outcome unavailable); the ${behavior} did not happen`, { hint: "the request died with the bot's turn; tell the bot in chat what you decided with send, and it will ask again if it must" });
      }
    }
    return { result: { requestId: target.requestId, threadId: target.threadId, bot: target.botName, behavior, outcome, fellBackToSend, sent }, brief: `answer · ${target.botName} · ${behavior} → ${outcome}${fellBackToSend ? " (sent as chat instead)" : ""}` };
  },
});

verb("interrupt", {
  options: { bot: { type: "string" } },
  handler: async ({ flags }) => {
    const cfg = resolveConfig(flags);
    const team = requireTeam(cfg);
    const client = createClient(cfg);
    const bot = flags.bot ? findBot(team, flags.bot) : team.lead;
    if (!bot) throw new Fail(EXIT.USAGE, `no team bot named ${flags.bot}`);
    const task = cfg.state.task && cfg.state.task.status !== "closed" ? cfg.state.task : null;
    const threadId = task?.threads?.[bot.id] ?? null;
    if (!threadId) throw new Fail(EXIT.PRECONDITION, `no run thread is recorded for ${bot.name}`, { hint: "interrupt only stops the run's own turn" });
    try { await client.post(`/api/bots/${bot.id}/interrupt`, { threadId }); } catch (e) { throw precondition(e, "the bot is busy somewhere else (a room or a routine); it was not interrupted"); }
    return { result: { bot: bot.name, threadId, interrupted: true }, brief: `interrupt · ${bot.name}` };
  },
});

// ── watch ──
import { watchRun } from "../watch.mjs";
import { brief as briefLine, EXIT_FOR, TERMINAL as TERMINAL_STATES } from "../snapshot.mjs";

verb("watch", {
  options: { "max-seconds": { type: "string" }, until: { type: "string" }, poll: { type: "string" }, "stall-minutes": { type: "string" }, "quiet-seconds": { type: "string" }, "drop-seconds": { type: "string" }, nudge: { type: "boolean" }, "quiet-if-unchanged": { type: "boolean" } },
  handler: async ({ flags }) => {
    const cfg = resolveConfig(flags);
    const team = requireTeam(cfg);
    const task = cfg.state.task && cfg.state.task.status !== "closed" ? cfg.state.task : null;
    if (!task) throw new Fail(EXIT.PRECONDITION, "no open run to watch", { hint: "start one with task, or use status" });
    if (task.status !== "dispatched") throw new Fail(EXIT.PRECONDITION, `the run is ${task.status}`, { hint: "task --resume finishes the dispatch" });
    const until = flags.until ?? "settled";
    if (!["settled", "change", "question"].includes(until)) throw new Fail(EXIT.USAGE, "--until must be settled, change, or question");
    const client = createClient(cfg);
    const num = (v, d) => (v === undefined ? d : Number(v));
    const log = (m) => { if (flags.verbose) process.stderr.write(`[watch] ${m}\n`); };
    const nudge = flags.nudge ? async () => { await client.post(`/api/bots/${team.lead.id}/messages`, { text: "status?", threadId: task.leadThreadId, sendId: `nudge-${task.runId}` }); } : null;
    const r = await watchRun({ client, team, task, dataDir: cfg.dataDirReadable ? cfg.dataDir : null, maxSeconds: num(flags["max-seconds"], 100), until, pollMs: num(flags.poll, 30) * 1000, stallMs: num(flags["stall-minutes"], 40) * 60_000, quietMs: num(flags["quiet-seconds"], 30) * 1000, dropMs: num(flags["drop-seconds"], 120) * 1000, nudge, log });
    await updateState(cfg.paths, (d) => { if (d.task?.runId === task.runId && d.task.status !== "closed") { d.task.lastEval = r.watermarks; if (r.nudged && !d.task.nudgedAt) d.task.nudgedAt = new Date().toISOString(); } return d; });
    const state = r.timedOut && !TERMINAL_STATES.has(r.ev.state) ? "timeout" : r.ev.state;
    const code = state === "timeout" ? EXIT.TIMEOUT : r.outcome === "change" || r.outcome === "question" ? (TERMINAL_STATES.has(r.ev.state) ? EXIT_FOR[r.ev.state] : EXIT.OK) : EXIT_FOR[r.ev.state] ?? EXIT.OK;
    const line = briefLine(r.ev, r.snap, task);
    const unchanged = flags["quiet-if-unchanged"] && !r.changedSinceReport;
    return {
      code, ok: code === EXIT.OK,
      result: { state, outcome: r.outcome, reasons: r.ev.reasons, hint: r.ev.hint, changes: r.changes, lead: r.snap.leadText, lastUser: r.snap.lastUser, pending: r.snap.pending, outcomes: r.snap.outcomes.length, busy: r.ev.busy, inflight: r.ev.inflight, quietFor: r.ev.quietFor, cursor: r.cursor, elapsedSec: r.elapsedSec, pollingOnly: r.pollingOnly, nudged: r.nudged, complete: r.snap.complete, incomplete: r.snap.incomplete, brief: line, ...(unchanged ? { silent: true } : {}) },
      brief: unchanged ? "" : state === "timeout" ? `${line} · watch timed out after ${r.elapsedSec}s, call again` : line,
    };
  },
});

// ── report ──
import { readNdjson, turnsFromEvents, nativeCalls, check042, beadStatus, commitsSince, runTests, renderMarkdown } from "../report.mjs";
import { reconcileCheck as rootCheck, git as gitRun } from "../git.mjs";
import * as srvInfo from "../server.mjs";

verb("report", {
  options: { md: { type: "boolean" }, "check-042": { type: "boolean" }, "no-tests": { type: "boolean" }, close: { type: "boolean" }, "no-close": { type: "boolean" } },
  handler: async ({ flags }) => {
    const cfg = resolveConfig(flags);
    if (cfg.mode === "remote" || !cfg.dataDirReadable) throw new Fail(EXIT.PRECONDITION, "report needs the data dir and the project checkout", { hint: cfg.dataDirReadable ? "run it on the server's machine" : `${cfg.dataDir} is not readable: pass --data-dir` });
    const team = requireTeam(cfg);
    const task = cfg.state.task && cfg.state.task.status !== "closed" ? cfg.state.task : null;
    if (!task) throw new Fail(EXIT.PRECONDITION, "no open run to report", { hint: "the last closed runs are in the state's history" });
    const client = createClient(cfg);
    const snap = await snapshot(client, { team, task }, { dataDir: cfg.dataDir });
    let ev = evaluate(snap, task, carriedInputs(task));
    const last = task.lastEval;
    const unchanged = last && last.lastLeadMessageId === (snap.leadText?.id ?? null) && (last.outcomes?.length ?? 0) === snap.outcomes.length;
    if (ev.state === "running" && last && TERMINAL_STATES.has(last.state) && unchanged && !ev.inflight) ev = { ...ev, state: last.state, carried: true };
    const sinceMs = task.sentAt ?? 0;
    const threads = Object.entries(task.threads ?? {}).map(([botId, threadId]) => {
      const bot = team.bots.find((b) => b.id === botId) ?? (botId === team.lead.id ? team.lead : null);
      const events = readNdjson(path.join(cfg.dataDir, "events", `${threadId}.ndjson`)) ?? [];
      const t = turnsFromEvents(events, sinceMs);
      return { bot: bot?.name ?? botId, threadId, turns: t.turns.length, seconds: t.seconds, totals: t.totals, models: [...new Set(t.turns.map((x) => x.model).filter(Boolean))] };
    });
    const native = readNdjson(path.join(cfg.dataDir, "native", `${task.leadThreadId}.ndjson`)) ?? [];
    const commits = commitsSince(cfg.projectDir, task.sentSha);
    const facts = cfg.state.facts ?? {};
    const taskLog = facts.taskLog && facts.taskLog !== "none" ? facts.taskLog : null;
    const taskLogText = taskLog ? (() => { try { return fs.readFileSync(path.join(cfg.projectDir, taskLog), "utf8"); } catch { return null; } })() : null;
    const recordCommit = commits.find((c) => /^docs\(team\): .* merged as [0-9a-f]{7,}/.test(c.subject) && c.files.length > 0 && c.files.every((f) => f === taskLog || f.startsWith(".beads/")));
    const taskLogChanged = taskLog ? commits.some((c) => c.files.includes(taskLog)) : null;
    const bead = beadStatus(task.bead, cfg.projectDir);
    const record = { taskLog, taskLogChanged, commit: recordCommit?.sha ?? null, commitSubject: recordCommit?.subject ?? null, bead, ok: taskLog ? Boolean(taskLogChanged && recordCommit) && bead.ok !== false : null };
    const closing = snap.leadText?.text ?? null;
    const mergedSha = closing ? /merged as ([0-9a-f]{7,40})/i.exec(closing)?.[1] ?? null : null;
    const reconcile = rootCheck(cfg.projectDir, facts);
    let ancestor = null;
    if (mergedSha) { try { gitRun(["merge-base", "--is-ancestor", mergedSha, reconcile.defaultBranch], cfg.projectDir); ancestor = true; } catch { ancestor = false; } }
    const tests = flags["no-tests"] ? { ran: false, ok: null, detail: "skipped with --no-tests" } : runTests(facts.test, cfg.projectDir);
    let checks = null;
    if (flags["check-042"]) {
      const reviewer = team.bots.find((b) => /plan review/i.test(b.title ?? ""))?.name ?? null;
      checks = check042({ native, taskLogText, reviewerName: reviewer, sentAt: sinceMs, toolNames: [] });
      checks.push({ id: "bead-closed", ok: bead.ok, detail: bead.detail });
      checks.push({ id: "record-commit", ok: Boolean(recordCommit), detail: recordCommit ? `${recordCommit.sha.slice(0, 7)} ${recordCommit.subject} (${recordCommit.files.join(", ")})` : "no docs(team) commit touching only the task log and .beads since the dispatch" });
      checks.push({ id: "merged-ancestor", ok: ancestor, detail: mergedSha ? `${mergedSha.slice(0, 7)} ${ancestor ? "is" : "is not"} an ancestor of ${reconcile.defaultBranch}` : "the closing report names no merged commit" });
      checks.push({ id: "task-branch-and-worktree-absent", ok: reconcile.taskBranches.length === 0 && reconcile.worktrees.length === 1, detail: `${reconcile.taskBranches.length} task branch(es), ${reconcile.worktrees.length - 1} extra worktree(s)` });
      checks.push({ id: "root-clean", ok: reconcile.clean, detail: reconcile.clean ? "clean" : reconcile.problems.join("; ") });
      checks.push({ id: "tests-pass", ok: tests.ok, detail: tests.ran ? `exit ${tests.status} in ${tests.seconds} s` : tests.detail });
    }
    const allChecks = checks ? checks.every((c) => c.ok !== false) : true;
    let result;
    if (ev.state === "failed" || tests.ok === false) result = "failed";
    else if (ev.state === "done" && record.ok !== false && tests.ok !== false && reconcile.clean && allChecks) result = "passed";
    else result = "incomplete";
    const terminal = TERMINAL_STATES.has(ev.state);
    const shouldClose = !flags["no-close"] && (terminal || flags.close);
    const env = await srvInfo.environment(client);
    const report = {
      date: new Date().toISOString().slice(0, 10), runId: task.runId, tag: task.tag, title: task.title, slug: task.slug, project: cfg.projectDir, version: env?.version ?? cfg.state.server?.version ?? null,
      lead: team.lead.name, leadModel: team.lead.model ?? null, sentAt: task.sentAt ? new Date(task.sentAt).toISOString() : null, sentSha: task.sentSha, state: ev.state, result,
      threads, outcomes: snap.outcomes, commits, record, tests, reconcile: { clean: reconcile.clean, problems: reconcile.problems, defaultBranch: reconcile.defaultBranch }, mergedSha, ancestor, check042: checks, closing, decisions: null,
      nativeTools: [...new Set(nativeCalls(native).calls.map((c) => c.name))], durationSec: task.sentAt ? Math.round((Date.now() - task.sentAt) / 1000) : null, closed: false,
    };
    if (shouldClose && !cfg.dryRun) {
      await updateState(cfg.paths, (d) => {
        if (d.task?.runId !== task.runId) return d;
        const closedRun = { ...d.task, status: "closed", result, closedAt: new Date().toISOString(), report: { state: ev.state, result, mergedSha, recordCommit: record.commit, tests: tests.ok, durationSec: report.durationSec } };
        d.history = [...(d.history ?? []), closedRun]; d.task = null; return d;
      });
      report.closed = true;
    }
    const md = renderMarkdown(report);
    return { code: result === "failed" ? EXIT.STALLED : EXIT.OK, ok: result !== "failed", result: { ...report, markdown: flags.md ? md : undefined }, brief: flags.md ? md : `report · ${task.title} · ${ev.state} · ${result}${report.closed ? " · run closed" : " · run left open"}${tests.ran ? ` · tests ${tests.ok ? "passed" : "FAILED"}` : ""}` };
  },
});
