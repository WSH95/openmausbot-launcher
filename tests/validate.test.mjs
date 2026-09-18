// `validate`: the offline package check, in the server's own words.
// The expected texts are the pinned OpenMausBot 0.1.56 schema
// (server/bot-package.ts:40-126, 167-207) rendered by server/schema.ts:14-19,
// with zod 4.4.3's default messages. Every message here was read off a real
// zod 4.4.3 parse of that schema, not from memory.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runOmb, ROOT, tmpDir } from "./helpers.mjs";
import { validatePackage, parseJsonFile, LIMITS, COLORS, ADVISORY } from "../skills/openmausbot-launcher/scripts/lib/package.mjs";

const PKG = path.join(ROOT, "tests", "fixtures", "dev-team.package.json");
const RAW = fs.readFileSync(PKG, "utf8");
const load = () => JSON.parse(RAW);
const env = { OMB_TOKEN: "" };
const X = (n) => "x".repeat(n);
const routine = (over = {}) => ({ key: "r", name: "R", agent: "sudo", prompt: "p", runOn: "maus", schedule: { type: "once", at: 1 }, durationMinutes: 5, enabledAfterInstall: false, ...over });

/** One row: mutate a fresh copy of the fixture, then assert the whole `errors` array. */
const CASES = [
  { name: "a root that is not an object is judged as the schema's own object check", mutate: () => [], errors: [["", "Invalid input: expected object, received array", "schema"]] },
  { name: "another format is not this format", mutate: (d) => { d.format = "openmaus.backup"; }, errors: [["format", "This is not an OpenMaus package", "schema"]] },
  { name: "another version is refused", mutate: (d) => { d.version = 2; }, errors: [["version", "Package version is not supported", "schema"]] },
  { name: "a missing required text is not text", mutate: (d) => { delete d.package.name; }, errors: [["package.name", "must be text", "schema"]] },
  { name: "an object with a non-numeric length fails the type check and both size checks, as zod runs them on any .length", mutate: (d) => { d.package.name = { length: "x" }; }, errors: [["package.name", "must be text", "schema"], ["package.name", "is required", "schema"], ["package.name", "is too long", "schema"]] },
  { name: "whitespace-only text is missing", mutate: (d) => { d.package.tagline = "  "; }, errors: [["package.tagline", "is required", "schema"]] },
  { name: "text over its limit is too long", mutate: (d) => { d.package.tagline = X(161); }, errors: [["package.tagline", "is too long", "schema"]] },
  { name: "the limit is measured after trimming", mutate: (d) => { d.package.tagline = `${X(160)}   `; }, errors: [] },
  { name: "the id is a slug", mutate: (d) => { d.package.id = "Dev Team"; }, errors: [["package.id", "must be a lowercase slug", "schema"]] },
  { name: "the release is semantic versioning", mutate: (d) => { d.package.release = "0.4"; }, errors: [["package.release", "must be semantic versioning", "schema"]] },
  { name: "an agent key is lowercase", mutate: (d) => { d.package.agents[0].key = "Sudo"; }, errors: [["package.agents.0.key", "may only contain lowercase letters, numbers, - and _", "schema"]] },
  { name: "an empty key fails both checks, in order", mutate: (d) => { d.package.agents[0].key = ""; }, errors: [["package.agents.0.key", "is required", "schema"], ["package.agents.0.key", "may only contain lowercase letters, numbers, - and _", "schema"]] },
  { name: "an unknown colour is not supported", mutate: (d) => { d.package.agents[1].appearance.color = "magenta"; }, errors: [["package.agents.1.appearance.color", "is not supported", "schema"]] },
  { name: "a missing colour is not supported either", mutate: (d) => { delete d.package.agents[1].appearance.color; }, errors: [["package.agents.1.appearance.color", "is not supported", "schema"]] },
  { name: "a description over 4000 is too long", mutate: (d) => { d.package.agents[1].description = X(4001); }, errors: [["package.agents.1.description", "is too long", "schema"]] },
  { name: "an optional text that is not text is an invalid union", mutate: (d) => { d.package.agents[1].title = 5; }, errors: [["package.agents.1.title", "Invalid input", "schema"]] },
  { name: "an optional text may be null", mutate: (d) => { d.package.agents[1].description = null; }, errors: [] },
  { name: "a number given as text", mutate: (d) => { d.package.setupMinutes = "5"; }, errors: [["package.setupMinutes", "Invalid input: expected number, received string", "schema"]] },
  { name: "a number that is not an integer", mutate: (d) => { d.package.setupMinutes = 5.5; }, errors: [["package.setupMinutes", "Invalid input: expected int, received number", "schema"]] },
  { name: "a number under its minimum", mutate: (d) => { d.package.setupMinutes = 0; }, errors: [["package.setupMinutes", "Too small: expected number to be >=1", "schema"]] },
  { name: "a number over its maximum", mutate: (d) => { d.package.setupMinutes = 241; }, errors: [["package.setupMinutes", "Too big: expected number to be <=240", "schema"]] },
  { name: "an empty required array", mutate: (d) => { d.package.outcomes = []; }, errors: [["package.outcomes", "Too small: expected array to have >=1 items", "schema"]] },
  { name: "an array over its maximum", mutate: (d) => { d.package.outcomes = Array.from({ length: 13 }, (_, i) => `o${i}`); }, errors: [["package.outcomes", "Too big: expected array to have <=12 items", "schema"]] },
  // zod parses an array's elements before its own size checks (core/schemas.js
  // $ZodArray), so the element issue is errors[0] and the size check errors[1].
  { name: "an element's issue comes before the enclosing array's size check", mutate: (d) => { d.package.outcomes = Array.from({ length: 13 }, (_, i) => (i === 0 ? "" : `o${i}`)); }, errors: [["package.outcomes.0", "is required", "schema"], ["package.outcomes", "Too big: expected array to have <=12 items", "schema"]] },
  { name: "an unknown discriminator names the discriminator's own path", mutate: (d) => { d.package.rooms[0].defaultResponder = { kind: "member" }; }, errors: [["package.rooms.0.defaultResponder.kind", "Invalid discriminator value. Expected 'agent' | 'everyone' | 'mentions'", "schema"]] },
  { name: "a routine reports each of its fields in shape order", mutate: (d) => { d.package.routines = [routine({ runOn: "local", enabledAfterInstall: true, schedule: { type: "daily", time: "9:00", weekdays: [1] } })]; }, errors: [["package.routines.0.runOn", 'Invalid option: expected one of "maus"|"cloud"', "schema"], ["package.routines.0.schedule.time", "must use HH:MM", "schema"], ["package.routines.0.enabledAfterInstall", "Invalid input: expected false", "schema"]] },
  // `at` (bot-package.ts:97) is `z.number().int()` with no range of its own, so
  // only zod's safe-integer bounds apply, and they say "int", not "number".
  { name: "an integer past the safe range is too big, as an int", mutate: (d) => { d.package.routines = [routine({ schedule: { type: "once", at: 9007199254740992 } })]; }, errors: [["package.routines.0.schedule.at", "Too big: expected int to be <=9007199254740991", "schema"]] },
  { name: "an integer before the safe range is too small, as an int", mutate: (d) => { d.package.routines = [routine({ schedule: { type: "once", at: -9007199254740992 } })]; }, errors: [["package.routines.0.schedule.at", "Too small: expected int to be >=-9007199254740991", "schema"]] },
  { name: "a negative `at` is accepted: the field carries no range", mutate: (d) => { d.package.routines = [routine({ schedule: { type: "once", at: -1 } })]; }, errors: [] },
  { name: "the largest safe integer is accepted for `at`", mutate: (d) => { d.package.routines = [routine({ schedule: { type: "once", at: Number.MAX_SAFE_INTEGER } })]; }, errors: [] },
  { name: "anchorAt is non-negative, and says so as a number", mutate: (d) => { d.package.routines = [routine({ schedule: { type: "interval", everyMinutes: 5, anchorAt: -1 } })]; }, errors: [["package.routines.0.schedule.anchorAt", "Too small: expected number to be >=0", "schema"]] },
  // The safe-integer check does not abort the field's own range checks.
  { name: "the safe-integer bound comes before the field's own range, and both are reported", mutate: (d) => { d.package.setupMinutes = 9007199254740992; }, errors: [["package.setupMinutes", "Too big: expected int to be <=9007199254740991", "schema"], ["package.setupMinutes", "Too big: expected number to be <=240", "schema"]] },
  { name: "sibling keys are reported in the schema's shape order", mutate: (d) => { delete d.package.name; d.package.id = "X"; }, errors: [["package.id", "must be a lowercase slug", "schema"], ["package.name", "must be text", "schema"]] },
  // Cross-references (bot-package.ts:173-205). The server throws the first one,
  // so errors[0] is what its 400 carries; the path is the launcher's addition.
  { name: "a duplicate agent key", mutate: (d) => { d.package.agents.push(JSON.parse(JSON.stringify(d.package.agents[0]))); }, errors: [["package.agents.5.key", "Duplicate agent key: sudo", "reference"]] },
  { name: "an unknown chief of staff", mutate: (d) => { d.package.chiefOfStaff = "nobody"; }, errors: [["package.chiefOfStaff", "Unknown Chief of Staff: nobody", "reference"]] },
  { name: "an agent referencing an unknown playbook", mutate: (d) => { d.package.agents[0].playbooks = ["missing"]; }, errors: [["package.agents.0.playbooks.0", "Agent sudo references unknown playbook: missing", "reference"]] },
  { name: "a room referencing an unknown agent", mutate: (d) => { d.package.rooms[0].members.push("ghost"); }, errors: [["package.rooms.0.members.5", "Room dev-room references unknown agent: ghost", "reference"]] },
  { name: "a duplicate room member", mutate: (d) => { d.package.rooms[0].members.push("sudo"); }, errors: [["package.rooms.0.members.5", "Duplicate member in room dev-room key: sudo", "reference"]] },
  { name: "a default responder who is not a member of the room", mutate: (d) => { d.package.rooms[0].members = ["sage"]; }, errors: [["package.rooms.0.defaultResponder.agent", "Room dev-room has an unknown default responder", "reference"]] },
  { name: "a routine referencing an unknown agent", mutate: (d) => { d.package.routines = [routine({ agent: "ghost" })]; }, errors: [["package.routines.0.agent", "Routine r references unknown agent: ghost", "reference"]] },
  // The server reaches its cross-references only after a clean schema parse.
  { name: "cross-references wait for a clean schema walk", mutate: (d) => { delete d.package.name; d.package.rooms[0].members.push("ghost"); }, errors: [["package.name", "must be text", "schema"]] },
  { name: "the fixture itself has no error", mutate: () => {}, errors: [] },
];

for (const row of CASES) {
  test(`validatePackage: ${row.name}`, () => {
    let doc = load();
    const replacement = row.mutate(doc);
    if (replacement !== undefined) doc = replacement;
    const out = validatePackage(doc);
    assert.deepEqual(out.errors, row.errors.map(([p, message, kind]) => ({ path: p, message, kind })));
    assert.equal(out.ok, row.errors.length === 0);
    assert.ok(out.summary, "a summary exists even for an invalid document");
  });
}

test("validatePackage: every message the launcher invents carries a source line", () => {
  // The values the reference and the warnings quote come from one place.
  assert.equal(LIMITS.agentDescription, 4000);
  assert.equal(LIMITS.instructions, 24000);
  assert.deepEqual(LIMITS.outcomes, [1, 12]);
  assert.equal(ADVISORY.createBotInstructions, 1000);
  assert.equal(ADVISORY.leadDescriptionBudget, 3900);
  assert.equal(ADVISORY.playbookMountPerBot, 24000);
  assert.equal(ADVISORY.fileSuffix, ".openmaus.json");
  assert.equal(COLORS.length, 10);
});

// --- warnings: advice the server never enforces, and never an exit code -----

const warn = (mutate, opts = {}) => {
  const doc = load();
  mutate(doc);
  return validatePackage(doc, { fileName: "x.openmaus.json", ...opts });
};
const at = (out, p) => out.warnings.filter((w) => w.path === p);

test("a package with no chief of staff warns that import needs --lead", () => {
  const out = warn((d) => { delete d.package.chiefOfStaff; });
  assert.deepEqual(out.errors, []);
  assert.deepEqual(at(out, "package.chiefOfStaff").map((w) => w.message), ["no chiefOfStaff: import will need --lead <name>"]);
});

test("a chiefOfStaff that is present but not text is a schema error, not the missing-chief advisory", () => {
  const out = warn((d) => { d.package.chiefOfStaff = 5; });
  assert.deepEqual(out.errors, [{ path: "package.chiefOfStaff", message: "must be text", kind: "schema" }]);
  assert.deepEqual(at(out, "package.chiefOfStaff"), []);
});

test("a chief whose description plus its facts block passes 3900 warns about the facts budget", () => {
  const block = 'Project facts (edit me): default branch: main. Test command: <fill in>.';
  const out = warn((d) => { d.package.agents[0].description = `${X(3850)}\n${block}`; });
  assert.deepEqual(out.errors, []);
  const found = at(out, "package.agents.0.description");
  assert.equal(found.length, 1);
  assert.equal(found[0].message, `the chief's description is ${3850 + 1 + block.length} characters (3851 before the "Project facts" marker); facts replaces the block from the marker and refuses at 4000, so keep the description at 3900`);
});

test("a chief with no Project facts marker warns that facts will refuse", () => {
  const out = warn((d) => { d.package.agents[0].description = "You lead the team."; });
  assert.deepEqual(out.errors, []);
  assert.deepEqual(at(out, "package.agents.0.description").map((w) => w.message), ['the chief\'s description has no "Project facts" marker; facts will refuse (exit 3) unless run with --append, which adds the block after the text']);
});

test("a specialist over create_bot's 1000-character limit warns, and the chief is exempt", () => {
  const out = warn((d) => { d.package.agents[1].description = X(1001); });
  assert.deepEqual(out.errors, []);
  assert.deepEqual(at(out, "package.agents.1.description").map((w) => w.message), ["agent sage's description is 1001 characters, over create_bot's 1000-character instructions limit; only matters if the lead re-creates this specialist with create_bot"]);
  const chief = warn((d) => { d.package.agents[0].description = `${X(1001)}\nProject facts (edit me): default branch: main.`; });
  assert.equal(at(chief, "package.agents.0.description").length, 0, "the chief is measured against its own budget, not create_bot's");
});

test("four small playbooks on one bot do not warn: a turn mounts at most three of them", () => {
  const out = warn((d) => {
    d.package.playbooks = ["a", "b", "c", "e"].map((k) => ({ key: k, name: k.toUpperCase(), summary: "s", triggers: ["t"], instructions: X(7000) }));
    d.package.agents[1].playbooks = ["a", "b", "c", "e"];
  });
  assert.deepEqual(out.errors, []);
  assert.deepEqual(at(out, "package.agents.1.playbooks"), []);
});

test("one bot's assigned playbooks warn only when together they pass the mount budget", () => {
  const two = (d) => { d.package.playbooks = [{ key: "a", name: "A", summary: "s", triggers: ["t"], instructions: X(12001) }, { key: "b", name: "B", summary: "s", triggers: ["t"], instructions: X(12001) }]; };
  const one = warn((d) => { two(d); d.package.agents[1].playbooks = ["a", "b"]; });
  assert.deepEqual(one.errors, []);
  assert.deepEqual(at(one, "package.agents.1.playbooks").map((w) => w.message), ["agent sage's three longest playbooks total 24002 instruction characters; a turn mounts at most three matching playbooks within 24000, so a turn that matches them may be cut"]);
  const split = warn((d) => { two(d); d.package.agents[1].playbooks = ["a"]; d.package.agents[2].playbooks = ["b"]; });
  assert.deepEqual(split.errors, []);
  assert.deepEqual(split.warnings.filter((w) => w.path.endsWith(".playbooks")), [], "the budget is per bot, not per package");
});

test("the file name convention is a warning, and only a warning", () => {
  const named = validatePackage(load(), { fileName: "dev-team.package.json" });
  assert.deepEqual(named.errors, []);
  assert.equal(named.ok, true);
  assert.deepEqual(named.warnings, [{ path: "", message: "dev-team.package.json does not end in .openmaus.json (convention only)" }]);
  assert.deepEqual(validatePackage(load(), { fileName: "dev-team.openmaus.json" }).warnings, [], "the fixture is clean under its conventional name");
  assert.deepEqual(validatePackage(load()).warnings, [], "with no file name there is nothing to say about one");
});

test("a key the schema does not declare is dropped by the server, so the launcher names it", () => {
  const out = warn((d) => { d.package.chiefofstaff = "sudo"; d.package.agents[1].instructions = "You plan."; });
  assert.deepEqual(out.errors, []);
  assert.deepEqual(out.warnings, [
    { path: "package.chiefofstaff", message: "package.chiefofstaff is not a package field; the server drops unknown fields" },
    { path: "package.agents.1.instructions", message: "package.agents.1.instructions is not a package field; the server drops unknown fields" },
  ]);
});

test("the summary is lenient enough to exist for a document that is not a package at all", () => {
  const out = validatePackage("nope");
  assert.equal(out.ok, false);
  assert.deepEqual(out.summary, { id: null, release: null, name: null, agents: [], chiefOfStaff: null, rooms: [], playbooks: [], playbookChars: 0 });
  const good = validatePackage(load()).summary;
  assert.equal(good.id, "atw-dev-team");
  assert.equal(good.chiefOfStaff, "sudo");
  assert.deepEqual(good.agents.map((a) => a.key), ["sudo", "sage", "vale", "nova", "quill"]);
  assert.equal(good.agents[1].descriptionLength, "You plan.".length);
  assert.deepEqual(good.rooms, ["dev-room"]);
  assert.deepEqual(good.playbooks, ["worktree-workflow"]);
  assert.equal(good.playbookChars, 1);
});

// --- the file's own content never reaches an error message -------------------

test("parseJsonFile refuses without quoting the file, and Node's own parser would have quoted it", () => {
  const secretish = "sk-SYNTHETIC-9f3a";
  let native = null;
  try { JSON.parse(secretish); } catch (e) { native = e.message; }
  assert.match(native ?? "", /SYNTHET/, "the guard is only meaningful while Node quotes the input");
  assert.throws(() => parseJsonFile(secretish), (e) => e instanceof SyntaxError && e.message === "not JSON" && !/SYNTHET/.test(e.stack));
  assert.throws(() => parseJsonFile('{ "a": 1, }'), (e) => e.message === "not JSON (SyntaxError at position 10)");
  assert.throws(() => parseJsonFile(""), (e) => e.message === "not JSON");
});

test("validate never prints the file it could not parse, with or without --verbose", async () => {
  const dir = tmpDir("oml-validate-");
  const file = path.join(dir, "token.openmaus.json");
  fs.writeFileSync(file, "sk-SYNTHETIC-9f3a");
  for (const extra of [[], ["--verbose"], ["--brief"]]) {
    const r = await runOmb(["validate", file, ...extra], { env });
    assert.equal(r.code, 2, r.stdout);
    assert.equal(/SYNTHET/.test(r.stdout), false, `stdout leaked the file: ${r.stdout}`);
    assert.equal(/SYNTHET/.test(r.stderr), false, `stderr leaked the file: ${r.stderr}`);
  }
  const r = await runOmb(["validate", file], { env });
  assert.equal(r.json.error, `${file} is not JSON`);
});

test("a valid package's prose never reaches the verb's own output", async () => {
  const dir = tmpDir("oml-validate-");
  const file = path.join(dir, "prose.openmaus.json");
  const doc = load();
  doc.package.summary = "A team that handles sk-SYNTHETIC-9f3a rotations.";
  doc.package.agents[1].description = "You plan sk-SYNTHETIC-9f3a rotations.";
  fs.writeFileSync(file, JSON.stringify(doc));
  const r = await runOmb(["validate", file], { env });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(/SYNTHET/.test(r.stdout), false, `stdout leaked a prose field: ${r.stdout}`);
});

// --- the verb ---------------------------------------------------------------

test("validate reports a good package, its summary, and the file-name convention", async () => {
  const r = await runOmb(["validate", PKG], { env });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.verb, "validate");
  assert.equal(r.json.valid, true);
  assert.equal(r.json.file, PKG);
  assert.deepEqual(r.json.errors, []);
  assert.deepEqual(r.json.summary.agents.map((a) => a.key), ["sudo", "sage", "vale", "nova", "quill"]);
  assert.equal(r.json.summary.chiefOfStaff, "sudo");
  assert.deepEqual(r.json.warnings, [{ path: "", message: "dev-team.package.json does not end in .openmaus.json (convention only)" }]);
  const brief = await runOmb(["validate", PKG, "--brief"], { env });
  assert.equal(brief.stdout, "validate · dev-team.package.json · ok · 5 agents, 1 room(s), 1 playbook(s) · chief sudo · 1 warning(s)\n");
});

test("a package the server would refuse is exit 3, carrying every error and the one the server reports first", async () => {
  const dir = tmpDir("oml-validate-");
  const file = path.join(dir, "broken.openmaus.json");
  const doc = load();
  delete doc.package.name;
  fs.writeFileSync(file, JSON.stringify(doc));
  const r = await runOmb(["validate", file], { env });
  assert.equal(r.code, 3, r.stdout);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.valid, false);
  assert.match(r.json.error, /^1 error\(s\) in broken\.openmaus\.json: package\.name must be text$/);
  assert.deepEqual(r.json.errors[0], { path: "package.name", message: "must be text", kind: "schema" });
  assert.equal(r.json.hint, "fix errors[0] first: it is the one the server would report");
  assert.deepEqual(r.json.warnings, []);
  assert.ok(r.json.summary);
  const brief = await runOmb(["validate", file, "--brief"], { env });
  assert.equal(brief.code, 3);
  assert.equal(brief.stdout, "validate · broken.openmaus.json · 1 error(s) · package.name must be text\n");
});

test("a cross-reference failure renders as the server renders it: the message alone", async () => {
  const dir = tmpDir("oml-validate-");
  const file = path.join(dir, "dup.openmaus.json");
  const doc = load();
  doc.package.agents.push(JSON.parse(JSON.stringify(doc.package.agents[0])));
  fs.writeFileSync(file, JSON.stringify(doc));
  const r = await runOmb(["validate", file, "--brief"], { env });
  assert.equal(r.code, 3);
  assert.equal(r.stdout, "validate · dup.openmaus.json · 1 error(s) · Duplicate agent key: sudo\n");
});

test("validate's usage, unreadable, BotMRR and not-JSON refusals are all exit 2", async () => {
  let r = await runOmb(["validate"], { env });
  assert.equal(r.code, 2);
  assert.equal(r.json.error, "usage: validate <package.json>");
  r = await runOmb(["validate", "/nowhere/nothing.json"], { env });
  assert.equal(r.code, 2);
  assert.match(r.json.error, /^cannot read \/nowhere\/nothing\.json: /);
  const dir = tmpDir("oml-validate-");
  const md = path.join(dir, "team.md");
  fs.writeFileSync(md, "---\nbotmrr: 1\nname: Team\n---\n\n## Mission\n");
  r = await runOmb(["validate", md], { env });
  assert.equal(r.code, 2);
  assert.equal(r.json.error, `${md} is a BotMRR Markdown document; this launcher validates and imports openmaus.package JSON only`);
  assert.equal(r.json.hint, "the OpenMausBot app's Import dialog accepts it; for omb import, write the same package as JSON");
});

test("a JSON document that is not a package is exit 3, not exit 2", async () => {
  const r = await runOmb(["validate", path.join(ROOT, "package.json")], { env });
  assert.equal(r.code, 3, r.stdout);
  assert.equal(r.json.errors[0].path, "format");
  assert.match(r.json.hint, /format is not openmaus\.package, so the server would not judge it by this schema/);
  assert.equal(r.json.errors[0].message, "This is not an OpenMaus package");
});

test("validate reads no configuration: a bad --project or --url cannot fail a file check", async () => {
  const r = await runOmb(["validate", PKG, "--project", "/nowhere", "--url", "http://127.0.0.1:1", "--dry-run"], { env });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.valid, true);
});

// The reference's skeleton is the one package this repository hands an agent to
// copy, so it is held to the standard the reference asks of the agent's own
// file: nothing the server would refuse, and nothing the launcher would warn
// about.
test("the skeleton in references/team-authoring.md validates with no errors and no warnings", () => {
  const reference = fs.readFileSync(path.join(ROOT, "skills", "openmausbot-launcher", "references", "team-authoring.md"), "utf8");
  const block = /```json\n([\s\S]*?)```/.exec(reference);
  assert.ok(block, "the reference carries the skeleton in one fenced json block");
  const doc = JSON.parse(block[1]);
  const { errors, warnings } = validatePackage(doc, { fileName: "example.openmaus.json" });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});
