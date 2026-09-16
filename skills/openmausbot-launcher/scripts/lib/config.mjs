// Configuration resolution: flags, then the state file, then the environment,
// then defaults (design, "Configuration"). Tokens come only from the
// environment or the 0600 token file, never from argv.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { EXIT, Fail } from "./cli.mjs";
import { statePaths, loadState } from "./state.mjs";
import { gitTopLevel } from "./git.mjs";

export const DEFAULT_URL = "http://127.0.0.1:8799";
export const TOKEN_FILE = path.join(os.homedir(), ".config", "openmausbot-launcher", "tokens.json");

export function isLoopback(url) {
  let u; try { u = new URL(url); } catch { return false; }
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(u.hostname);
}

export function normalizeUrl(url) {
  const u = new URL(url);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error(`unsupported URL scheme in ${url}`);
  return u.origin;
}

function readTokenFile(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; }
}

export function resolveToken(url, env = process.env) {
  if (env.OMB_TOKEN) return { token: env.OMB_TOKEN, source: "OMB_TOKEN" };
  const table = readTokenFile(tokenFilePath(env));
  const token = table[url] ?? table[normalizeUrl(url)];
  return token ? { token, source: "token file" } : { token: null, source: null };
}

/** Where the token table lives; `OMB_TOKEN_FILE` moves it (tests, a second identity). */
export function tokenFilePath(env = process.env) { return env.OMB_TOKEN_FILE ?? TOKEN_FILE; }

/**
 * The token table, read strictly. `resolveToken` must never fail a command
 * over a token it did not need, so it swallows everything; `pair` is about to
 * write this file and has to know what is already wrong with it.
 */
export function readTokenTable(file) {
  let stat;
  try { stat = fs.statSync(file); } catch (e) { if (e.code === "ENOENT") return { present: false, table: {} }; throw e; }
  const mode = stat.mode & 0o777;
  if (mode !== 0o600) throw new Fail(EXIT.PRECONDITION, `${file} is mode ${mode.toString(8)}; make it 0600`, { hint: `it holds session tokens: chmod 600 ${file}` });
  const notJson = () => new Fail(EXIT.PRECONDITION, `${file} is not valid JSON`, { hint: "move it aside and pair again; the old sessions can be revoked with openmausbot sessions" });
  let table;
  try { table = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw notJson(); }
  if (table === null || typeof table !== "object" || Array.isArray(table)) throw notJson();
  return { present: true, table };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Record one origin's token under an exclusive lock, so a second `pair` waits
 * instead of dropping the first one's entry. The table is re-read inside the
 * lock, the replacement is written to a 0600 temp file and renamed, and the
 * lock goes away whatever happens.
 */
export async function storeToken(file, origin, token, { waitMs = 2000, retryMs = 25 } = {}) {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try { fs.closeSync(fs.openSync(lock, "wx", 0o600)); break; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (Date.now() >= deadline) throw new Fail(EXIT.PRECONDITION, `another pair is writing ${file}`, { hint: `waited ${waitMs} ms for ${lock}; if no other pair is running, that lock is stale — remove it` });
      await sleep(retryMs);
    }
  }
  try {
    const { table } = readTokenTable(file);
    table[origin] = token;
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      const fd = fs.openSync(tmp, "w", 0o600);
      try { fs.writeFileSync(fd, `${JSON.stringify(table, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.chmodSync(tmp, 0o600); // the umask does not get a say in who can read a token
      fs.renameSync(tmp, file);
    } catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }
    try { const dir = fs.openSync(path.dirname(file), "r"); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } } catch {}
    return table;
  } finally { try { fs.unlinkSync(lock); } catch {} }
}

export function resolveBinary(env = process.env) {
  if (env.OMB_BIN) {
    const p = path.resolve(env.OMB_BIN);
    if (!fs.existsSync(p)) return { command: null, error: `OMB_BIN does not exist: ${p}` };
    const isScript = /\.(m?js|cjs)$/.test(p);
    return { command: isScript ? [process.execPath, p] : [p], path: p, version: versionNear(p), source: "OMB_BIN" };
  }
  try {
    const found = execFileSync("sh", ["-lc", "command -v openmausbot"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (found) return { command: [found], path: found, version: versionNear(fs.realpathSync(found)), source: "PATH" };
  } catch {}
  return { command: null, error: "openmausbot not found: set OMB_BIN to cli.js of the openmausbot package or put openmausbot on PATH" };
}

/** The package.json next to (or above) cli.js names the version. */
export function versionNear(file) {
  let dir = path.dirname(file);
  for (let i = 0; i < 4; i++) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg)) {
      try { const j = JSON.parse(fs.readFileSync(pkg, "utf8")); if (j.name === "openmausbot") return j.version ?? "unknown"; } catch {}
    }
    dir = path.dirname(dir);
  }
  return "unknown";
}

export function resolveConfig(flags = {}, env = process.env, cwd = process.cwd()) {
  const projectDir = path.resolve(flags.project ?? env.OMB_PROJECT ?? gitTopLevel(cwd) ?? cwd);
  const paths = statePaths(projectDir, flags.state ?? env.OMB_STATE);
  const state = loadState(paths);
  const url = normalizeUrl(flags.url ?? state?.server?.url ?? env.OMB_URL ?? DEFAULT_URL);
  const { token, source: tokenSource } = resolveToken(url, env);
  const dataDir = path.resolve(flags["data-dir"] ?? state?.server?.dataDir ?? env.OMB_DATA_DIR ?? path.join(os.homedir(), ".openmausbot"));
  const loopback = isLoopback(url);
  const mode = flags.remote || !loopback ? "remote" : "local";
  let dataDirReadable = false;
  try { fs.accessSync(dataDir, fs.constants.R_OK); dataDirReadable = fs.statSync(dataDir).isDirectory(); } catch {}
  return { projectDir, paths, state, url, token, tokenSource, dataDir, dataDirReadable, loopback, mode, flags, env, allowInsecureHttp: flags["allow-insecure-http"] === true, dryRun: flags["dry-run"] === true };
}
