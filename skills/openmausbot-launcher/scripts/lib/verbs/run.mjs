import { stateCommand, requireSameEnvironment, requireDataDir, serverIdentity, protectServerSelection, runContext } from "../session.mjs";
// status, task, send, answer, interrupt, watch.
import fs from "node:fs";
import path from "node:path";
import { verb, EXIT, Fail, VERBS } from "../cli.mjs";
import { resolveConfig } from "../config.mjs";
import { createClient } from "../http.mjs";
import { snapshot, evaluate, brief, carriedVerdict, withinDeadline } from "../snapshot.mjs";

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
    await requireSameEnvironment(cfg, client);
    const runs = openRuns(cfg.state);
    const snap = await snapshot(client, { team, runs }, { dataDir: cfg.mode === "local" && cfg.dataDirReadable ? cfg.dataDir : null });
    const tail = Number(flags.tail ?? 0);
    const conversationOf = (view) => ({ lead: view.leadText, lastUser: view.lastUser, ...(tail > 0 ? { tail: view.leadTail.slice(-tail).map((m) => ({ id: m.id, at: m.at, role: m.role, kind: m.kind, from: m.from?.name ?? null, text: summarizeLong(m) })) } : {}) });
    if (!runs.length) {
      const busy = snap.bots.filter((b) => b.busy).map((b) => b.name);
      return { result: { run: null, runs: [], complete: snap.complete, incomplete: snap.incomplete, bots: snap.bots, busy, pending: snap.pending, ...conversationOf(snap) }, brief: `status · no run · ${busy.length ? `${busy.join(", ")} working` : "team idle"}${snap.pending.length ? ` · ${snap.pending.length} pending request(s)` : ""}` };
    }
    // One evaluation per open run, each over its own view of the same reads.
    const reported = runs.map((task) => {
      const view = snap.views[task.runId];
      let ev = evaluate(view, task, carriedInputs(task));
      // A single snapshot cannot establish settlement; keep the last watch's terminal verdict when nothing moved since.
      const prior = carriedVerdict(view, task);
      if (ev.state === "running" && prior) ev = { ...ev, state: prior, reasons: [`from the last watch: ${prior}`, ...ev.reasons], carried: true };
      const line = brief(ev, view, task);
      return {
        runId: task.runId, status: task.status, title: task.title, slug: task.slug, branch: task.branch ?? null, implementer: task.implementer ?? null, sentAt: task.sentAt,
        state: ev.state, carried: ev.carried === true, reasons: ev.reasons, hint: ev.hint, inflight: ev.inflight, busy: ev.busy, quietFor: ev.quietFor,
        pending: view.pending, outcomes: view.outcomes, ...conversationOf(view), marker: view.markerSeen, receipts: view.receipts, openDelegations: view.openDelegations, brief: line,
      };
    });
    const first = reported[0];
    const single = runs.length === 1;
    return {
      result: {
        runs: reported, complete: snap.complete, incomplete: snap.incomplete, ...(flags.bots ? { bots: snap.bots, teamMap: snap.teamMap } : {}),
        // One open run reads exactly as it did when a project could only have one.
        ...(single ? { run: { runId: first.runId, status: first.status, title: first.title, slug: first.slug, sentAt: first.sentAt }, state: first.state, carried: first.carried, reasons: first.reasons, hint: first.hint, inflight: first.inflight, busy: first.busy, quietFor: first.quietFor, pending: first.pending, outcomes: first.outcomes, lead: first.lead, lastUser: first.lastUser, ...(tail > 0 ? { tail: first.tail } : {}), marker: first.marker, receipts: first.receipts, brief: first.brief } : {}),
      },
      brief: reported.map((x) => x.brief).join("\n"),
    };
  },
});

const summarizeLong = (m) => (m.text ?? m.tool?.name ?? "").replace(/\s+/g, " ").slice(0, 400);

// ── task, send, answer, interrupt (design: "Task lifecycle") ──
import { createHash, randomBytes } from "node:crypto";
import { withLock, loadState, commitState, updateState, initState, assertOpenRun, LockTimeout } from "../state.mjs";
import { openRuns, selectRun, runLabel } from "../runs.mjs";
import { HttpError, precondition } from "../http.mjs";
import { reconcileCheck, slugTaken, git } from "../git.mjs";
import * as srv from "../server.mjs";
import { findBot } from "../team.mjs";
import { markerLine } from "../snapshot.mjs";

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "run";
const tagOf = (runId) => `oml:${runId.slice(0, 8)}`;

export function composeBrief({ leadName, brief, todo, bead, facts, tag, slug, implementer }) {
  let text = brief;
  if (!text) {
    const test = facts?.test && facts.test !== "<fill in>" ? facts.test : null;
    const where = test && /worktree/i.test(test) ? "" : " (run inside the task's worktree)";
    text = `${leadName}, do ${todo} from TODO.md in this project.${test ? ` Test command: ${test}${where}.` : ""}${facts?.setup ? ` Setup command: ${facts.setup}.` : ""}${bead ? ` Bead: ${bead}.` : ""}`;
  } else if (bead && !/\bBead:/.test(text)) text = `${text.trimEnd()} Bead: ${bead}.`;
  // Two runs share one repository and one team, so the brief has to name the
  // worktree this task owns and, when the team has implementers, which one is
  // free for it. Without that the lead picks for itself and two tasks collide.
  const owned = [
    slug ? `Use the worktree .worktrees/${slug} on branch task/${slug} for this task.` : null,
    implementer ? `Use @${implementer.name} as the implementer for this task.` : null,
  ].filter(Boolean);
  if (owned.length) text = `${text.trimEnd()} ${owned.join(" ")}`;
  return `${text.trimEnd()}\n\nWhen the task is finished, end your closing report with a line containing only \`${markerLine(tag)}\`.`;
}

/** Bots whose title says they implement. A team without them is dispatched without a claim. */
export const implementersIn = (bots) => bots.filter((b) => /implementer/i.test(b.title ?? ""));

/**
 * Which implementer this run claims (design, "Several runs"). A claim is
 * conservative: one open run per implementer, because a bot runs one turn at a
 * time and the second task would only queue behind the first.
 */
export function pickImplementer(live, openRuns, { wanted = null, share = false } = {}) {
  const claimedBy = new Map();
  for (const run of openRuns) if (run.implementer?.id) claimedBy.set(run.implementer.id, run);
  const pool = implementersIn(live);
  if (wanted) {
    const bot = findBot({ bots: live }, wanted);
    if (!bot) throw new Fail(EXIT.USAGE, `no bot named ${wanted} on this team`, { hint: `bots: ${live.map((b) => b.name).join(", ")}` });
    const by = claimedBy.get(bot.id);
    if (by && !share) throw new Fail(EXIT.PRECONDITION, `${bot.name} is the implementer of ${runLabel(by)}`, { hint: "pass --share-implementer to give it a second task anyway, or name another bot" });
    return { id: bot.id, name: bot.name };
  }
  if (!pool.length) return null;
  const free = pool.filter((b) => !claimedBy.has(b.id));
  const idle = free.find((b) => !b.busy);
  if (idle) return { id: idle.id, name: idle.name };
  const why = free.length ? `every free implementer is working: ${free.map((b) => b.name).join(", ")}` : `every implementer is claimed: ${pool.map((b) => `${b.name} by ${runLabel(claimedBy.get(b.id))}`).join(", ")}`;
  throw new Fail(EXIT.PRECONDITION, why, { hint: "ask the lead to create another implementer, or pass --implementer <bot> --share-implementer" });
}


/** The tasks on a bot whose title carries this run's tag. */
const taggedTasks = (bot, tag) => (bot.tasks ?? []).filter((t) => typeof t.title === "string" && t.title.includes(`[${tag}]`));

verb("task", {
  options: { todo: { type: "string" }, bead: { type: "string" }, title: { type: "string" }, resume: { type: "boolean" }, abandon: { type: "boolean" }, "no-fresh-threads": { type: "boolean" }, implementer: { type: "string" }, "share-implementer": { type: "boolean" }, run: { type: "string" } },
  allowPositionals: true,
  handler: stateCommand(async ({ flags, positionals, cfg, save }) => {
    if (cfg.mode === "remote") throw new Fail(EXIT.PRECONDITION, "task needs the project checkout on the server's machine", { hint: "remote hosts can status, watch, send, answer, and interrupt" });
    requireDataDir(cfg, "task");
    const team = requireTeam(cfg);
    const openBefore = openRuns(cfg.state);
    const current = flags.abandon || flags.resume ? (openBefore.length ? selectRun(cfg.state, flags.run) : null) : null;
    if (flags.abandon) {
      if (!current) throw new Fail(EXIT.PRECONDITION, "no open run to abandon");
      if (cfg.dryRun) return { result: { dryRun: true, abandon: current.runId } };
      const doc = await save( (d) => { const open = assertOpenRun(d, current.runId); const t = { ...open, status: "closed", result: "abandoned", closedAt: new Date().toISOString() }; d.history = [...(d.history ?? []), t]; delete d.runs[current.runId]; return d; });
      return { result: { abandoned: current.runId, title: current.title, history: doc.history.length }, brief: `task · abandoned ${current.title}` };
    }
    const client = createClient(cfg);
    await requireSameEnvironment(cfg, client);
    const briefArg = positionals[0];
    if (flags.resume) {
      if (!current) throw new Fail(EXIT.PRECONDITION, "no open run to resume", { hint: "start one with task" });
      if (briefArg || flags.todo) throw new Fail(EXIT.USAGE, "--resume continues the recorded run; it takes no new brief");
    } else {
      // A half-prepared run has threads on the server the driver has not
      // finished recording; settle it before opening another.
      const preparing = openBefore.find((r) => r.status === "preparing");
      if (preparing) throw new Fail(EXIT.PRECONDITION, `a run is ${preparing.status}: ${preparing.title} (${preparing.runId})`, { hint: `task --resume --run ${preparing.slug ?? preparing.runId} continues it; task --abandon --run ${preparing.slug ?? preparing.runId} closes it` });
      if (!briefArg && !flags.todo) throw new Fail(EXIT.USAGE, 'usage: task "<brief>" | task --todo T10 [--bead ID] [--title T]');
    }
    const title = flags.resume ? current.title : flags.title ?? flags.todo ?? briefArg.split("\n")[0].slice(0, 60);
    const slug = flags.resume ? current.slug : slugify(title);
    // Read-only preconditions (design step 1).
    const fleet = await client.get("/api/bots?messages=0");
    const teamMap = await client.get("/api/team-map");
    const ids = new Set(team.bots.map((b) => b.id));
    const live = (fleet.bots ?? []).filter((b) => ids.has(b.id) || (team.section && b.section === team.section && !b.hidden));
    const leadLive = live.find((b) => b.id === team.lead.id);
    if (!leadLive) throw new Fail(EXIT.PRECONDITION, `the lead ${team.lead.name} is not on the server`);
    if (openBefore.length) {
      // Another run is open, so its bots are expected to be working. Only the
      // lead has to be free: this dispatch opens its task and sends the brief.
      if (leadLive.busy) throw new Fail(EXIT.PRECONDITION, `the lead ${leadLive.name} is working`, { hint: `wait for it to go idle; ${openBefore.map(runLabel).join(", ")} ${openBefore.length > 1 ? "are" : "is"} open` });
    } else {
      const busy = live.filter((b) => b.busy);
      if (busy.length) throw new Fail(EXIT.PRECONDITION, `bots are working: ${busy.map((b) => b.name).join(", ")}`, { hint: "wait, or interrupt" });
      const inflight = [...(teamMap.queued ?? []), ...(teamMap.running ?? [])].filter((e) => ids.has(e.sourceBotId) && ids.has(e.targetBotId));
      if (inflight.length) throw new Fail(EXIT.PRECONDITION, `${inflight.length} delegation(s) queued or running`, { hint: "wait for them to settle" });
    }
    let implementer = flags.resume ? current.implementer ?? null : null;
    if (!flags.resume) {
      const clash = openBefore.find((r) => r.slug === slug);
      if (clash) throw new Fail(EXIT.PRECONDITION, `a run with the slug ${slug} is already open: ${runLabel(clash)}`, { hint: "pass --title to give this task its own name" });
      const taken = slugTaken(cfg.projectDir, slug);
      if (taken.length) throw new Fail(EXIT.PRECONDITION, `${taken.join(" and ")} already exists`, { hint: `remove it with reconcile --remove ${slug}, give it to a run with reconcile --claim ${slug} --run <ref>, or pass --title for another name` });
      implementer = pickImplementer(live, openBefore, { wanted: flags.implementer ?? null, share: flags["share-implementer"] === true });
    }
    const check = reconcileCheck(cfg.projectDir, cfg.state.facts, { runs: openBefore });
    if (!check.clean) throw new Fail(EXIT.PRECONDITION, `the repository is not reconciled: ${check.problems.join("; ")}`, { hint: "run reconcile; a stopped task keeps its worktree until you pass --remove <slug>" });
    const sentSha = git(["rev-parse", "HEAD"], cfg.projectDir);
    if (cfg.dryRun && flags.resume) {
      const toCreate = live.filter((b) => !current.threads?.[b.id] && (!current.freshThreads || taggedTasks(b, current.tag).length !== 1)).map((b) => b.name);
      return { result: { dryRun: true, resume: current.runId, status: current.status, threadsToCreate: toCreate, wouldSend: current.status === "preparing" } };
    }
    if (cfg.dryRun && !flags.resume) {
      const runId = randomBytes(8).toString("hex"); const tag = tagOf(runId);
      return { result: { dryRun: true, title, slug, branch: `task/${slug}`, tag, implementer, brief: composeBrief({ leadName: team.lead.name, brief: briefArg, todo: flags.todo, bead: flags.bead, facts: cfg.state.facts, tag, slug, implementer }), threadsFor: openBefore.length ? [team.lead.name] : live.map((b) => b.name) } };
    }
    // Everything from here runs under the lock (design steps 2-4).
    return (async () => {
      let doc = loadState(cfg.paths) ?? initState(cfg.projectDir);
      // assertOpenRun refuses a run another launcher closed while this command
      // waited for the lock; for a new run the same wait can have opened one.
      let run = flags.resume ? assertOpenRun(doc, current.runId) : null;
      if (!flags.resume) {
        const moved = openRuns(doc).find((r) => r.slug === slug || r.status === "preparing");
        if (moved) throw new Fail(EXIT.PRECONDITION, `a run is ${moved.status}: ${moved.title}`, { hint: "another launcher started it; task --resume or task --abandon" });
        const runId = randomBytes(8).toString("hex"); const tag = tagOf(runId);
        run = { runId, context: runContext(cfg), status: "preparing", slug, title, tag, branch: `task/${slug}`, claimedSlugs: [], implementer,
          brief: composeBrief({ leadName: team.lead.name, brief: briefArg, todo: flags.todo, bead: flags.bead, facts: doc.facts, tag, slug, implementer }), bead: flags.bead ?? null,
          sendId: `task-${runId}`, sentAt: null, sentSha, sendReceipt: null, leadThreadId: null, threads: {},
          // A delegated turn lands on the target's ACTIVE thread (index.ts:3466),
          // so a later run must leave the specialists' threads where they are or
          // it would hijack the first run's delegations.
          freshThreads: !flags["no-fresh-threads"], leadThreadsOnly: openBefore.length > 0, createdAt: new Date().toISOString(), nudgedAt: null, lastEval: null };
        doc.runs[run.runId] = run; doc = commitState(cfg.paths, doc);
      }
      const threadTitle = `${run.title} [${run.tag}]`;
      const order = [leadLive, ...live.filter((b) => b.id !== leadLive.id)];
      for (const bot of order) {
        if (run.threads[bot.id]) continue;
        let threadId;
        if (!run.freshThreads || (run.leadThreadsOnly && bot.id !== leadLive.id)) threadId = bot.threadId;
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
        doc.runs[run.runId] = run; doc = commitState(cfg.paths, doc);
      }
      if (run.status === "preparing") {
        // The same delivery as `send`: a resumed dispatch often finds the lead
        // on another run's task, and the brief belongs on this run's thread.
        const receipt = await deliverToLead(client, { leadId: leadLive.id, run, otherRuns: openRuns(doc).filter((r) => r.runId !== run.runId), text: run.brief, sendId: run.sendId });
        run.sentAt = receipt.at ?? Date.now();
        run.sendReceipt = { steered: receipt.steered === true, queued: receipt.queued === true, messageId: receipt.messageId ?? null, queueId: receipt.queueId ?? null, switched: receipt.switched === true };
        run.status = "dispatched";
        run.lastEval = { state: "running", lastChangeAt: run.sentAt, outcomes: [], quietSince: null, lastLeadMessageId: null, cursor: null, lastReported: null };
        doc.runs[run.runId] = run; doc = commitState(cfg.paths, doc);
      }
      return { result: { runId: run.runId, status: run.status, title: run.title, slug: run.slug, branch: run.branch ?? null, implementer: run.implementer ?? null, tag: run.tag, leadThreadId: run.leadThreadId, threads: run.threads, sentAt: run.sentAt, sentSha: run.sentSha, sendReceipt: run.sendReceipt, openRuns: openRuns(doc).length, resumed: flags.resume === true, brief: run.brief },
        brief: `task · ${run.title} · ${run.status} · ${run.branch ?? "no branch"}${run.implementer ? ` · @${run.implementer.name}` : ""} · lead thread ${run.leadThreadId}` };
    })();
  }),
});

const sendIdFor = (scope, threadId, text) => `send-${createHash("sha1").update(`${scope}|${threadId}|${text}`).digest("hex").slice(0, 16)}`;

/**
 * Send to a run's own lead thread (design, "Delivery"). A new message reaches
 * only the bot's ACTIVE task (index.ts:10790-10797), so when the lead is
 * sitting on another run's task this makes the run's task active again
 * (index.ts:11120-11140) and posts once more. Order matters twice over: an
 * identical sendId replays the canonical receipt BEFORE the active-task check
 * (index.ts:10764-10777), so a retry needs no switch at all; and the switch is
 * refused mid-turn, because a lead that is working owns its process.
 * A thread no run owns is never switched away from, and one switch is all:
 * a second refusal is reported, not answered with another switch.
 */
export async function deliverToLead(client, { leadId, run, otherRuns = [], text, sendId }) {
  const t0 = Date.now();
  const post = () => client.post(`/api/bots/${leadId}/messages`, { text, threadId: run.leadThreadId, sendId });
  const movedAway = (e) => e instanceof HttpError && e.status === 409 && /switched tasks|no longer exists/.test(e.body?.error ?? "");
  const shape = (receipt, switched) => (receipt.dryRun ? { dryRun: true, ...receipt } : {
    threadId: receipt.threadId, messageId: receipt.message?.id ?? null, at: receipt.message?.at ?? null, steered: receipt.steered === true,
    queued: receipt.queued === true, queueId: receipt.queueId ?? null,
    duplicate: typeof receipt.message?.at === "number" && receipt.message.at < t0, switched,
  });
  try { return shape(await post(), false); }
  catch (e) {
    if (!movedAway(e)) throw precondition(e);
    let active = null;
    try { active = (await client.get("/api/bots?messages=0")).bots?.find((b) => b.id === leadId)?.threadId ?? null; } catch {}
    const owner = otherRuns.find((r) => r.leadThreadId && r.leadThreadId === active);
    if (!owner) {
      throw new Fail(EXIT.PRECONDITION, `${e.body.error} (target thread ${run.leadThreadId})`, { status: 409, hint: `the lead's active task is ${active ?? "unknown"}; nothing was retargeted: pass --thread ${active ?? "<id>"} to send there on purpose` });
    }
    try { await client.post(`/api/bots/${leadId}/tasks/${run.leadThreadId}`, {}); }
    catch (se) {
      if (se instanceof HttpError && se.status === 409 && /this bot is working/.test(se.body?.error ?? "")) {
        throw new Fail(EXIT.PRECONDITION, `the lead is working on ${runLabel(owner)}; retry when it is idle`, { status: 409, hint: `watch --run ${owner.slug ?? owner.runId} until it settles, or interrupt it` });
      }
      throw precondition(se);
    }
    try { return shape(await post(), true); }
    catch (e2) {
      if (!movedAway(e2)) throw precondition(e2);
      throw new Fail(EXIT.PRECONDITION, `${e2.body.error} (target thread ${run.leadThreadId})`, { status: 409, hint: `the lead switched away again right after this launcher switched it back; nothing was retargeted and nothing was retried — find the other writer, then send again` });
    }
  }
}

/** The run a run-scoped verb acts on: named, the only open one, or a question for the user. */
const runFor = (cfg, flags) => (flags.run || openRuns(cfg.state).length ? selectRun(cfg.state, flags.run) : null);

/** A matching sendId returns the canonical receipt with the ORIGINAL message, id and `at` included, and no replay marker (index.ts:10765-10777, send-idempotency.ts:21-40): a message stamped before this request began is a duplicate. That reads the server's clock; on loopback it is this clock, over a remote URL it assumes the clocks agree to within the gap between two sends. */
async function deliver(client, cfg, { botId, threadId, text, sendId }) {
  const t0 = Date.now();
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
  return { threadId: receipt.threadId, messageId: receipt.message?.id ?? null, steered: receipt.steered === true, queued: receipt.queued === true, queueId: receipt.queueId ?? null, duplicate: typeof receipt.message?.at === "number" && receipt.message.at < t0 };
}

verb("send", {
  options: { bot: { type: "string" }, thread: { type: "string" }, again: { type: "boolean" }, run: { type: "string" } },
  allowPositionals: true,
  handler: stateCommand(async ({ flags, positionals, cfg, save }) => {
    const team = requireTeam(cfg);
    const text = positionals.join(" ").trim();
    if (!text) throw new Fail(EXIT.USAGE, 'usage: send "<text>" [--bot <name>] [--thread <id>] [--again]');
    const client = createClient(cfg);
    await requireSameEnvironment(cfg, client);
    const bot = flags.bot ? findBot(team, flags.bot) : team.lead;
    if (!bot) throw new Fail(EXIT.USAGE, `no team bot named ${flags.bot}`);
    // An explicit --thread is the caller naming a destination, so it needs no run.
    const task = flags.thread && !flags.run && openRuns(cfg.state).length > 1 ? null : runFor(cfg, flags);
    let threadId = flags.thread ?? (task?.threads?.[bot.id]) ?? null;
    if (!threadId) { const live = (await client.get("/api/bots?messages=0")).bots?.find((b) => b.id === bot.id); threadId = live?.threadId; }
    // --again salts the scope: a deliberate repeat gets a fresh sendId and is delivered, not deduped.
    const sendId = sendIdFor(`${task?.runId ?? "no-run"}${flags.again ? `:${Date.now()}` : ""}`, threadId, text);
    const toOwnThread = task && bot.id === team.lead.id && !flags.thread && threadId === task.leadThreadId;
    const r = toOwnThread
      ? await deliverToLead(client, { leadId: bot.id, run: task, otherRuns: openRuns(cfg.state).filter((x) => x.runId !== task.runId), text, sendId })
      : await deliver(client, cfg, { botId: bot.id, threadId, text, sendId });
    if (!r.dryRun && task) await save( (d) => { const live = d.runs?.[task.runId]; if (live) live.lastEval = { ...(live.lastEval ?? {}), lastChangeAt: Date.now() }; return d; });
    return { result: { bot: bot.name, ...r, sendId }, brief: `send · ${bot.name} · ${r.duplicate ? `duplicate of ${r.messageId}` : r.queued ? "queued" : r.steered ? "steered" : "delivered"}` };
  }),
});

verb("answer", {
  options: { allow: { type: "boolean" }, deny: { type: "boolean" }, message: { type: "string" }, request: { type: "string" }, run: { type: "string" } },
  allowPositionals: true,
  handler: stateCommand(async ({ flags, positionals, cfg, save }) => {
    const team = requireTeam(cfg);
    const client = createClient(cfg);
    await requireSameEnvironment(cfg, client);
    const bare = positionals.join(" ").trim();
    const modes = [flags.allow && "allow", flags.deny && "deny", flags.message !== undefined && "answer"].filter(Boolean);
    if (modes.length > 1) throw new Fail(EXIT.USAGE, "pass one of --allow, --deny, --message");
    const task = runFor(cfg, flags);
    if (!modes.length) {
      if (!bare) throw new Fail(EXIT.USAGE, 'usage: answer --allow|--deny|--message "<text>" [--request ID]  |  answer "<text>"');
      const out = await VERBS.get("send").handler({ flags: { ...flags }, positionals: [bare], verb: "send" });
      return { result: { viaSend: true, ...out.result }, brief: out.brief };
    }
    const snap = await snapshot(client, { team, task, runs: openRuns(cfg.state) }, { dataDir: null });
    const cards = snap.pending.filter((p) => p.kind !== "waiting");
    let target;
    if (flags.request) { target = cards.find((p) => p.requestId === flags.request) ?? null; if (!target) throw new Fail(EXIT.PRECONDITION, `no pending request ${flags.request}`, { hint: cards.length ? `pending: ${cards.map((c) => `${c.requestId ?? c.kind} (${c.botName})`).join(", ")}` : "nothing is pending; a plain question is answered with send" }); }
    else if (cards.length === 1) {
      target = cards[0];
      // A request no open run owns is answered on purpose, never by elimination.
      if (target.shared) throw new Fail(EXIT.PRECONDITION, `no open run owns request ${target.requestId ?? target.kind} (${target.botName})`, { hint: `pass --request ${target.requestId ?? "<id>"} to answer it anyway` });
    }
    else if (cards.length === 0) throw new Fail(EXIT.PRECONDITION, "nothing is pending", { hint: 'a plain-text question is answered with send "…"' });
    else throw new Fail(EXIT.PRECONDITION, `${cards.length} requests are pending; pass --request`, { hint: cards.map((c) => `${c.requestId ?? c.kind}: ${c.botName} ${c.text}`).join(" | ") });
    if (target.kind !== "card") throw new Fail(EXIT.NEEDS_USER, `${target.botName} has a ${target.kind} request the driver cannot answer`, { hint: target.kind === "connector" ? "connect the app in OpenMausBot's UI (connector cards use /api/bots/:id/connector-cards)" : "provide the credential in OpenMausBot's UI (secret cards use /api/bots/:id/secret-cards)" });
    if (target.cardKind === "skill" || target.cardKind === "routine") throw new Fail(EXIT.NEEDS_USER, `${target.botName} has a ${target.cardKind} request the driver cannot answer`, { hint: target.cardKind === "skill" ? "review the learned skill in OpenMausBot's app; its response requires reviewedSha256 matching the displayed preview" : "review and resolve the routine proposal in OpenMausBot's app" });
    const behavior = modes[0];
    if (behavior === "answer" && target.cardKind && target.cardKind !== "question") throw new Fail(EXIT.USAGE, `request ${target.requestId} is an approval card: use --allow or --deny`);
    if (behavior !== "answer" && target.cardKind === "question") throw new Fail(EXIT.USAGE, `request ${target.requestId} is a question: use --message`);
    if (cfg.dryRun) return { result: { dryRun: true, requestId: target.requestId, threadId: target.threadId, behavior } };
    const res = await client.post(`/api/threads/${target.threadId}/respond`, { requestId: target.requestId, behavior, ...(behavior === "answer" ? { message: flags.message } : {}) });
    const outcome = res.outcome ?? "unknown";
    let fellBackToSend = false; let sent = null;
    if (outcome === "unavailable") {
      if (behavior === "answer" && task && target.threadId === task.leadThreadId) {
        sent = await deliverToLead(client, { leadId: team.lead.id, run: task, otherRuns: openRuns(cfg.state).filter((x) => x.runId !== task.runId), text: flags.message, sendId: sendIdFor(task.runId, task.leadThreadId, flags.message) });
        fellBackToSend = true;
      } else {
        throw new Fail(EXIT.NEEDS_USER, `the card is no longer answerable (outcome unavailable); the ${behavior} did not happen`, { hint: "the request died with the bot's turn; tell the bot in chat what you decided with send, and it will ask again if it must" });
      }
    }
    return { result: { requestId: target.requestId, threadId: target.threadId, bot: target.botName, behavior, outcome, fellBackToSend, sent }, brief: `answer · ${target.botName} · ${behavior} → ${outcome}${fellBackToSend ? " (sent as chat instead)" : ""}` };
  }, { lockWhen: ({ flags }) => flags.allow || flags.deny || flags.message !== undefined }),
});

verb("interrupt", {
  options: { bot: { type: "string" }, run: { type: "string" } },
  handler: stateCommand(async ({ flags, cfg, save }) => {
    const team = requireTeam(cfg);
    const client = createClient(cfg);
    await requireSameEnvironment(cfg, client);
    const bot = flags.bot ? findBot(team, flags.bot) : team.lead;
    if (!bot) throw new Fail(EXIT.USAGE, `no team bot named ${flags.bot}`);
    const task = runFor(cfg, flags);
    const threadId = task?.threads?.[bot.id] ?? null;
    if (!threadId) throw new Fail(EXIT.PRECONDITION, `no run thread is recorded for ${bot.name}`, { hint: "interrupt only stops the run's own turn" });
    try { await client.post(`/api/bots/${bot.id}/interrupt`, { threadId }); }
    catch (e) {
      // A turn pinned to a thread that is not the bot's active task — a drained
      // delegation wake — is out of the interrupt's reach (index.ts:11077-11084).
      if (e instanceof HttpError && e.status === 409 && /before it could be interrupted/.test(e.body?.error ?? "")) {
        throw new Fail(EXIT.PRECONDITION, `${e.body.error} (thread ${threadId})`, { status: 409, hint: `the turn is not on ${bot.name}'s active task and cannot be reached from here: wait for the lead to go idle, then task --abandon --run ${task.slug ?? task.runId}` });
      }
      throw precondition(e, "the bot is busy somewhere else (a room or a routine); it was not interrupted");
    }
    return { result: { bot: bot.name, threadId, interrupted: true }, brief: `interrupt · ${bot.name}` };
  }, { lockWhen: () => false }),
});

// ── watch ──
import { watchRun, mergeCheckpoint } from "../watch.mjs";
import { brief as briefLine, EXIT_FOR, TERMINAL as TERMINAL_STATES } from "../snapshot.mjs";

verb("watch", {
  options: { "max-seconds": { type: "string" }, until: { type: "string" }, poll: { type: "string" }, "stall-minutes": { type: "string" }, "quiet-seconds": { type: "string" }, "drop-seconds": { type: "string" }, nudge: { type: "boolean" }, "quiet-if-unchanged": { type: "boolean" }, run: { type: "string" } },
  handler: async ({ flags }) => {
    const cfg = resolveConfig(flags);
    const team = requireTeam(cfg);
    const task = runFor(cfg, flags);
    if (!task) throw new Fail(EXIT.PRECONDITION, "no open run to watch", { hint: "start one with task, or use status" });
    if (task.status !== "dispatched") throw new Fail(EXIT.PRECONDITION, `the run is ${task.status}`, { hint: "task --resume finishes the dispatch" });
    const until = flags.until ?? "settled";
    if (!["settled", "change", "question"].includes(until)) throw new Fail(EXIT.USAGE, "--until must be settled, change, or question");
    const client = createClient(cfg);
    const num = (v, d) => (v === undefined ? d : Number(v));
    const log = (m) => { if (flags.verbose) process.stderr.write(`[watch] ${m}\n`); };
    const maxSeconds = num(flags["max-seconds"], 100);
    const deadline = performance.now() + maxSeconds * 1000;
    try { await withinDeadline((opts) => requireSameEnvironment(cfg, client, opts), deadline); }
    catch (e) {
      if (performance.now() < deadline && !/observation deadline/.test(e.message)) throw e;
      return { code: EXIT.TIMEOUT, result: { state: "timeout", checkpointed: false, complete: false, pending: [], cursor: task.lastEval?.cursor ?? null, reasons: ["watch deadline reached before server identity was verified"] }, brief: "watch · timed out before server identity was verified" };
    }
    const nudge = flags.nudge && !cfg.dryRun ? async (opts) => withLock(cfg.paths, async () => {
      const doc = loadState(cfg.paths); const live = assertOpenRun(doc, task.runId);
      if (live.nudgedAt) return;
      await requireSameEnvironment({ ...cfg, state: doc }, client, opts);
      await deliverToLead(client, { leadId: team.lead.id, run: task, otherRuns: openRuns(doc).filter((x) => x.runId !== task.runId), text: "status?", sendId: `nudge-${task.runId}` });
      live.nudgedAt = new Date().toISOString(); commitState(cfg.paths, doc);
    }, { waitMs: Math.min(1000, opts.timeoutMs) }) : null;
    const r = await watchRun({ client, team, task, runs: openRuns(cfg.state), dataDir: cfg.mode === "local" && cfg.dataDirReadable ? cfg.dataDir : null, maxSeconds, deadline, until, pollMs: num(flags.poll, 30) * 1000, stallMs: num(flags["stall-minutes"], 40) * 60_000, quietMs: num(flags["quiet-seconds"], 30) * 1000, dropMs: num(flags["drop-seconds"], 120) * 1000, nudge, log });
    let checkpointed = false;
    if (!cfg.dryRun) {
      try {
        await withLock(cfg.paths, () => {
          const doc = loadState(cfg.paths);
          const live = doc?.runs?.[task.runId];
          if (!live || live.status === "closed") return;
          if (JSON.stringify(doc.server) !== JSON.stringify(cfg.state.server) || doc.team?.lead?.id !== team.lead.id) throw new Fail(EXIT.PRECONDITION, "the server binding changed before the watch checkpoint", { hint: "re-read the state" });
          live.lastEval = mergeCheckpoint(live.lastEval, r.watermarks);
          live.cards = r.cards;
          if (r.nudged && !live.nudgedAt) live.nudgedAt = new Date().toISOString();
          commitState(cfg.paths, doc); checkpointed = true;
        }, { waitMs: 1000 });
      } catch (e) { if (!(e instanceof LockTimeout)) throw e; }
    }
    const state = r.timedOut && !TERMINAL_STATES.has(r.ev.state) ? "timeout" : r.ev.state;
    const code = state === "timeout" ? EXIT.TIMEOUT : r.outcome === "change" || r.outcome === "question" ? (TERMINAL_STATES.has(r.ev.state) ? EXIT_FOR[r.ev.state] : EXIT.OK) : EXIT_FOR[r.ev.state] ?? EXIT.OK;
    const line = briefLine(r.ev, r.snap, task);
    const unchanged = flags["quiet-if-unchanged"] && !r.changedSinceReport;
    return {
      code, ok: code === EXIT.OK,
      result: { state, checkpointed, dryRun: cfg.dryRun, outcome: r.outcome, reasons: r.ev.reasons, hint: r.ev.hint, changes: r.changes, lead: r.snap.leadText, lastUser: r.snap.lastUser, pending: r.snap.pending, outcomes: r.snap.outcomes.length, busy: r.ev.busy, inflight: r.ev.inflight, quietFor: r.ev.quietFor, cursor: r.cursor, elapsedSec: r.elapsedSec, pollingOnly: r.pollingOnly, receiptsWatched: r.receiptsWatched, nudged: r.nudged, complete: r.snap.complete, incomplete: r.snap.incomplete, brief: line, ...(unchanged ? { silent: true } : {}) },
      brief: unchanged ? "" : state === "timeout" ? `${line} · watch timed out after ${r.elapsedSec}s, call again` : line,
    };
  },
});

// Register the report verb after the run helpers are defined.
import "./report.mjs";
