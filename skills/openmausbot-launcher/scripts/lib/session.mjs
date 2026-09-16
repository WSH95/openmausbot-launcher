// Command transactions and verified server bindings shared by the verbs.
import fs from "node:fs";
import path from "node:path";
import { EXIT, Fail } from "./cli.mjs";
import { resolveConfig } from "./config.mjs";
import { withLock, loadState, initState, commitState } from "./state.mjs";
import { probe, unreachable, refusal, hasProc, procInfo, verifyOwned } from "./server.mjs";
import { createClient } from "./http.mjs";

/** Serialize a mutating command from its preflight through its side effects.
 * A stale caller must retry with fresh state rather than mutate a newer run.
 * Dry runs never acquire or create a lock, and cannot call save. */
export function stateCommand(handler, { lockWhen = () => true } = {}) {
  return async (ctx) => {
    const cfg = resolveConfig(ctx.flags);
    const observedRev = cfg.state?.rev ?? null;
    let locked = false;
    const save = async (mutate) => {
      if (!locked || cfg.dryRun) throw new Error("state save outside a command transaction");
      const doc = cfg.state ?? initState(cfg.projectDir);
      const next = (await mutate(doc)) ?? doc;
      cfg.state = commitState(cfg.paths, next);
      return cfg.state;
    };
    const invoke = () => handler({ ...ctx, cfg, save });
    if (cfg.dryRun || !lockWhen(ctx)) return invoke();
    return withLock(cfg.paths, async () => {
      const fresh = loadState(cfg.paths);
      if ((fresh?.rev ?? null) !== observedRev) throw new Fail(EXIT.PRECONDITION, "state changed while this command waited for the lock", { hint: "another launcher changed the run or binding; re-read the state and retry" });
      cfg.state = fresh;
      locked = true;
      try { return await invoke(); } finally { locked = false; }
    });
  };
}

export function requireTeam(cfg) {
  if (!cfg.state?.team) throw new Fail(EXIT.PRECONDITION, "no team is recorded for this project", { hint: "run import <package.json> or import --adopt <section>" });
  return cfg.state.team;
}

export function requireDataDir(cfg, verb) {
  if (cfg.mode === "remote" || !cfg.dataDirReadable) throw new Fail(EXIT.PRECONDITION, `${verb} needs the server's readable data dir and the project checkout`, { hint: `run it on the server's machine with --data-dir pointing to its data dir (${cfg.dataDir})` });
}

export function verifyDataDir(cfg, environmentId) {
  let local;
  try { local = fs.readFileSync(path.join(cfg.dataDir, "environment-id"), "utf8").trim(); }
  catch { throw new Fail(EXIT.PRECONDITION, `cannot verify the data dir identity at ${cfg.dataDir}`, { hint: "pass --data-dir for this server, or use --remote for HTTP-only commands" }); }
  if (!local || local !== environmentId) throw new Fail(EXIT.PRECONDITION, "the data dir does not belong to this server", { hint: "pass the matching --data-dir" });
}

export async function serverIdentity(cfg, client, opts = {}) {
  const request = { ...opts, timeoutMs: Math.min(client.timeoutMs ?? 15000, opts.timeoutMs ?? Infinity) };
  const [envP, hP] = await Promise.all([probe(client, "/.well-known/openmausbot/environment", request), probe(client, "/api/health", request)]);
  // A blocked or absent network is a network story (exit 1), never "identity could not be verified".
  if (envP.network && hP.network) throw unreachable(client.url, hP.network);
  for (const p of [hP, envP]) if (!p.ok && !p.network) throw refusal(client.url, p);
  const env = envP.ok ? envP.body : null;
  const h = hP.ok && hP.body?.app === "openmausbot" ? hP.body : null;
  if (!env?.environmentId || !Number.isInteger(h?.pid) || h.pid <= 0) throw new Fail(EXIT.PRECONDITION, "the server identity could not be verified", { hint: "check the URL and server, then import --adopt or re-import" });
  let start = null;
  if (cfg.mode === "local" && hasProc()) {
    const info = procInfo(h.pid);
    if (!info?.alive) throw new Fail(EXIT.PRECONDITION, "the live server process identity could not be verified", { hint: "run on the server's machine, or pass --remote for an HTTP connection" });
    start = info.startTicks;
  }
  if (cfg.mode === "local" && cfg.dataDirReadable) verifyDataDir(cfg, env.environmentId);
  return { ...env, healthPid: h.pid, healthStart: start };
}

/**
 * The team is bound to a server's environment id, not to one URL: the same
 * server answers at `http://127.0.0.1:8899` on its own machine and at
 * `https://<tailnet host>` through a tunnel, and a run opened locally has to
 * stay watchable and interruptible from the other end without rebinding the
 * state (bead oml-9kp). So a remote observer may reach the recorded server by
 * any path, as long as the live environment id is the recorded one. Local
 * mode keeps the URL rule, where another loopback port is another server
 * rather than another way to the same one. Every other comparison stands.
 */
export async function requireSameEnvironment(cfg, client, opts = {}) {
  const live = await serverIdentity(cfg, client, opts);
  const recorded = cfg.state?.server;
  if (!cfg.state?.team?.environmentId || cfg.state.team.environmentId !== live.environmentId || (cfg.mode === "local" && recorded?.url !== cfg.url) || recorded?.environmentId !== live.environmentId || recorded.healthPid !== live.healthPid || (cfg.mode === "local" && hasProc() && recorded.healthStart !== live.healthStart)) {
    throw new Fail(EXIT.PRECONDITION, "the server is not the one this team was imported on (identity changed or missing)", { hint: "re-import the package or run import --adopt to establish the current server binding" });
  }
  return live;
}

/** Missing /proc information is not evidence of death. PID reuse does prove
 * that the recorded process ended; the replacement process is never killed. */
function processStopped(pid, start) {
  if (!hasProc() || !Number.isInteger(pid) || pid <= 0 || !Number.isFinite(start)) return false;
  const info = procInfo(pid);
  if (info) return !info.alive || info.startTicks !== start;
  try { process.kill(pid, 0); return false; } catch (e) { return e.code === "ESRCH"; }
}

export async function protectServerSelection(cfg, url) {
  const recorded = cfg.state?.server;
  if (!recorded?.owned) return false;
  const stopped = processStopped(recorded.supervisorPid, recorded.supervisorStart) && processStopped(recorded.healthPid, recorded.healthStart);
  if (stopped) return false;
  let verified;
  try { verified = await verifyOwned(recorded, createClient({ url: recorded.url })); } catch { verified = { ok: false }; }
  if (verified.ok && recorded.url === url) return true;
  throw new Fail(EXIT.PRECONDITION, verified.ok ? `a server this launcher owns is running at ${recorded.url}` : `the owned server at ${recorded.url} has not been proven stopped`, { hint: verified.ok ? "run down first before changing servers" : "verify or stop the recorded server before changing its ownership record" });
}

/** Immutable, token-free context kept with a run for offline reports. */
export function runContext(cfg) {
  const s = cfg.state?.server ?? {};
  return { server: { url: s.url, environmentId: s.environmentId, healthPid: s.healthPid, healthStart: s.healthStart, dataDir: s.dataDir, version: s.version }, team: structuredClone(cfg.state?.team ?? null), facts: structuredClone(cfg.state?.facts ?? null) };
}
