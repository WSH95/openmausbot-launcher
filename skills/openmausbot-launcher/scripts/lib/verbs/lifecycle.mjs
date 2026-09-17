import { stateCommand, requireSameEnvironment, requireDataDir, serverIdentity, protectServerSelection, runContext } from "../session.mjs";
// doctor, up, down (design: the verb table, "Modes", and lib/server.mjs).
import fs from "node:fs";
import path from "node:path";
import { verb, EXIT, Fail } from "../cli.mjs";
import { resolveConfig, resolveBinary } from "../config.mjs";
import { createClient } from "../http.mjs";
import { updateState, identityMatches } from "../state.mjs";
import { openRuns } from "../runs.mjs";
import { gitAvailable, gitTopLevel, gitPath } from "../git.mjs";
import * as srv from "../server.mjs";
import { scanOrphans } from "../proc.mjs";
import { membership, foreignFolders, observeOthers, describeOthers, cap } from "../others.mjs";

const num = (v, d) => (v === undefined ? d : Number(v));

// What `up` says about a server it shares. This reports configuration, not
// activity: an empty list does not prove the server is unshared (a bot can have
// no folder at all, and two projects can share ids), and a failed read is
// unknown rather than empty. None of it is persisted.
const SHARED_ATTACHED = "the server also carries bots configured for other folders: a free port pair with --data-dir <dir>, or --fresh, gives this project a server of its own";
const SHARED_OWNED = "the server also carries bots configured for other folders: a server of its own means resolving this ownership first, normally after the other work finishes and down succeeds";

async function sharedServer(client, cfg, environmentId) {
  let fleet;
  try { fleet = await client.get("/api/bots?messages=0"); } catch { return { otherConfiguredFoldersKnown: false }; }
  const { ours } = membership(cfg.state, environmentId);
  const folders = foreignFolders(fleet, { projectDir: cfg.projectDir, ours });
  return { otherConfiguredFoldersKnown: true, otherConfiguredFolders: cap(folders), otherConfiguredFolderCount: folders.length };
}

/** `[session] auto_handoff_mode` from a Project Steward config.toml, if the file exists. */
export function stewardHookMode(projectDir) {
  const file = path.join(projectDir, ".project-steward", "config.toml");
  if (!fs.existsSync(file)) return { present: false };
  const text = fs.readFileSync(file, "utf8");
  let section = null; let mode = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const s = /^\[([^\]]+)\]$/.exec(line); if (s) { section = s[1].trim(); continue; }
    const kv = /^auto_handoff_mode\s*=\s*"?([a-z]+)"?$/.exec(line);
    if (kv && section === "session") mode = kv[1];
  }
  let runtimeExcluded = false;
  for (const f of [gitPath(projectDir, "info/exclude") ?? path.join(projectDir, ".git", "info", "exclude"), path.join(projectDir, ".gitignore")]) {
    try { if (fs.readFileSync(f, "utf8").split("\n").some((l) => l.trim() === ".project-steward/runtime/")) runtimeExcluded = true; } catch {}
  }
  return { present: true, mode, runtimeExcluded };
}

verb("doctor", {
  options: { server: { type: "boolean" } },
  handler: async ({ flags }) => {
    const cfg = resolveConfig(flags);
    const checks = [];
    const check = (id, ok, required, detail, hint) => { checks.push({ id, ok, required, detail, ...(hint ? { hint } : {}) }); };
    const major = Number(process.versions.node.split(".")[0]);
    const needNode = 24;
    check("node", major >= needNode, true, `node ${process.versions.node}; ${cfg.mode} mode needs ${needNode}+`);
    let bin = null;
    if (cfg.mode === "local") {
      bin = resolveBinary(cfg.env);
      check("binary", Boolean(bin.command), true, bin.command ? `${bin.path} (openmausbot ${bin.version}, from ${bin.source})` : bin.error);
    }
    check("git", gitAvailable(), true, "git on PATH");
    const top = gitTopLevel(cfg.projectDir);
    check("project", top !== null, true, top ? `git repository at ${top}` : `${cfg.projectDir} is not inside a git repository`);
    const hook = stewardHookMode(cfg.projectDir);
    if (hook.present) {
      check("stop-hook", hook.mode === "off" && hook.runtimeExcluded, true,
        hook.mode === "off" && hook.runtimeExcluded ? "Project Steward auto_handoff_mode is off and .project-steward/runtime/ is excluded"
          : `Project Steward auto_handoff_mode is ${hook.mode ?? "unset"}${hook.runtimeExcluded ? "" : " and .project-steward/runtime/ is not excluded"}: a Stop hook that injects feedback replaces a Claude bot's report; set auto_handoff_mode = "off" in .project-steward/config.toml and exclude the runtime dir`);
    }
    if (cfg.token && cfg.loopback) check("token", false, false, `${cfg.tokenSource} is set on a loopback URL: the session's scope replaces owner trust`);
    check("data-dir", cfg.dataDirReadable, false, cfg.dataDirReadable ? `${cfg.dataDir} is readable` : `${cfg.dataDir} is not readable (remote mode, or not started yet)`);
    const state = cfg.state;
    const summary = {
      server: state?.server ? { url: state.server.url, owned: state.server.owned === true, healthPid: state.server.healthPid ?? null } : null,
      team: state?.team ? { section: state.team.section, lead: state.team.lead?.name ?? null, bots: state.team.bots?.length ?? 0 } : null,
      runs: openRuns(state).map((r) => ({ runId: r.runId, status: r.status, title: r.title, slug: r.slug ?? null })),
    };
    let engines = [];
    if (flags.server) {
      const client = createClient(cfg);
      const probed = await srv.healthProbe(client);
      const h = probed.body;
      const line = srv.healthCheck(cfg.url, probed);
      check("health", line.ok, true, line.detail, line.hint);
      if (h) {
        const session = await client.get("/api/auth/session");
        const admin = Array.isArray(session.scopes) && session.scopes.includes("admin");
        check("session", admin, cfg.mode === "local", `${session.kind} with scopes ${(session.scopes ?? []).join(",")}`);
        const inst = await client.get("/api/instances");
        engines = (inst.instances ?? []).map((i) => ({ id: i.instanceId, state: i.snapshot?.state ?? "unknown", defaultModel: i.models?.default ?? null, models: i.models?.options ?? [], effortLevels: i.capabilities?.effortLevels ?? [] }));
        check("engines", engines.some((e) => e.state === "available"), true, engines.map((e) => `${e.id}:${e.state}`).join(" ") || "no engines");
        const keys = srv.readEnviron(h.pid);
        if (keys === null) check("provider-keys", null, false, "unknown: the server's environment is not readable");
        else { const leaked = keys.filter((k) => srv.STRIPPED_ENV.includes(k)); check("provider-keys", leaked.length === 0, true, leaked.length ? `the server has ${leaked.join(", ")} in its environment: bots would bill an API key` : "no provider API keys in the server's environment"); }
        if (state?.server?.environmentId) {
          const env = await srv.environment(client);
          const live = { environmentId: env?.environmentId, healthPid: h.pid, healthStart: srv.procInfo(h.pid)?.startTicks };
          check("identity", identityMatches(state.server, live), false, identityMatches(state.server, live) ? "the recorded server identity matches" : "the server is not the one recorded in the state (restarted or replaced): re-import or adopt the team");
        }
      }
    }
    const failed = checks.filter((c) => c.required && c.ok === false);
    return {
      code: failed.length ? EXIT.PRECONDITION : EXIT.OK,
      result: { mode: cfg.mode, url: cfg.url, project: cfg.projectDir, dataDir: cfg.dataDir, checks, engines, state: summary, failed: failed.map((c) => c.id) },
      brief: `doctor · ${cfg.mode} · ${checks.length} checks, ${failed.length} failed${failed.length ? ` (${failed.map((c) => c.id).join(", ")})` : ""}${engines.length ? ` · engines ${engines.filter((e) => e.state === "available").map((e) => e.id).join(", ")}` : ""}`,
    };
  },
});

verb("up", {
  options: { port: { type: "string" }, fresh: { type: "boolean" }, label: { type: "string" }, "ask-timeout-ms": { type: "string" }, timeout: { type: "string" } },
  handler: stateCommand(async ({ flags, cfg, save }) => {
    if (cfg.mode === "remote") throw new Fail(EXIT.PRECONDITION, "up runs on the machine where OpenMausBot runs", { hint: "start the server there, then attach with up on that machine" });
    const port = flags.port !== undefined ? Number(flags.port) : Number(new URL(cfg.url).port || 8799);
    if (!Number.isInteger(port) || port <= 0) throw new Fail(EXIT.USAGE, `bad port ${flags.port}`);
    const url = `http://127.0.0.1:${port}`;
    const baseDataDir = cfg.dataDir; // flags > state > OMB_DATA_DIR > default, config.mjs:69
    let dataDir = flags.fresh ? srv.freshDataDir(baseDataDir, { dryRun: true }) : baseDataDir;
    const client = createClient({ url });
    const recorded = cfg.state?.server;
    await protectServerSelection(cfg, url);
    if (recorded?.owned && recorded.url === url) {
      const v = await srv.verifyOwned(recorded, client);
      if (v.ok) {
        if (flags.fresh) throw new Fail(EXIT.PRECONDITION, "a server this launcher owns is running", { hint: "run down first, then up --fresh" });
        // A server can acquire other users after its first startup, so the
        // unchanged answer reports them too.
        const shared = await sharedServer(client, cfg, recorded.environmentId);
        const withOthers = shared.otherConfiguredFolderCount > 0;
        return { result: { status: "owned", changed: false, ...recorded, ...shared, ...(withOthers ? { hint: SHARED_OWNED } : {}) }, brief: `up · owned · ${url} · pid ${recorded.healthPid} · unchanged${withOthers ? " · shared" : ""}` };
      }
    }
    const h = await srv.health(client);
    if (h) {
      if (flags.fresh) throw new Fail(EXIT.PRECONDITION, `port ${port} is in use by a server this launcher does not own`, { hint: "choose another --port or drop --fresh to attach" });
      const identity = await serverIdentity({ ...cfg, url }, client);
      const server = { url, owned: false, healthPid: identity.healthPid, healthStart: identity.healthStart, environmentId: identity.environmentId, dataDir: cfg.dataDirReadable ? cfg.dataDir : null, version: identity.version ?? null, attachedAt: new Date().toISOString() };
      const shared = await sharedServer(client, cfg, identity.environmentId);
      const withOthers = shared.otherConfiguredFolderCount > 0;
      const seen = { ...shared, ...(withOthers ? { hint: SHARED_ATTACHED } : {}) };
      if (cfg.dryRun) return { result: { dryRun: true, status: "attached", changed: false, ...server, ...seen }, brief: `up · dry run · would attach ${url}${withOthers ? " · shared" : ""}` };
      await save( (doc) => { doc.server = server; return doc; });
      return { result: { status: "attached", changed: true, ...server, ...seen }, brief: `up · attached · ${url} · pid ${h.pid}${withOthers ? " · shared" : ""}` };
    }
    if (!srv.hasProc()) throw new Fail(EXIT.PRECONDITION, "starting a server needs Linux (/proc identities)", { hint: "start openmausbot serve yourself, then run up to attach" });
    const bin = resolveBinary(cfg.env);
    if (!bin.command) throw new Fail(EXIT.PRECONDITION, bin.error);
    const askTimeoutMs = num(flags["ask-timeout-ms"], 600_000);
    // The server takes two consecutive ports (server/index.ts:319-320, cli.ts:438); refuse before any spawn or directory.
    if (!cfg.dryRun && !(await srv.portFree(port + 1))) throw new Fail(EXIT.PRECONDITION, `port ${port + 1} is in use; OpenMausBot binds ${port}+1 for its webhook receiver (server/index.ts:320, cli.ts:438)`, { hint: "choose a port whose neighbour is free" });
    if (flags.fresh && !cfg.dryRun) dataDir = srv.freshDataDir(baseDataDir);
    const log = srv.serveLogPath(dataDir, { dryRun: cfg.dryRun });
    const timeoutMs = num(flags.timeout, 60) * 1000;
    if (cfg.dryRun) {
      const args = [...bin.command, "serve", "--port", String(port), "--data-dir", dataDir, "--no-pair", ...(flags.label ? ["--label", flags.label] : [])];
      return { result: { dryRun: true, command: args, url, ports: [port, port + 1], dataDir, log, strippedEnv: srv.STRIPPED_ENV, askTimeoutMs }, brief: `up · dry run · ${args.join(" ")}` };
    }
    const sp = srv.spawnServer({ command: bin.command, port, dataDir, label: flags.label, askTimeoutMs, log, env: cfg.env });
    const healthy = await srv.waitHealthy(client, timeoutMs, sp.isDead);
    if (!healthy) {
      const tail = srv.logTail(log);
      // Only this attempt's log is read, so a refusal belongs to this startup
      // and not to whoever wrote into the directory before it.
      const lease = srv.leaseRefusal(log);
      if (lease) {
        throw new Fail(EXIT.PRECONDITION, `data directory ${dataDir} is in use by ${lease.by}`, {
          hint: `attach to that server with up --port <its port>, or give this project its own --data-dir or --fresh`,
          log: tail,
        });
      }
      const sandboxLine = srv.logMatch(log, srv.SANDBOX_RE);
      throw new Fail(EXIT.ERROR, sp.isDead() ? "the server exited during startup" : `no health answer from ${url} within ${timeoutMs / 1000} s`, {
        hint: sandboxLine ? `the shell's sandbox blocks listening sockets (${log}: ${sandboxLine}): run up with escalation outside the sandbox, or start the server elsewhere and run up to attach` : `see ${log}`,
        log: tail,
      });
    }
    const server = await srv.proveOwnership({ supervisorPid: sp.pid, client, dataDir, url, version: bin.version, askTimeoutMs, log });
    await save( (doc) => { doc.server = server; return doc; });
    return { result: { status: "owned", changed: true, ports: [port, port + 1], ...server }, brief: `up · started · ${url} · pid ${server.healthPid} · data ${dataDir}` };
  }),
});

verb("down", {
  options: { timeout: { type: "string" }, "stop-others": { type: "boolean" } },
  handler: stateCommand(async ({ flags, cfg, save }) => {
    const server = cfg.state?.server;
    if (!server) throw new Fail(EXIT.PRECONDITION, "no server is recorded in the state", { hint: "nothing to stop; up records the server it starts" });
    if (!server.owned) throw new Fail(EXIT.PRECONDITION, "the recorded server is attached, not owned", { hint: "stop it where you started it" });
    const client = createClient({ url: server.url });
    const unverified = (reasons) => {
      const alive = [server.supervisorPid, server.healthPid].filter((pid) => srv.procInfo(pid)?.alive);
      return new Fail(EXIT.PRECONDITION, `refusing to stop: ${reasons.join("; ")}`, {
        hint: alive.length
          ? `pid(s) ${alive.join(", ")} are alive but no longer match the record, so the launcher will not signal them: verify with ps -o pid,lstart,args -p ${server.supervisorPid},${server.healthPid}, then kill ${server.supervisorPid} yourself (the supervisor stops its child); when both are gone, run up to record a new server`
          : "if that server is gone, run up to record a new one",
      });
    };
    const v = await srv.verifyOwned(server, client);
    if (!v.ok) throw unverified(v.reasons);
    // What `down` protects is other work it has **observed**; an inspection
    // that finds nothing is not proof that there is none, and the race between
    // the last look and the signal is accepted.
    const { others, blocking } = await observeOthers({ client, cfg, environmentId: server.environmentId });
    if (blocking && !flags["stop-others"]) {
      throw new Fail(EXIT.PRECONDITION, `refusing to stop: ${describeOthers(others)}`, { hint: "finish or abandon that work where it runs, or stop this server anyway with down --stop-others", others });
    }
    const overrode = blocking ? describeOthers(others) : "";
    const unknowns = others.counts.unknown ? ` · ${others.counts.unknown} unknown` : "";
    // Ownership is verified again after an inspection that may have been slow,
    // and the process identities are read one last time with nothing awaited
    // between that read and the signal. A preview runs both, so it refuses
    // exactly where the signalling command would.
    const again = await srv.verifyOwned(server, client);
    if (!again.ok) throw unverified(again.reasons);
    srv.assertProcessIdentity(server);
    if (cfg.dryRun) return { result: { dryRun: true, signal: "SIGTERM", supervisorPid: server.supervisorPid, others }, brief: `down · dry run · SIGTERM ${server.supervisorPid}${overrode ? ` · would override ${overrode}` : ""}${unknowns}` };
    const stopped = await srv.stopOwned(server, { timeoutMs: num(flags.timeout, 15) * 1000 });
    if (!stopped) throw new Fail(EXIT.ERROR, "the server did not exit after SIGTERM", { hint: `pids ${server.supervisorPid} and ${server.healthPid} are still alive; see ${server.log}` });
    await save( (doc) => { doc.server = { ...server, owned: false, supervisorPid: null, healthPid: null, supervisorStart: null, healthStart: null, stoppedAt: new Date().toISOString() }; return doc; });
    const scan = scanOrphans({ pattern: "codex-linux-sandbox", worktreesDir: path.join(cfg.projectDir, ".worktrees") });
    return { result: { stopped: true, supervisorPid: server.supervisorPid, healthPid: server.healthPid, url: server.url, orphans: scan.orphans, others }, brief: `down · stopped ${server.url}${overrode ? ` · overrode ${overrode}` : ""}${unknowns}${scan.orphans.length ? ` · ${scan.orphans.length} orphan(s): run cleanup --kill` : ""}` };
  }),
});
