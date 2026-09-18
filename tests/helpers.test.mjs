import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import { EventEmitter } from "node:events";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ROOT, FAKE, makeRepo, runOmb, freePort, freePortPair, portBand } from "./helpers.mjs";

const HELPERS = pathToFileURL(path.join(ROOT, "tests", "helpers.mjs")).href;
/** Run an ESM snippet in a fresh node process and return its trimmed stdout. */
const node = (code, env) => new Promise((resolve) => {
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "inherit"] });
  let out = ""; child.stdout.on("data", (c) => { out += c; });
  child.on("close", () => resolve(out.trim()));
});

test("tmpDir directories vanish when their process exits, unless OML_KEEP_TMP=1", async () => {
  // node --test runs each file in its own process, so an exit hook in helpers.mjs cleans that file's directories.
  const code = `import { tmpDir } from ${JSON.stringify(HELPERS)}; console.log(tmpDir("oml-helpers-"));`;
  const removed = await node(code, { OML_KEEP_TMP: "" });
  assert.match(removed, /oml-helpers-/); assert.equal(fs.existsSync(removed), false, `${removed} should be gone`);
  const kept = await node(code, { OML_KEEP_TMP: "1" });
  assert.equal(fs.existsSync(kept), true, `${kept} should survive`); fs.rmSync(kept, { recursive: true, force: true });
});

test("runOmb strips ambient OMB_* variables from the driver's environment and still applies opts.env", async (t) => {
  const { dir } = makeRepo();
  const previous = process.env.OMB_URL; process.env.OMB_URL = "http://127.0.0.1:1";
  t.after(() => { if (previous === undefined) delete process.env.OMB_URL; else process.env.OMB_URL = previous; });
  const r = await runOmb(["doctor", "--project", dir], { env: { OMB_BIN: FAKE } });
  assert.equal(r.code, 0, r.stdout + r.stderr); assert.equal(r.json.url, "http://127.0.0.1:8799", "the test process's OMB_URL did not reach the driver");
  const explicit = await runOmb(["doctor", "--project", dir], { env: { OMB_BIN: FAKE, OMB_URL: "http://127.0.0.1:1" } });
  assert.equal(explicit.json.url, "http://127.0.0.1:1");
});

// Bead oml-xml: a port measured with listen(0) comes from the kernel's ephemeral
// range, which parallel test files also draw from; see tests/helpers.mjs.
const range = () => {
  try { const [lo, hi] = fs.readFileSync("/proc/sys/net/ipv4/ip_local_port_range", "utf8").trim().split(/\s+/).map(Number); return { lo, hi }; }
  catch { return { lo: 32768, hi: 60999 }; }
};

test("test ports stay inside the chosen band, and outside the ephemeral range whenever the band is", async () => {
  const { lo, hi } = range();
  const band = portBand(lo, hi);
  const outside = band.ceil < lo || band.floor > hi;
  for (let i = 0; i < 20; i++) {
    const p = await freePort();
    assert.ok(p >= band.floor && p <= band.ceil, `freePort returned ${p}, outside the band ${band.floor}-${band.ceil}`);
    if (outside) assert.ok(p < lo || p > hi, `freePort returned ${p}, inside the ephemeral range ${lo}-${hi}`);
    const q = await freePortPair();
    assert.ok(q >= band.floor && q + 1 <= band.ceil + 1, `freePortPair returned ${q}, whose pair leaves the band ${band.floor}-${band.ceil}`);
    if (outside) assert.ok(q + 1 < lo || q > hi, `freePortPair returned ${q}, whose pair touches the ephemeral range ${lo}-${hi}`);
  }
});

test("a bind failure other than EADDRINUSE surfaces with its errno instead of a full-band sweep", async () => {
  const real = net.createServer;
  net.createServer = () => {
    const s = new EventEmitter();
    s.listen = () => process.nextTick(() => s.emit("error", Object.assign(new Error("listen EPERM: operation not permitted"), { code: "EPERM" })));
    s.close = (cb) => cb?.();
    return s;
  };
  try { await assert.rejects(freePort(), /EPERM/); } finally { net.createServer = real; }
});

test("the port band avoids the ephemeral range wherever an unprivileged port outside it exists", () => {
  assert.deepEqual(portBand(32768, 60999), { floor: 20000, ceil: 32766 }, "Linux default: below the floor, the pair's neighbour still below it");
  assert.deepEqual(portBand(49152, 65535), { floor: 20000, ceil: 49150 }, "macOS and BSD ranges");
  assert.deepEqual(portBand(10000, 60999), { floor: 1024, ceil: 9998 }, "a low floor: down to the first unprivileged port");
  assert.deepEqual(portBand(1024, 65535), { floor: 1024, ceil: 65534 }, "a range that covers everything unprivileged: the range itself, bind-checked, is all that is left");
  for (const [lo, hi] of [[32768, 60999], [49152, 65535], [10000, 60999], [1024, 65535], [15000, 65535], [61000, 61010]]) {
    const { floor, ceil } = portBand(lo, hi);
    assert.ok(floor >= 1024 && floor < ceil && ceil + 1 <= 65535, `${lo} ${hi} gives an unusable band ${floor}-${ceil}`);
  }
});
