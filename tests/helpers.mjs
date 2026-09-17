// Shared helpers for the node:test suites.
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createFake } from "./fixtures/fake-omb.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SKILL_DIR = path.join(ROOT, "skills", "openmausbot-launcher");
export const OMB = path.join(SKILL_DIR, "scripts", "omb.mjs");
export const FAKE = path.join(ROOT, "tests", "fixtures", "fake-omb.mjs");

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on("error", reject);
  });
}

/** A port whose neighbour is free too: OpenMausBot binds port+1 for its webhook receiver (server/index.ts:320). */
export async function freePortPair() {
  for (;;) {
    const port = await freePort();
    const ok = await new Promise((resolve) => { const s = net.createServer(); s.once("error", () => resolve(false)); s.listen(port + 1, "127.0.0.1", () => s.close(() => resolve(true))); });
    if (ok) return port;
  }
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
