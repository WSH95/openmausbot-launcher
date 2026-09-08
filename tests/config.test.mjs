import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeRepo, tmpDir, FAKE } from "./helpers.mjs";
import { resolveConfig, resolveToken, resolveBinary, DEFAULT_URL } from "../skills/openmausbot-launcher/scripts/lib/config.mjs";
import { statePaths, updateState } from "../skills/openmausbot-launcher/scripts/lib/state.mjs";

test("url and data dir: flags, then the state file, then the environment, then defaults (design, Configuration)", async () => {
  const { dir } = makeRepo();
  let cfg = resolveConfig({ project: dir }, {});
  assert.equal(cfg.url, DEFAULT_URL); assert.equal(cfg.projectDir, dir); assert.equal(cfg.state, null);
  assert.equal(cfg.dataDir, path.join(os.homedir(), ".openmausbot")); assert.equal(cfg.mode, "local"); assert.equal(cfg.loopback, true);
  assert.equal(resolveConfig({}, {}, dir).projectDir, dir, "cwd inside the repository names the project");
  const envData = tmpDir("oml-config-envdata-");
  cfg = resolveConfig({ project: dir }, { OMB_URL: "http://127.0.0.1:9001/", OMB_DATA_DIR: envData });
  assert.equal(cfg.url, "http://127.0.0.1:9001", "normalised to the origin"); assert.equal(cfg.dataDir, envData); assert.equal(cfg.dataDirReadable, true);
  const stateData = tmpDir("oml-config-statedata-");
  await updateState(statePaths(dir), (d) => { d.server = { url: "http://127.0.0.1:9002", dataDir: stateData }; return d; });
  cfg = resolveConfig({ project: dir }, { OMB_URL: "http://127.0.0.1:9001", OMB_DATA_DIR: envData });
  assert.equal(cfg.url, "http://127.0.0.1:9002"); assert.equal(cfg.dataDir, stateData); assert.equal(cfg.state.rev, 1);
  cfg = resolveConfig({ project: dir, url: "http://127.0.0.1:9003", "data-dir": dir }, { OMB_URL: "http://127.0.0.1:9001", OMB_DATA_DIR: envData });
  assert.equal(cfg.url, "http://127.0.0.1:9003"); assert.equal(cfg.dataDir, dir);
  // A fresh project: this one's state now records a readable dataDir, which outranks OMB_DATA_DIR.
  assert.equal(resolveConfig({ project: makeRepo().dir }, { OMB_DATA_DIR: path.join(dir, "absent") }).dataDirReadable, false);
  cfg = resolveConfig({ project: dir, url: "https://maus.example.com" }, {});
  assert.equal(cfg.mode, "remote"); assert.equal(cfg.loopback, false);
  assert.equal(resolveConfig({ project: dir, remote: true }, {}).mode, "remote", "--remote forces remote mode on a loopback url");
  assert.throws(() => resolveConfig({ project: dir, url: "ftp://x" }, {}), /unsupported URL scheme/);
});

test("tokens come from OMB_TOKEN, else the 0600 token file named by OMB_TOKEN_FILE, never from argv", () => {
  const file = path.join(tmpDir("oml-config-token-"), "tokens.json");
  fs.writeFileSync(file, JSON.stringify({ "http://127.0.0.1:9001": "omb_sess_file" }), { mode: 0o600 });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(resolveToken("http://127.0.0.1:9001", { OMB_TOKEN: "omb_sess_env", OMB_TOKEN_FILE: file }), { token: "omb_sess_env", source: "OMB_TOKEN" });
  assert.deepEqual(resolveToken("http://127.0.0.1:9001/", { OMB_TOKEN_FILE: file }), { token: "omb_sess_file", source: "token file" }, "the origin form of the url matches");
  assert.deepEqual(resolveToken("http://127.0.0.1:9002", { OMB_TOKEN_FILE: file }), { token: null, source: null });
  assert.deepEqual(resolveToken("http://127.0.0.1:9001", { OMB_TOKEN_FILE: path.join(path.dirname(file), "missing.json") }), { token: null, source: null });
  const { dir } = makeRepo();
  const cfg = resolveConfig({ project: dir, url: "http://127.0.0.1:9001" }, { OMB_TOKEN_FILE: file });
  assert.equal(cfg.token, "omb_sess_file"); assert.equal(cfg.tokenSource, "token file");
  assert.equal(resolveConfig({ project: dir, url: "http://127.0.0.1:9001", token: "argv" }, { OMB_TOKEN_FILE: file }).token, "omb_sess_file", "no --token flag exists");
});

test("resolveBinary: OMB_BIN as a script runs under node, as an executable runs directly, a missing path is an error", () => {
  const script = resolveBinary({ OMB_BIN: FAKE });
  assert.deepEqual(script.command, [process.execPath, FAKE]); assert.equal(script.source, "OMB_BIN"); assert.equal(script.version, "unknown", "no openmausbot package.json above the fake");
  const bin = tmpDir("oml-config-bin-"); const exe = path.join(bin, "openmausbot");
  fs.writeFileSync(exe, "#!/bin/sh\necho ok\n", { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "package.json"), JSON.stringify({ name: "openmausbot", version: "0.1.56" }));
  const direct = resolveBinary({ OMB_BIN: exe });
  assert.deepEqual(direct.command, [exe]); assert.equal(direct.version, "0.1.56");
  const missing = resolveBinary({ OMB_BIN: path.join(bin, "nope.mjs") });
  assert.equal(missing.command, null); assert.match(missing.error, /^OMB_BIN does not exist: /);
});

test("allow-insecure-http and dry-run are flag-only", () => {
  const { dir } = makeRepo();
  const cfg = resolveConfig({ project: dir, url: "http://10.0.0.1:1", "allow-insecure-http": true, "dry-run": true }, {});
  assert.equal(cfg.allowInsecureHttp, true); assert.equal(cfg.dryRun, true); assert.equal(cfg.mode, "remote");
  assert.equal(resolveConfig({ project: dir }, { OMB_ALLOW_INSECURE_HTTP: "1", OMB_DRY_RUN: "1" }).allowInsecureHttp, false);
  assert.equal(resolveConfig({ project: dir }, { OMB_DRY_RUN: "1" }).dryRun, false);
});
