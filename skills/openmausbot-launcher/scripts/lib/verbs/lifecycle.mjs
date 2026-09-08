import { stateCommand, requireSameEnvironment, requireDataDir, serverIdentity, protectServerSelection, runContext } from "../session.mjs";
// doctor, up, down (design: the verb table, "Modes", and lib/server.mjs).
import fs from "node:fs";
import path from "node:path";
import { verb, EXIT, Fail } from "../cli.mjs";
import { resolveConfig, resolveBinary } from "../config.mjs";
import { createClient } from "../http.mjs";
import { updateState, identityMatches } from "../state.mjs";
import { gitAvailable, gitTopLevel } from "../git.mjs";
import * as srv from "../server.mjs";
import { scanOrphans } from "../proc.mjs";

const num = (v, d) => (v === undefined ? d : Number(v));

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
  for (const f of [path.join(projectDir, ".git", "info", "exclude"), path.join(projectDir, ".gitignore")]) {
    try { if (fs.readFileSync(f, "utf8").split("\n").some((l) => l.trim() === ".project-steward/runtime/")) runtimeExcluded = true; } catch {}
  }
  return { present: true, mode, runtimeExcluded };
}

verb("doctor", {
  options: { server: { type: "boolean" } },
  handler: async ({ flags }) => {
    const cfg = resolveConfig(flags);
    const checks = [];
    const check = (id, ok, required, detail) => { checks.push({ id, ok, required, detail }); };
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
      task: state?.task ? { runId: state.task.runId, status: state.task.status, title: state.task.title } : null,
    };
    let engines = [];
    if (flags.server) {
      const client = createClient(cfg);
      const h = await srv.health(client);
      check("health", Boolean(h), true, h ? `${cfg.url} answers, pid ${h.pid}` : `nothing answers at ${cfg.url}`);
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
    const baseDataDir = path.resolve(flags["data-dir"] ?? cfg.env.OMB_DATA_DIR ?? cfg.state?.server?.dataDir ?? cfg.dataDir);
    let dataDir = flags.fresh ? srv.freshDataDir(baseDataDir, { dryRun: true }) : baseDataDir;
    const client = createClient({ url });
    const recorded = cfg.state?.server;
    await protectServerSelection(cfg, url);
    if (recorded?.owned && recorded.url === url) {
      const v = await srv.verifyOwned(recorded, client);
      if (v.ok) {
        if (flags.fresh) throw new Fail(EXIT.PRECONDITION, "a server this launcher owns is running", { hint: "run down first, then up --fresh" });
        return { result: { status: "owned", changed: false, ...recorded }, brief: `up · owned · ${url} · pid ${recorded.healthPid} · unchanged` };
      }
    }
    const h = await srv.health(client);
    if (h) {
      if (flags.fresh) throw new Fail(EXIT.PRECONDITION, `port ${port} is in use by a server this launcher does not own`, { hint: "choose another --port or drop --fresh to attach" });
      const identity = await serverIdentity({ ...cfg, url }, client);
      const server = { url, owned: false, healthPid: identity.healthPid, healthStart: identity.healthStart, environmentId: identity.environmentId, dataDir: cfg.dataDirReadable ? cfg.dataDir : null, version: identity.version ?? null, attachedAt: new Date().toISOString() };
      if (cfg.dryRun) return { result: { dryRun: true, status: "attached", changed: false, ...server }, brief: `up · dry run · would attach ${url}` };
      await save( (doc) => { doc.server = server; return doc; });
      return { result: { status: "attached", changed: true, ...server }, brief: `up · attached · ${url} · pid ${h.pid}` };
    }
    if (!srv.hasProc()) throw new Fail(EXIT.PRECONDITION, "starting a server needs Linux (/proc identities)", { hint: "start openmausbot serve yourself, then run up to attach" });
    const bin = resolveBinary(cfg.env);
    if (!bin.command) throw new Fail(EXIT.PRECONDITION, bin.error);
    const askTimeoutMs = num(flags["ask-timeout-ms"], 600_000);
    // The server takes two consecutive ports (server/index.ts:319-320, cli.ts:438); refuse before any spawn or directory.
    if (!cfg.dryRun && !(await srv.portFree(port + 1))) throw new Fail(EXIT.PRECONDITION, `port ${port + 1} is in use; OpenMausBot binds ${port}+1 for its webhook receiver (server/index.ts:320, cli.ts:438)`, { hint: "choose a port whose neighbour is free" });
    if (flags.fresh && !cfg.dryRun) dataDir = srv.freshDataDir(baseDataDir);
    const log = srv.serveLogPath(dataDir);
    const timeoutMs = num(flags.timeout, 60) * 1000;
    if (cfg.dryRun) {
      const args = [...bin.command, "serve", "--port", String(port), "--data-dir", dataDir, "--no-pair", ...(flags.label ? ["--label", flags.label] : [])];
      return { result: { dryRun: true, command: args, url, ports: [port, port + 1], dataDir, log, strippedEnv: srv.STRIPPED_ENV, askTimeoutMs }, brief: `up · dry run · ${args.join(" ")}` };
    }
    const sp = srv.spawnServer({ command: bin.command, port, dataDir, label: flags.label, askTimeoutMs, log, env: cfg.env });
    const healthy = await srv.waitHealthy(client, timeoutMs, sp.isDead);
    if (!healthy) {
      const tail = srv.logTail(log);
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
  options: { timeout: { type: "string" } },
  handler: stateCommand(async ({ flags, cfg, save }) => {
    const server = cfg.state?.server;
    if (!server) throw new Fail(EXIT.PRECONDITION, "no server is recorded in the state", { hint: "nothing to stop; up records the server it starts" });
    if (!server.owned) throw new Fail(EXIT.PRECONDITION, "the recorded server is attached, not owned", { hint: "stop it where you started it" });
    const client = createClient({ url: server.url });
    const v = await srv.verifyOwned(server, client);
    if (!v.ok) throw new Fail(EXIT.PRECONDITION, `refusing to stop: ${v.reasons.join("; ")}`, { hint: "if that server is gone, run up to record a new one" });
    if (cfg.dryRun) return { result: { dryRun: true, signal: "SIGTERM", supervisorPid: server.supervisorPid }, brief: `down · dry run · SIGTERM ${server.supervisorPid}` };
    const stopped = await srv.stopOwned(server, { timeoutMs: num(flags.timeout, 15) * 1000 });
    if (!stopped) throw new Fail(EXIT.ERROR, "the server did not exit after SIGTERM", { hint: `pids ${server.supervisorPid} and ${server.healthPid} are still alive; see ${server.log}` });
    await save( (doc) => { doc.server = { ...server, owned: false, supervisorPid: null, healthPid: null, supervisorStart: null, healthStart: null, stoppedAt: new Date().toISOString() }; return doc; });
    const scan = scanOrphans({ pattern: "codex-linux-sandbox", worktreesDir: path.join(cfg.projectDir, ".worktrees") });
    return { result: { stopped: true, supervisorPid: server.supervisorPid, healthPid: server.healthPid, url: server.url, orphans: scan.orphans }, brief: `down · stopped ${server.url}${scan.orphans.length ? ` · ${scan.orphans.length} orphan(s): run cleanup --kill` : ""}` };
  }),
});
