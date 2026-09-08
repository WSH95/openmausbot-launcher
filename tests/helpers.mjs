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

export function tmpDir(prefix = "oml-") { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

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

/** Run the driver and parse its JSON stdout. */
export function runOmb(args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [OMB, ...args], { cwd: opts.cwd ?? ROOT, env: { ...process.env, ...opts.env }, stdio: ["ignore", "pipe", "pipe"] });
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
