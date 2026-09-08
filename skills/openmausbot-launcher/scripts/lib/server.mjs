// Server lifecycle: spawn `serve` detached, prove the listener is the child of
// the supervisor we started, and verify that identity before ever signalling.
// Linux only: identities come from /proc (design, "Modes" and the `up`/`down`
// rows). The real CLI spawns the server as a child (server/cli.ts:455) and
// /api/health answers with the child's pid (server/index.ts:11363).
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { EXIT, Fail } from "./cli.mjs";
import { HttpError } from "./http.mjs";

export const STRIPPED_ENV = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY", "OMB_TOKEN"];
export const hasProc = () => process.platform === "linux" && fs.existsSync("/proc/self/stat");

/** pid, ppid, start ticks, and argv of a process, or null when it is gone or unreadable. */
export function procInfo(pid) {
  if (!hasProc() || !Number.isInteger(pid) || pid <= 0) return null;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    const fields = stat.slice(close + 2).split(" "); // fields[0] is field 3 (state)
    const ppid = Number(fields[1]);
    const startTicks = Number(fields[19]); // field 22
    let cmdline = [];
    try { cmdline = fs.readFileSync(`/proc/${pid}/cmdline`).toString().split("\0").filter(Boolean); } catch {}
    return { pid, ppid, startTicks, cmdline, alive: fields[0] !== "Z" };
  } catch { return null; }
}

/** One GET whose failure keeps its cause: a network error stays distinguishable from an HTTP status. */
export async function probe(client, route, opts = {}) {
  try { return { ok: true, body: await client.get(route, opts) }; }
  catch (e) {
    if (e.network) return { ok: false, network: e };
    if (e instanceof HttpError) return { ok: false, status: e.status, body: e.body, error: e };
    throw e;
  }
}

/** A network failure from http.mjs told as the operator's story: the URL, the cause, and what to do about it. */
export function unreachable(url, err) {
  const cause = String(err?.message ?? err).replace(/^[A-Z]+ \S+: /, "");
  const code = /\b(E[A-Z]{3,})\b/.exec(cause)?.[1] ?? null;
  const within = /within (\d+) ms/.exec(cause)?.[1];
  const hint = code === "ECONNREFUSED" ? `nothing is listening at ${url}: run up, or check --url`
    : code === "EPERM" || code === "EACCES" ? "the shell's sandbox blocks outbound connections: run this command outside the sandbox (escalation), or use --remote against a reachable URL"
    : within ? `the server did not answer within ${within} ms` : undefined;
  return new Fail(EXIT.ERROR, `cannot reach ${url}: ${cause}`, hint ? { hint } : {});
}

export async function health(client, opts = {}) {
  const p = await probe(client, "/api/health", opts);
  if (p.ok) return p.body && p.body.app === "openmausbot" ? p.body : null;
  if (p.network) return null;
  throw p.error;
}
export async function environment(client, opts = {}) {
  const p = await probe(client, "/.well-known/openmausbot/environment", opts);
  if (p.ok) return p.body;
  if (p.network) return null;
  throw p.error;
}

export async function waitHealthy(client, timeoutMs, isDead) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const h = await health(client, { timeoutMs: 2000 });
    if (h) return h;
    if (isDead?.()) return null;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

/** Spawn `serve` as a detached process group with the provider keys and any token removed. */
export function spawnServer({ command, port, dataDir, label, askTimeoutMs, log, env = process.env }) {
  const childEnv = { ...env };
  for (const k of STRIPPED_ENV) delete childEnv[k];
  childEnv.OMB_ASK_BOT_TIMEOUT_MS = String(askTimeoutMs);
  const args = [...command.slice(1), "serve", "--port", String(port), "--data-dir", dataDir, "--no-pair", ...(label ? ["--label", label] : [])];
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const fd = fs.openSync(log, "a");
  const child = spawn(command[0], args, { detached: true, stdio: ["ignore", fd, fd], env: childEnv });
  fs.closeSync(fd);
  const pid = child.pid;
  let exited = null;
  child.on("exit", (code) => { exited = code ?? 1; });
  child.unref();
  return { pid, args: [command[0], ...args], isDead: () => exited !== null };
}

/** After spawning: the health pid must be a live child of our supervisor. Returns the identity record. */
export async function proveOwnership({ supervisorPid, client, dataDir, url, version, askTimeoutMs, log }) {
  const h = await health(client);
  if (!h) throw new Fail(EXIT.ERROR, "the server stopped answering while its identity was being recorded");
  const sup = procInfo(supervisorPid);
  const child = procInfo(h.pid);
  if (!sup || !sup.alive) throw new Fail(EXIT.PRECONDITION, `the supervisor pid ${supervisorPid} is not alive`, { hint: `see ${log}` });
  if (!child || !child.alive) throw new Fail(EXIT.PRECONDITION, `the health pid ${h.pid} is not alive`);
  if (child.ppid !== supervisorPid) {
    throw new Fail(EXIT.PRECONDITION, `the listener on ${url} (pid ${h.pid}, parent ${child.ppid}) is not the child of the server this launcher started (pid ${supervisorPid})`, { hint: "another server owns that port; choose another --port or attach without --fresh" });
  }
  const env = await environment(client);
  if (!env?.environmentId) throw new Fail(EXIT.PRECONDITION, "the started server's environment identity could not be verified", { hint: `check ${url} and ${log}; supervisor ${supervisorPid}, server ${h.pid}` });
  return { url, owned: true, supervisorPid, supervisorStart: sup.startTicks, healthPid: h.pid, healthStart: child.startTicks, environmentId: env.environmentId, dataDir, version, askTimeoutMs, log, startedAt: new Date().toISOString() };
}

/** Is the recorded owned server still exactly that server? */
export async function verifyOwned(server, client) {
  const reasons = [];
  if (!server) return { ok: false, reasons: ["no server is recorded in the state"] };
  if (!server.owned) return { ok: false, reasons: ["the recorded server is attached, not owned"] };
  if (!hasProc()) return { ok: false, reasons: ["process identities need /proc (Linux)"] };
  const sup = procInfo(server.supervisorPid);
  const child = procInfo(server.healthPid);
  if (!sup?.alive) reasons.push(`supervisor pid ${server.supervisorPid} is not alive`);
  else if (sup.startTicks !== server.supervisorStart) reasons.push(`pid ${server.supervisorPid} was reused by another process`);
  else if (!sup.cmdline.includes("serve")) reasons.push(`pid ${server.supervisorPid} is not a serve process`);
  if (!child?.alive) reasons.push(`server pid ${server.healthPid} is not alive`);
  else if (child.startTicks !== server.healthStart) reasons.push(`pid ${server.healthPid} was reused by another process`);
  else if (child.ppid !== server.supervisorPid) reasons.push(`pid ${server.healthPid} is not a child of ${server.supervisorPid}`);
  const h = client ? await health(client) : null;
  if (client && !h) reasons.push(`nothing answers at ${server.url}`);
  else if (h && h.pid !== server.healthPid) reasons.push(`${server.url} is answered by pid ${h.pid}, not ${server.healthPid}`);
  if (!server.environmentId) reasons.push("the recorded environment id is missing");
  if (client && h) {
    const env = await environment(client);
    if (!env?.environmentId) reasons.push("the live environment id could not be verified");
    else if (env.environmentId !== server.environmentId) reasons.push("the environment id changed");
  }
  return { ok: reasons.length === 0, reasons };
}

export async function stopOwned(server, { timeoutMs = 15_000 } = {}) {
  process.kill(server.supervisorPid, "SIGTERM");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sup = procInfo(server.supervisorPid); const child = procInfo(server.healthPid);
    if (!sup?.alive && !child?.alive) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

export function readEnviron(pid) {
  try { return fs.readFileSync(`/proc/${pid}/environ`).toString().split("\0").filter(Boolean).map((kv) => kv.split("=")[0]); } catch { return null; }
}

export function freshDataDir(base, { dryRun = false } = {}) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const prefix = `${base}-${stamp}-`;
  if (dryRun) return `${prefix}<unique>`;
  fs.mkdirSync(path.dirname(base), { recursive: true, mode: 0o700 });
  return fs.mkdtempSync(prefix);
}

export function serveLogPath(dataDir) { return path.join(dataDir, "serve.log"); }

/** The last lines of the server log, for error hints. */
export function logTail(file, lines = 12) {
  try { const all = fs.readFileSync(file, "utf8").trimEnd().split("\n"); return all.slice(-lines).join("\n"); } catch { return ""; }
}

/** The signature of a sandbox that denies listening sockets: the `listen EPERM` line, or Node's `code: 'EPERM'` property lines below the stack. */
export const SANDBOX_RE = /listen (EPERM|EACCES)|operation not permitted|code: '(EPERM|EACCES)'/i;

/** The first line of the whole log matching `re`, or null: the signature can sit far above the display tail (a real sandboxed serve.log is 25 lines with the match on line 3). */
export function logMatch(file, re) {
  try { return fs.readFileSync(file, "utf8").split("\n").find((l) => re.test(l))?.trim() ?? null; } catch { return null; }
}
