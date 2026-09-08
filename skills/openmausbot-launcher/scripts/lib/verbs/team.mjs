import { stateCommand, requireSameEnvironment, requireDataDir, serverIdentity, protectServerSelection, runContext } from "../session.mjs";
// import, bind, facts (design: the verb table and "Task lifecycle" preconditions).
import fs from "node:fs";
import path from "node:path";
import { verb, EXIT, Fail } from "../cli.mjs";
import { resolveConfig } from "../config.mjs";
import { createClient, HttpError, precondition } from "../http.mjs";
import { updateState, ensureExclude } from "../state.mjs";
import { defaultBranch, gitTopLevel } from "../git.mjs";
import * as srv from "../server.mjs";
import { parseEngineSpec, specString, sameSelection, findBot, isReviewer, sameName, parseFacts, renderFacts, replaceFactsBlock, FACTS_MARKER } from "../team.mjs";

const MAX_DESCRIPTION = 4000;

function requireTeam(cfg) {
  if (!cfg.state?.team) throw new Fail(EXIT.PRECONDITION, "no team is recorded for this project", { hint: "run import <package.json> or import --adopt <section>" });
  return cfg.state.team;
}


const teamRecord = (bot, key) => ({ id: bot.id, name: bot.name, key: key ?? null, title: bot.title ?? null, model: specString(bot.modelSelection), approvalMode: bot.approvalMode ?? null });

verb("import", {
  options: { lead: { type: "string" }, adopt: { type: "string" } },
  allowPositionals: true,
  handler: stateCommand(async ({ flags, positionals, cfg, save }) => {
    if (cfg.state?.task && cfg.state.task.status !== "closed") throw new Fail(EXIT.PRECONDITION, `a run is ${cfg.state.task.status} (${cfg.state.task.title})`, { hint: "finish it with report, or task --abandon, before changing the team" });
    const client = createClient(cfg);
    if (!flags.adopt) requireDataDir(cfg, "import");
    const keepOwned = await protectServerSelection(cfg, cfg.url);
    const env = await serverIdentity(cfg, client);
    let team;
    if (flags.adopt) {
      const fleet = await client.get("/api/bots?messages=0");
      const bots = fleet.bots ?? [];
      const named = bots.find((b) => b.name === flags.adopt);
      const section = named ? named.section : flags.adopt;
      const members = bots.filter((b) => b.section === section && !b.hidden);
      if (!members.length) throw new Fail(EXIT.PRECONDITION, `no bots in a section or with the name "${flags.adopt}"`, { hint: `sections: ${[...new Set(bots.map((b) => b.section).filter(Boolean))].join(", ") || "none"}` });
      const ids = new Set(members.map((b) => b.id));
      const lead = pickLead(members, flags.lead ?? (named ? named.name : undefined));
      const rooms = (fleet.groups ?? []).filter((g) => !g.dm && g.memberIds?.length && g.memberIds.every((id) => ids.has(id)));
      team = { package: null, section, environmentId: env?.environmentId ?? null, adoptedAt: new Date().toISOString(), lead: teamRecord(lead, null), rooms: rooms.map((g) => ({ id: g.id, name: g.name, threadId: g.threadId })), bots: members.map((b) => teamRecord(b, null)) };
    } else {
      if (cfg.mode === "remote") throw new Fail(EXIT.PRECONDITION, "import runs on the server's machine", { hint: "use import --adopt from a remote host" });
      const file = positionals[0];
      if (!file) throw new Fail(EXIT.USAGE, "usage: import <package.json> [--lead NAME] | import --adopt <section-or-lead>");
      let pkg;
      try { pkg = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")); } catch (e) { throw new Fail(EXIT.USAGE, `cannot read ${file}: ${e.message}`); }
      if (pkg?.format !== "openmaus.package") throw new Fail(EXIT.USAGE, `${file} is not an openmaus.package document`);
      const agentsIn = pkg.package?.agents ?? [];
      const chiefKey = pkg.package?.chiefOfStaff;
      if (!chiefKey && !flags.lead) throw new Fail(EXIT.PRECONDITION, "the package names no chief of staff", { hint: `pass --lead <name>; agents: ${agentsIn.map((a) => a.name).join(", ")}` });
      if (flags.lead && !agentsIn.some((a) => [a.key, a.name, a.title].filter(Boolean).some((v) => v.toLowerCase() === flags.lead.toLowerCase()))) throw new Fail(EXIT.PRECONDITION, `no agent in the package matches --lead ${flags.lead}`, { hint: `agents: ${agentsIn.map((a) => a.name).join(", ")}` });
      if (cfg.dryRun) return { result: { dryRun: true, package: { name: pkg.package?.name, release: pkg.package?.release, agents: agentsIn.map((a) => a.key) } } };
      let res;
      try { res = await client.post("/api/teams/import?mode=add", pkg); } catch (e) { throw precondition(e, e instanceof HttpError && e.status === 403 ? "importing needs an admin session" : undefined); }
      const agents = pkg.package?.agents ?? [];
      const bots = res.bots ?? [];
      const mapped = agents.map((agent, i) => {
        const byOrder = bots[i];
        const bot = byOrder && sameName(byOrder.name, agent.name) ? byOrder : bots.find((b) => sameName(b.name, agent.name));
        if (!bot) throw new Fail(EXIT.ERROR, `the import returned no bot for agent ${agent.key} (${agent.name})`);
        return teamRecord(bot, agent.key);
      });
      const leadAgent = flags.lead ? agents.find((a) => [a.key, a.name, a.title].filter(Boolean).some((v) => v.toLowerCase() === flags.lead.toLowerCase())) : undefined;
      const leadBot = pickLead(bots, leadAgent ? leadAgent.name : flags.lead, pkg.package?.chiefOfStaff ? agents.find((a) => a.key === pkg.package.chiefOfStaff)?.name : undefined);
      const lead = mapped.find((m) => m.id === leadBot.id) ?? teamRecord(leadBot, null);
      const groups = res.groups ?? (res.group ? [res.group] : []);
      // The response's `name` is the package name; the bots carry the section, numbered on a repeat import (index.ts:9217-9228, 9322).
      const section = bots.find((b) => b.section)?.section ?? res.name ?? null;
      team = { package: { path: path.resolve(file), name: pkg.package?.name ?? null, release: pkg.package?.release ?? null }, section, environmentId: env?.environmentId ?? null, importedAt: new Date().toISOString(), lead, rooms: groups.map((g) => ({ id: g.id, name: g.name, threadId: g.threadId })), bots: mapped };
    }
    if (cfg.dryRun) return { result: { ...team, dryRun: true }, brief: `import · dry run · would adopt ${team.section}` };
    // Adopt is the attach path a bind may never follow: a local checkout gets the same exclude entries so reconcile stays clean.
    const exclude = flags.adopt && cfg.mode === "local" && gitTopLevel(cfg.projectDir) !== null ? ensureExclude(cfg.projectDir, [".worktrees/", ".omb/"]) : null;
    await save( (doc) => { doc.team = team; doc.server = { ...(keepOwned ? doc.server : {}), url: cfg.url, owned: keepOwned, environmentId: env.environmentId, healthPid: env.healthPid, healthStart: env.healthStart, version: env.version, dataDir: cfg.mode === "local" && cfg.dataDirReadable ? cfg.dataDir : null }; return doc; });
    return { result: { ...team, ...(exclude ? { exclude } : {}) }, brief: `import · ${team.section} · lead ${team.lead.name} · ${team.bots.length} bots, ${team.rooms.length} room(s)` };
  }),
});

function pickLead(bots, leadRef, chiefName) {
  if (leadRef) {
    const r = leadRef.toLowerCase();
    const b = bots.find((x) => x.id === leadRef) ?? bots.find((x) => sameName(x.name, leadRef)) ?? bots.find((x) => (x.title ?? "").toLowerCase() === r) ?? bots.find((x) => (x.name ?? "").toLowerCase() === r);
    if (!b) throw new Fail(EXIT.PRECONDITION, `no bot matches --lead ${leadRef}`, { hint: `bots: ${bots.map((x) => x.name).join(", ")}` });
    return b;
  }
  const chief = bots.find((b) => b.chiefOfStaff === true) ?? (chiefName ? bots.find((b) => sameName(b.name, chiefName)) : undefined);
  if (!chief) throw new Fail(EXIT.PRECONDITION, "no chief of staff among these bots", { hint: "pass --lead <name>" });
  return chief;
}

verb("bind", {
  options: { default: { type: "string" }, reviewers: { type: "string" }, model: { type: "string", multiple: true }, approval: { type: "string" }, "approval-for": { type: "string", multiple: true }, "peer-approval": { type: "string", multiple: true }, "no-room": { type: "boolean" } },
  handler: stateCommand(async ({ flags, cfg, save }) => {
    if (cfg.mode === "remote") throw new Fail(EXIT.PRECONDITION, "bind needs the project checkout on the server's machine");
    requireDataDir(cfg, "bind");
    const team = requireTeam(cfg);
    const approval = flags.approval ?? "auto";
    if (!["auto", "ask"].includes(approval)) throw new Fail(EXIT.USAGE, `--approval must be auto or ask`);
    const perBot = (list, flag, { form, value }) => {
      const map = new Map();
      for (const spec of list ?? []) {
        const eq = spec.indexOf("=");
        if (eq < 0) throw new Fail(EXIT.USAGE, `${flag} wants <bot>=${form}, got "${spec}"`);
        const bot = findBot(team, spec.slice(0, eq));
        if (!bot) throw new Fail(EXIT.USAGE, `no team bot named ${spec.slice(0, eq)}`, { hint: `bots: ${team.bots.map((b) => b.name).join(", ")}` });
        const v = value(spec.slice(eq + 1));
        if (v === undefined) throw new Fail(EXIT.USAGE, `${flag} wants <bot>=${form}, got "${spec}"`);
        map.set(bot.id, v);
      }
      return map;
    };
    const overrides = perBot(flags.model, "--model", { form: "<engine>/<model>[/<effort>]", value: parseEngineSpec });
    const approvalFor = perBot(flags["approval-for"], "--approval-for", { form: "ask|auto", value: (v) => (["ask", "auto"].includes(v) ? v : undefined) });
    const peerApproval = perBot(flags["peer-approval"], "--peer-approval", { form: "on|off", value: (v) => (v === "on" ? true : v === "off" ? false : undefined) });
    const defaultSpec = flags.default ? parseEngineSpec(flags.default) : null;
    const reviewerSpec = flags.reviewers ? parseEngineSpec(flags.reviewers) : null;
    const client = createClient(cfg);
    await requireSameEnvironment(cfg, client);
    const fleet = await client.get("/api/bots?messages=0");
    const ids = new Set(team.bots.map((b) => b.id));
    const live = (fleet.bots ?? []).filter((b) => ids.has(b.id));
    if (live.length !== team.bots.length) throw new Fail(EXIT.PRECONDITION, `${team.bots.length - live.length} team bot(s) no longer exist on the server`, { hint: "re-import or adopt the team" });
    const busy = live.filter((b) => b.busy);
    if (busy.length) throw new Fail(EXIT.PRECONDITION, `bots are working: ${busy.map((b) => b.name).join(", ")}`, { hint: "bind when the team is idle" });
    const projectDir = cfg.projectDir;
    const results = { rooms: [], bots: [], conflicts: [], skipped: [], exclude: [] };
    if (!cfg.dryRun) results.exclude = ensureExclude(projectDir, [".worktrees/", ".omb/"]);
    if (!flags["no-room"]) {
      for (const room of team.rooms ?? []) {
        const g = (fleet.groups ?? []).find((x) => x.id === room.id);
        if (!g) { results.conflicts.push({ room: room.name, error: "the room no longer exists" }); continue; }
        if (g.cwd === projectDir) { results.rooms.push({ room: room.name, cwd: projectDir, changed: false }); continue; }
        try { await client.patch(`/api/groups/${room.id}`, { cwd: projectDir }); results.rooms.push({ room: room.name, cwd: projectDir, changed: true }); }
        catch (e) { if (e instanceof HttpError) results.conflicts.push({ room: room.name, status: e.status, error: e.body?.error ?? e.message }); else throw e; }
      }
    }
    for (const bot of live) {
      const entry = { bot: bot.name, changes: [] };
      try {
        if (bot.cwd !== projectDir) { await client.patch(`/api/bots/${bot.id}`, { cwd: projectDir }); entry.changes.push("cwd"); }
        const wanted = overrides.get(bot.id) ?? (isReviewer(bot) && reviewerSpec ? reviewerSpec : defaultSpec);
        let selection = bot.modelSelection;
        if (wanted && !sameSelection(wanted, bot.modelSelection)) { const r = await client.patch(`/api/bots/${bot.id}/model`, wanted); selection = r?.bot?.modelSelection ?? wanted; entry.changes.push(`model ${specString(wanted)}`); }
        entry.model = specString(selection);
        const level = approvalFor.get(bot.id) ?? approval;
        if (selection?.instanceId === "grok" && level === "auto") {
          results.skipped.push({ bot: bot.name, why: "a grok bot has no auto approval level; it stays on ask" });
          // A never-PATCHed bot has no approvalMode field (store.ts:1303-1335) and runs as ask (shared/approval-mode.ts:32-43); write it so state and roster can say so (index.ts:10145-10168 accepts it for a grok bot).
          if (bot.approvalMode == null) { await client.patch(`/api/bots/${bot.id}`, { approvalMode: "ask" }); entry.changes.push("approval ask"); }
          entry.approvalMode = bot.approvalMode ?? "ask";
        } else if (bot.approvalMode !== level) { await client.patch(`/api/bots/${bot.id}`, { approvalMode: level }); entry.changes.push(`approval ${level}`); entry.approvalMode = level; }
        else entry.approvalMode = bot.approvalMode;
        // approvePeerComms gates ask_bot, post_to_room and delegate_bot behind a "@X wants to contact @Y" card (index.ts:7842-7851, 8113-8123; delegations.ts:514; peer-approval.ts:95-119); the PATCH takes a boolean only (index.ts:10212-10217).
        const peer = peerApproval.get(bot.id);
        if (peer !== undefined && (bot.approvePeerComms === true) !== peer) { await client.patch(`/api/bots/${bot.id}`, { approvePeerComms: peer }); entry.changes.push(`peer-approval ${peer ? "on" : "off"}`); }
        entry.approvePeerComms = peer ?? (bot.approvePeerComms === true);
      } catch (e) {
        if (e instanceof HttpError) { results.conflicts.push({ bot: bot.name, status: e.status, error: e.body?.error ?? e.message, after: entry.changes }); }
        else throw e;
      }
      results.bots.push(entry);
    }
    if (!cfg.dryRun) {
      const after = await client.get("/api/bots?messages=0");
      await save( (doc) => {
        doc.project = { ...(doc.project ?? {}), dir: projectDir, defaultBranch: doc.facts?.defaultBranch ?? defaultBranch(projectDir, doc.facts) };
        doc.team.bots = doc.team.bots.map((b) => { const l = (after.bots ?? []).find((x) => x.id === b.id); return l ? { ...b, model: specString(l.modelSelection), approvalMode: l.approvalMode ?? null } : b; });
        if (doc.team.lead) { const l = (after.bots ?? []).find((x) => x.id === doc.team.lead.id); if (l) doc.team.lead = { ...doc.team.lead, model: specString(l.modelSelection), approvalMode: l.approvalMode ?? null }; }
        return doc;
      });
    }
    const code = results.conflicts.length ? EXIT.PRECONDITION : EXIT.OK;
    return { code, ok: code === EXIT.OK, result: { project: projectDir, dryRun: cfg.dryRun, ...results, roster: results.bots.map((b) => `${b.bot}: ${b.model ?? "unchanged"} (${b.approvalMode ?? "unset"})`) },
      brief: `bind · ${projectDir} · ${results.bots.map((b) => `${b.bot} ${b.model}`).join(", ")}${results.conflicts.length ? ` · ${results.conflicts.length} conflict(s)` : ""}` };
  }),
});

verb("facts", {
  options: { "default-branch": { type: "string" }, test: { type: "string" }, setup: { type: "string" }, merge: { type: "string" }, "task-log": { type: "string" }, tracker: { type: "string" }, "plan-review": { type: "string" }, text: { type: "string" }, append: { type: "boolean" } },
  handler: stateCommand(async ({ flags, cfg, save }) => {
    if (cfg.mode === "remote") throw new Fail(EXIT.PRECONDITION, "facts needs the server's machine and the project checkout");
    requireDataDir(cfg, "facts");
    const team = requireTeam(cfg);
    const client = createClient(cfg);
    await requireSameEnvironment(cfg, client);
    const fleet = await client.get("/api/bots?messages=0");
    const lead = (fleet.bots ?? []).find((b) => b.id === team.lead.id);
    if (!lead) throw new Fail(EXIT.PRECONDITION, `the lead ${team.lead.name} no longer exists on the server`);
    const description = lead.description ?? "";
    const inBlock = description.includes(FACTS_MARKER) ? parseFacts(description.slice(description.indexOf(FACTS_MARKER))) : {};
    const existing = { ...inBlock, ...(cfg.state.facts ?? {}) };
    let block; let facts;
    if (flags.text) { block = flags.text.startsWith(FACTS_MARKER) ? flags.text : `${FACTS_MARKER}: ${flags.text}`; facts = { ...existing, ...parseFacts(block) }; }
    else {
      if (flags.merge && !["auto", "ask"].includes(flags.merge)) throw new Fail(EXIT.USAGE, "--merge must be auto or ask");
      if (flags["plan-review"] && !["ask", "delegate"].includes(flags["plan-review"])) throw new Fail(EXIT.USAGE, "--plan-review must be ask or delegate");
      facts = {
        defaultBranch: flags["default-branch"] ?? cfg.state.facts?.defaultBranch ?? defaultBranch(cfg.projectDir, null) ?? inBlock.defaultBranch,
        test: flags.test ?? existing.test ?? "<fill in>", setup: flags.setup ?? existing.setup ?? "none", merge: flags.merge ?? existing.merge ?? "auto",
        taskLog: flags["task-log"] ?? existing.taskLog ?? "none", tracker: flags.tracker ?? existing.tracker ?? "none", planReview: flags["plan-review"] ?? existing.planReview ?? "ask",
      };
      block = renderFacts(facts);
    }
    const next = replaceFactsBlock(description, block, { append: flags.append === true });
    if (next.length >= MAX_DESCRIPTION) throw new Fail(EXIT.PRECONDITION, `the description would be ${next.length} characters; the limit is ${MAX_DESCRIPTION - 1}`, { hint: `shorten the block by ${next.length - MAX_DESCRIPTION + 1} characters` });
    if (!cfg.dryRun) {
      try { await client.patch(`/api/bots/${lead.id}`, { description: next }); } catch (e) { throw precondition(e); }
      await save( (doc) => { doc.facts = facts; doc.project = { ...(doc.project ?? { dir: cfg.projectDir }), defaultBranch: facts.defaultBranch }; return doc; });
    }
    return { result: { dryRun: cfg.dryRun, lead: lead.name, length: next.length, block, facts }, brief: `facts · ${block}` };
  }),
});
