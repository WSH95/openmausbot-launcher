import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeRepo, runOmb } from "./helpers.mjs";
import { statePaths, initState, commitState, loadState } from "../skills/openmausbot-launcher/scripts/lib/state.mjs";

const env = { OMB_TOKEN: "" };

test("state --show prints the document as read, without a lock or a request, and exits 3 when there is none", async () => {
  const { dir } = makeRepo();
  const paths = statePaths(dir);
  let r = await runOmb(["state", "--show", "--project", dir], { env });
  assert.equal(r.code, 3, r.stdout);
  assert.equal(r.json.error, `no state at ${paths.file}`); assert.equal(r.json.hint, "import a team or run up to create it");
  assert.equal(fs.existsSync(paths.dir), false, "a refused read creates nothing");
  fs.mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  commitState(paths, { ...initState(dir), server: { url: "http://127.0.0.1:8899", owned: true, healthPid: 4242 }, team: { section: "Dev team", lead: { id: "l", name: "Sudo" }, bots: [], rooms: [] }, runs: { r1: { runId: "r1", title: "T10", status: "dispatched" } } });
  for (const extra of [["--show"], [], ["--url", "http://127.0.0.1:1"], ["--remote"], ["--remote", "--url", "https://maus.example.com"]]) {
    r = await runOmb(["state", ...extra, "--project", dir], { env });
    assert.equal(r.code, 0, r.stdout);
    assert.equal(r.json.path, paths.file); assert.deepEqual(r.json.state, loadState(paths));
  }
  assert.equal(fs.existsSync(paths.lockDb), false, "a read never initializes the lock database");
  r = await runOmb(["state", "--show", "--project", dir, "--brief"], { env });
  assert.equal(r.stdout, `state · ${paths.file} · rev 1 · server http://127.0.0.1:8899 (owned) · team Dev team · runs T10 dispatched\n`);
  const doc = loadState(paths);
  doc.runs.r2 = { runId: "r2", title: "T11", status: "preparing", createdAt: "2026-09-16T02:00:00.000Z" };
  doc.runs.r1.createdAt = "2026-09-16T01:00:00.000Z";
  commitState(paths, doc);
  r = await runOmb(["state", "--show", "--project", dir, "--brief"], { env });
  assert.equal(r.stdout, `state · ${paths.file} · rev 2 · server http://127.0.0.1:8899 (owned) · team Dev team · runs T10 dispatched, T11 preparing\n`);
});

test("usage names seventeen verbs, state among them", async () => {
  const r = await runOmb([], { env });
  assert.equal(r.code, 2);
  const names = r.json.hint.replace(/^verbs: /, "").split(", ");
  assert.equal(names.length, 17, r.json.hint);
  assert.ok(names.includes("state"));
});
