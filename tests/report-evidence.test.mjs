import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeRepo, runOmb, tmpDir } from "./helpers.mjs";
import { initState, statePaths, loadState } from "../skills/openmausbot-launcher/scripts/lib/state.mjs";

function archivedRun(t, { testCommand = "node -e 'process.exit(0)'", context = true } = {}) {
  const repo = makeRepo(); const dataDir = tmpDir("oml-report-archive-");
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.appendFileSync(path.join(repo.dir, ".git", "info", "exclude"), "\n.omb/\n");
  fs.writeFileSync(path.join(dataDir, "environment-id"), "original-environment");
  const lead = { id: "sudo", name: "Sudo", model: "original-model" };
  const reviewer = { id: "vale", name: "Vale", title: "Plan reviewer" };
  const team = { environmentId: "original-environment", lead, bots: [lead, reviewer] };
  const server = { environmentId: "original-environment", version: "0.1.56", url: "http://127.0.0.1:1", dataDir };
  const facts = { test: testCommand, taskLog: "none", defaultBranch: "main" };
  const original = { state: "done", result: "passed", tests: true, closing: "Completed.\nDONE [oml:archive1]", durationSec: 23 };
  const task = { runId: "archive1", tag: "[oml:archive1]", title: "Archived task", status: "closed", result: "passed", leadThreadId: "sudo-thread", threads: { sudo: "sudo-thread", vale: "vale-thread" }, sentAt: Date.now() - 60000, sentSha: repo.git("rev-parse", "HEAD").trim(), closedAt: new Date().toISOString(), report: original, ...(context ? { context: { team, server, facts } } : {}) };
  const state = { ...initState(repo.dir), team, server, facts, history: [task] };
  const paths = statePaths(repo.dir); fs.mkdirSync(paths.dir, { recursive: true });
  const write = () => fs.writeFileSync(paths.file, JSON.stringify(state)); write();
  const run = (...args) => runOmb(["report", "--project", repo.dir, "--run", "last", ...args], { env: { OMB_TOKEN: "", OMB_DATA_DIR: dataDir } });
  return { ...repo, dataDir, state, task, paths, write, run, original };
}

test("a closed report is offline, retains its original evidence, and appends a reanalysis", async (t) => {
  const f = archivedRun(t);
  const r = await f.run();
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.json.historical, true); assert.equal(r.json.result, "passed");
  assert.equal(r.json.lead, "Sudo"); assert.equal(r.json.version, "0.1.56");
  assert.equal(r.json.tests.ok, true);
  const saved = loadState(f.paths).history[0];
  assert.deepEqual(saved.report, f.original); assert.equal(saved.result, "passed");
  assert.equal(saved.reanalysis.length, 1); assert.equal(saved.reanalysis[0].report.result, "passed");
});

test("archived run context survives current team, server, and facts replacement", async (t) => {
  const f = archivedRun(t);
  f.state.team = { environmentId: "new", lead: { id: "other", name: "Impostor" }, bots: [] };
  f.state.server = { url: "http://127.0.0.1:2", dataDir: "/nonexistent/current", environmentId: "new", version: "9.9.9" };
  f.state.facts = { test: "exit 9" }; f.write();
  const r = await f.run();
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.result, "passed");
  assert.equal(r.json.lead, "Sudo"); assert.equal(r.json.leadModel, "original-model"); assert.equal(r.json.version, "0.1.56");
});

test("legacy history with uncorroborated current metadata stays unknown", async (t) => {
  const f = archivedRun(t, { context: false });
  f.state.team.lead = { id: "other", name: "Impostor" }; f.state.facts.test = "exit 9"; f.write();
  const r = await f.run();
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.result, "incomplete");
  assert.ok(r.json.unknown.includes("run-context")); assert.ok(r.json.unknown.includes("tests-pass"));
  assert.notEqual(r.json.lead, "Impostor"); assert.equal(r.json.tests.ran, false);
});

test("unavailable or skipped required tests cannot produce a passed report", async (t) => {
  for (const command of [undefined, "", "none", "<fill in>"]) {
    const f = archivedRun(t); f.task.context.facts.test = command; f.write();
    const r = await f.run();
    assert.equal(r.code, 0, r.stdout); assert.equal(r.json.result, "incomplete", String(command));
    assert.ok(r.json.unknown.includes("tests-pass"));
  }
  const f = archivedRun(t); const before = fs.readFileSync(f.paths.file, "utf8");
  for (const flag of ["--no-tests", "--dry-run"]) {
    if (flag === "--dry-run") fs.writeFileSync(f.paths.file, before);
    const r = await f.run(flag);
    assert.equal(r.code, 0, r.stdout); assert.equal(r.json.result, "incomplete");
    assert.equal(r.json.tests.ran, false); assert.ok(r.json.unknown.includes("tests-pass"));
    if (flag === "--dry-run") assert.equal(fs.readFileSync(f.paths.file, "utf8"), before);
  }
});

test("report checks cleanliness after tests and retains exactly nine pack checks", async (t) => {
  const f = archivedRun(t, { testCommand: "printf dirt > test-side-effect.txt" });
  const r = await f.run("--check-042");
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.tests.ok, true);
  assert.equal(r.json.reconcile.clean, false); assert.equal(r.json.result, "incomplete");
  assert.equal(r.json.check042.length, 9); assert.equal(r.json.check042.find((c) => c.id === "root-clean").ok, false);
  assert.ok(r.json.failedChecks.includes("root-clean"));
  assert.ok(r.json.unknown.includes("no-host-listagents"));
});

test("an explicitly requested bead with unavailable evidence prevents an ordinary pass", async (t) => {
  const f = archivedRun(t); f.task.bead = "unavailable-bead"; f.write();
  const r = await f.run();
  assert.equal(r.code, 0, r.stdout); assert.equal(r.json.result, "incomplete");
  assert.ok(r.json.unknown.includes("bead-closed")); assert.equal(r.json.record.bead.ok, null);
});

test("historical dry-run cannot execute the test command or rewrite any state", async (t) => {
  const f = archivedRun(t, { testCommand: "printf mutation > forbidden.txt" });
  const before = fs.readFileSync(f.paths.file, "utf8");
  const r = await f.run("--dry-run");
  assert.equal(r.code, 0, r.stdout); assert.equal(fs.existsSync(path.join(f.dir, "forbidden.txt")), false);
  assert.equal(fs.readFileSync(f.paths.file, "utf8"), before);
});

test("closed reanalysis makes zero HTTP requests even when the recorded server answers", async (t) => {
  const http = await import("node:http");
  let requests = 0;
  const server = http.createServer((req, res) => { requests++; res.setHeader("content-type", "application/json"); res.end("{}"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const f = archivedRun(t); f.task.context.server.url = `http://127.0.0.1:${server.address().port}`; f.write();
  const r = await f.run();
  assert.equal(r.code, 0, r.stdout); assert.equal(requests, 0);
});

test("a historical report refuses to write if its observed history entry was replaced during tests", async (t) => {
  const f = archivedRun(t, { testCommand: `node -e 'const fs=require("fs");const p=".omb/state.json";const s=JSON.parse(fs.readFileSync(p));s.history[0].title="replacement";fs.writeFileSync(p,JSON.stringify(s));'` });
  const r = await f.run();
  assert.equal(r.code, 3, r.stdout); assert.match(r.json.error, /closed run changed/);
  const saved = loadState(f.paths).history[0];
  assert.equal(saved.title, "replacement"); assert.equal(saved.reanalysis, undefined);
});
