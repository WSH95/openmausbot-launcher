// Configuration resolution: flags, then the state file, then the environment,
// then defaults (design, "Configuration"). Tokens come only from the
// environment or the 0600 token file, never from argv.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
  const table = readTokenFile(env.OMB_TOKEN_FILE ?? TOKEN_FILE);
  const token = table[url] ?? table[normalizeUrl(url)];
  return token ? { token, source: "token file" } : { token: null, source: null };
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
