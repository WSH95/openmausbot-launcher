// Shared helpers for the node:test suites.
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setImmediate as turn } from "node:timers/promises";
import { createFake } from "./fixtures/fake-omb.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SKILL_DIR = path.join(ROOT, "skills", "openmausbot-launcher");
export const OMB = path.join(SKILL_DIR, "scripts", "omb.mjs");
export const FAKE = path.join(ROOT, "tests", "fixtures", "fake-omb.mjs");

// Test ports avoid the kernel's ephemeral range. A port measured with listen(0)
// and released goes back to that range, where a parallel test file's fake
// (listen(0)) or any HTTP request it makes (connect(), a client socket without
// SO_REUSEADDR) can take it or its neighbour before the driver binds it (bead
// oml-xml: "port 45566 is in use" where a lease refusal was expected). Outside
// the range only an explicit bind competes. Each process starts its
// sequential probe at a pid-based offset; there is no reservation, and the
// bind check on every handout is what makes the offset safe.
/** The band to pick from for an ephemeral range `lo..hi`: below it from 20000 (or 1024 when the floor is low),
 * else above it, whichever is larger; when nothing unprivileged lies outside (`1024 65535`), the range itself. */
export function portBand(lo, hi) {
  const below = [lo - 2 >= 22000 ? 20000 : 1024, lo - 2];
  const above = [hi + 1, 65533];
  const width = ([a, b]) => b - a + 1;
  const best = width(below) >= width(above) ? below : above;
  const [floor, ceil] = width(best) >= 1000 ? best : [Math.max(lo, 1024), hi - 1];
  if (!(floor >= 1024 && floor < ceil && ceil + 1 <= 65535)) throw new Error(`no usable test port band for ip_local_port_range ${lo} ${hi}`);
  return { floor, ceil };
}
// The fallback constants are the Linux defaults; they are also conservative on
// macOS, whose range starts at 49152 and has no /proc.
const EPHEMERAL = (() => {
  try { const [lo, hi] = fs.readFileSync("/proc/sys/net/ipv4/ip_local_port_range", "utf8").trim().split(/\s+/).map(Number); return { lo, hi }; }
  catch { return { lo: 32768, hi: 60999 }; }
})();
const { floor: FLOOR, ceil: CEIL } = portBand(EPHEMERAL.lo, EPHEMERAL.hi);
let nextPort = FLOOR + ((process.pid * 7919) % (CEIL - FLOOR));
const advance = (from) => { nextPort = from > CEIL ? FLOOR : from; };
// Only "address in use" means "try the next port"; EPERM, EMFILE and the like
// would otherwise masquerade as a full band after a 12k-port sweep.
const bindable = (port) => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once("error", (e) => (e.code === "EADDRINUSE" ? resolve(false) : reject(e)));
  s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
});

/** A port in the band that was bindable a moment ago. */
export async function freePort() {
  for (let tried = 0; tried <= CEIL - FLOOR; tried++) {
    const port = nextPort; advance(port + 1);
    if (await bindable(port)) return port;
  }
  throw new Error(`no free port between ${FLOOR} and ${CEIL}`);
}

/** A port whose neighbour is free too: OpenMausBot binds port+1 for its webhook receiver (server/index.ts:320).
 * On the below-floor band `ceil` is two below the ephemeral floor, so the neighbour stays outside the range as well. */
export async function freePortPair() {
  for (let tried = 0; tried <= CEIL - FLOOR; tried++) {
    const port = await freePort();
    advance(port + 2); // claim the neighbour before probing it, so a concurrent freePort() is not handed it
    if (await bindable(port + 1)) return port;
  }
  throw new Error(`no free port pair between ${FLOOR} and ${CEIL}`);
}

const created = [];
/** A fresh directory under the OS temp dir. Every test file is its own process under `node --test`,
 * so the exit hook below removes this file's directories; set OML_KEEP_TMP=1 to keep them for a look. */
export function tmpDir(prefix = "oml-") { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); created.push(dir); return dir; }
process.on("exit", () => {
  if (process.env.OML_KEEP_TMP === "1") return;
  for (const dir of created) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
});

/** A fake OpenMausBot with a fast heartbeat and a fresh data dir. */
export async function startFake(opts = {}) {
  return createFake({ heartbeatMs: 100, dataDir: tmpDir("oml-data-"), ...opts });
}

/** A temporary git repository on `main` with one commit. */
export function makeRepo(opts = {}) {
  const dir = tmpDir("oml-repo-");
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).toString();
  git("init", "-q", "-b", opts.branch ?? "main");
  fs.writeFileSync(path.join(dir, "README.md"), "# t\n");
  git("add", "-A"); git("commit", "-q", "-m", "init");
  return { dir, git };
}

/** Run the driver and parse its JSON stdout. No ambient OMB_* setting reaches
 * the child; only `opts.env` does. `opts.stdin` (a string or promise) is written and closed, which is
 * how a credential reaches the driver without passing through argv. */
export function runOmb(args, opts = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("OMB_")));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [OMB, ...args], { cwd: opts.cwd ?? ROOT, env: { ...env, ...opts.env }, stdio: [opts.stdin != null ? "pipe" : "ignore", "pipe", "pipe"] });
    if (opts.stdin != null) Promise.resolve(opts.stdin).then((value) => child.stdin.end(value));
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 30_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      let json = null;
      try { json = JSON.parse(stdout); } catch {}
      resolve({ code, stdout, stderr, json });
    });
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Hold watch waits on a virtual monotonic clock. REST keeps its real timers;
 * stream retry pauses can be released explicitly. Every await is bounded. */
export function heldWatchTimers(t, { retryPauses = false } = {}) {
  let now = 0;
  const held = new Set();
  let guarding = null;
  const realSetTimeout = globalThis.setTimeout; const realClearTimeout = globalThis.clearTimeout; const realNow = performance.now;
  performance.now = () => now;
  globalThis.setTimeout = (fn, ms = 0, ...args) => {
    // `withinDeadline` names no timer of its own, so its guards are held only
    // while `guards()` is capturing them.
    const guard = guarding !== null && !fn?.name;
    if (!guard && !["wokeUp", "reachDeadline"].includes(fn?.name) && !(retryPauses && fn?.name === "done" && ms === 2000)) return realSetTimeout(fn, ms, ...args);
    const handle = { ms, name: fn.name, fire(at) { if (!held.delete(handle)) return; if (at !== undefined) now = at; fn(...args); } };
    held.add(handle);
    if (guard) guarding.push(handle);
    return handle;
  };
  globalThis.clearTimeout = (handle) => (held.has(handle) ? held.delete(handle) : realClearTimeout(handle));
  const expire = () => { now = Infinity; for (const h of [...held]) h.fire(); };
  t.after(async () => { expire(); await turn(); globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout; performance.now = realNow; });
  return {
    at: (ms) => { now = ms; },
    held: (name) => [...held].find((h) => h.name === name),
    /** Hold every `withinDeadline` deadline timer installed while `fn` runs, in
     * installation order: `watchRun` installs the stream connection's guard
     * (watch.mjs:214) and then the stream-readiness guard (watch.mjs:315)
     * before it awaits anything, so a test can reach one of them alone. The
     * REST guards, installed later, keep their real timers. */
    guards(fn) {
      const captured = [];
      guarding = captured;
      try { return { value: fn(), guards: captured }; } finally { guarding = null; }
    },
    async until(name, budgetMs = 15000, previous = null) {
      const stop = Date.now() + budgetMs;
      while (Date.now() < stop) {
        const h = [...held].find((x) => x.name === name && x !== previous);
        if (h) return h;
        await turn();
      }
      throw new Error(`the watch never installed a ${name} timer`);
    },
    finish(p, budgetMs = 15000) {
      const bounded = new Promise((resolve, reject) => {
        const timer = realSetTimeout(() => { reject(new Error("the held watch did not finish")); expire(); }, budgetMs);
        p.then((r) => { realClearTimeout(timer); resolve(r); }, (e) => { realClearTimeout(timer); reject(e); });
      });
      bounded.catch(() => {});
      return bounded;
    },
  };
}

/** Wait for an actual response from the fake, not an estimate of subprocess
 * startup time: resolves once `count` requests whose url `matches` have been
 * answered. A test that has to act while a watch is running waits for the
 * hydration that proves it is. */
export function responses(f, matches, count = 1) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); f.server.off("request", onRequest); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("expected request did not arrive")); }, 15_000);
    const onRequest = (req, res) => {
      if (matches(req.url)) res.once("finish", () => {
        if (--count === 0) { cleanup(); resolve(); }
      });
    };
    f.server.on("request", onRequest);
  });
}

/** Read one SSE frame set: resolves with the parsed `data:` payloads seen so far after `ms`. */
export async function readSse(url, { headers = {}, ms = 300, signal } = {}) {
  const ctrl = new AbortController();
  const res = await fetch(url, { headers: { accept: "text/event-stream", ...headers }, signal: signal ?? ctrl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = ""; const frames = [];
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, i); buf = buf.slice(i + 2);
        const frame = { id: null, data: null };
        for (const line of raw.split("\n")) {
          if (line.startsWith("id: ")) frame.id = line.slice(4);
          else if (line.startsWith("data: ")) frame.data = JSON.parse(line.slice(6));
        }
        if (frame.data) frames.push(frame);
      }
    }
  } catch (e) { if (e.name !== "AbortError") throw e; }
  clearTimeout(timer);
  return { status: res.status, frames };
}
