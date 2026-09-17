// Server lifecycle: spawn `serve` detached, prove the listener is the child of
// the supervisor we started, and verify that identity before ever signalling.
// Linux only: identities come from /proc (design, "Modes" and the `up`/`down`
// rows). The real CLI spawns the server as a child (server/cli.ts:455) and
// /api/health answers with the child's pid (server/index.ts:11363).
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { EXIT, Fail } from "./cli.mjs";
import { HttpError } from "./http.mjs";

// Names that must not reach a server this launcher starts: the CLI forwards
// its whole environment (cli.ts:434), a bot would bill a provider key it finds
// there, and OMB_SECRET carries a credential this launcher was asked to save
// once, through `/api/config`, and never to hand to a child.
export const STRIPPED_ENV = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY", "OMB_TOKEN", "OMB_SECRET"];
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

/** OpenMausBot binds port+1 for its webhook receiver (server/index.ts:319-320, cli.ts:438) and keeps running without it (index.ts:4874-4880), so `up` refuses a port whose neighbour is taken rather than start a half-server. */
export function portFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
}

/** The error for a failed non-network probe: a webhook receiver answers everything but /health with 404 `Unknown webhook endpoint` (webhook-ingress.ts:98) and is named with its API port; anything else is the HttpError itself. */
export function refusal(url, p) {
  if (p.status === 404 && /webhook/i.test(p.body?.error ?? "")) {
    const port = Number(new URL(url).port);
    return new Fail(EXIT.PRECONDITION, `${url} is an OpenMausBot webhook receiver; its API is on port ${port - 1}`, { hint: "servers occupy two consecutive ports; space them two apart" });
  }
  return p.error;
}

/** The health probe with its network failure kept, so a caller can tell a dead server from a blocked socket. */
export async function healthProbe(client, opts = {}) {
  const p = await probe(client, "/api/health", opts);
  if (p.ok) return { body: p.body && p.body.app === "openmausbot" ? p.body : null };
  if (p.network) return { body: null, network: p.network };
  throw refusal(client.url, p);
}

/**
 * The doctor's `health` line. A refused connection is a server that is not
 * running ("nothing answers"); every other network cause — a sandbox denying
 * the connect (EPERM/EACCES), a timeout — is a socket the launcher could not
 * use, so it is told as `unreachable()` tells it, cause and hint included.
 */
export function healthCheck(url, p) {
  if (p.body) return { ok: true, detail: `${url} answers, pid ${p.body.pid}` };
  if (!p.network) return { ok: false, detail: `nothing answers at ${url}` };
  const f = unreachable(url, p.network);
  const code = /\b(E[A-Z]{3,})\b/.exec(f.message)?.[1] ?? null;
  return { ok: false, detail: code === "ECONNREFUSED" ? `nothing answers at ${url} (ECONNREFUSED)` : f.message, ...(f.hint ? { hint: f.hint } : {}) };
}

export async function health(client, opts = {}) {
  return (await healthProbe(client, opts)).body;
}
export async function environment(client, opts = {}) {
  const p = await probe(client, "/.well-known/openmausbot/environment", opts);
  if (p.ok) return p.body;
  if (p.network) return null;
  throw refusal(client.url, p);
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

/** The recorded processes, read now: pid alive, start ticks, and the parent
 * link. Synchronous on purpose — an identity read before an awaited request is
 * already old, so this is what runs last, with no await before the signal. */
export function processIdentityOk(server) {
  const sup = procInfo(server.supervisorPid);
  const child = procInfo(server.healthPid);
  return Boolean(sup?.alive && sup.startTicks === server.supervisorStart
    && child?.alive && child.startTicks === server.healthStart && child.ppid === server.supervisorPid);
}

export async function stopOwned(server, { timeoutMs = 15_000 } = {}) {
  if (!processIdentityOk(server)) throw new Fail(EXIT.PRECONDITION, "the recorded processes changed while the server was being verified", { hint: `verify with ps -o pid,lstart,args -p ${server.supervisorPid},${server.healthPid}, then run down again` });
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

/**
 * One log file per spawn. A server refused the data directory writes into it
 * with the same appending stdio as the server that holds the directory
 * (cli.ts:455), and an offset into a shared file cannot say which startup wrote
 * a line, so every startup gets a name of its own. The state records it as
 * `server.log`, as before.
 */
export function serveLogPath(dataDir, { dryRun = false } = {}) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  return path.join(dataDir, `serve.${stamp}.${dryRun ? "<unique>" : randomBytes(4).toString("hex")}.log`);
}

/** Upstream's stale-lease recovery can name a file whose name carries an
 * ownership token (`electron/data-dir-lease.mjs:123-126,159`), so whatever
 * follows the lease's own name never reaches the operator. */
export const redactLease = (text) => text.replace(/openmausbot-server\.lease\S+/g, "openmausbot-server.lease<redacted>");

/** The end of one startup's log: enough for the display tail, a startup
 * signature and a lease refusal, and bounded against a server that logged its
 * way to a gigabyte before it died. */
const LOG_WINDOW = 256 * 1024;
function readLog(file) {
  let fd;
  try { fd = fs.openSync(file, "r"); } catch { return ""; }
  try {
    const { size } = fs.fstatSync(fd);
    const buf = Buffer.alloc(Math.min(size, LOG_WINDOW));
    if (buf.length) fs.readSync(fd, buf, 0, buf.length, Math.max(0, size - LOG_WINDOW));
    return buf.toString("utf8");
  } catch { return ""; } finally { fs.closeSync(fd); }
}

/** The last lines of the server log, for error hints. */
export function logTail(file, lines = 12) {
  const all = redactLease(readLog(file)).trimEnd().split("\n");
  return all.slice(-lines).join("\n");
}

// The data directory is leased before any state is loaded (`server/index.ts:335-339`);
// a second server on it is refused by name (`electron/data-dir-lease.mjs:323-331`),
// the supervisor forwards that failure (`server/cli.ts:480`) and the text reaches
// the inherited stderr. The launcher never acquires, reads, repairs or deletes
// that lease: exclusion and stale recovery stay upstream's.
const LEASE_LIVE = /OpenMausBot is already using this data directory \(process (\d+)\)/;
const LEASE_FOREIGN = /This OpenMausBot data directory is already owned by a process on another machine/;

/** Who holds the data directory, according to this startup's own log, or null. */
export function leaseRefusal(file) {
  const text = readLog(file);
  const live = LEASE_LIVE.exec(text);
  if (live) return { by: `another OpenMausBot (process ${live[1]})` };
  return LEASE_FOREIGN.test(text) ? { by: "a process on another machine" } : null;
}

/** The signature of a sandbox that denies listening sockets: the `listen EPERM` line, or Node's `code: 'EPERM'` property lines below the stack. */
export const SANDBOX_RE = /listen (EPERM|EACCES)|operation not permitted|code: '(EPERM|EACCES)'/i;

/** The first line of this startup's log matching `re`, or null: the signature can sit far above the display tail (a real sandboxed startup log is 25 lines with the match on line 3). */
export function logMatch(file, re) {
  return redactLease(readLog(file)).split("\n").find((l) => re.test(l))?.trim() ?? null;
}
