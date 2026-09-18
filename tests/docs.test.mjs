import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, OMB, SKILL_DIR } from "./helpers.mjs";
import { COLORS, LIMITS } from "../skills/openmausbot-launcher/scripts/lib/package.mjs";

const WORDS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function tomlTable(source, name) {
  const lines = source.split("\n");
  const start = lines.indexOf(`[${name}]`);
  assert.ok(start >= 0, `missing TOML table [${name}]`);
  const end = lines.findIndex((line, index) => index > start && /^\[.+\]$/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

/** The indented lines under `<name>:`, the way `tomlTable` reads a TOML table. */
function yamlBlock(source, name) {
  const lines = source.split("\n");
  const start = lines.indexOf(`${name}:`);
  assert.ok(start >= 0, `missing YAML block ${name}:`);
  const end = lines.findIndex((line, index) => index > start && line.trim() !== "" && !/^\s/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

/** The SKILL.md frontmatter, delimiters included: what the design has to mirror. */
function skillFrontmatter() {
  const m = /^(---\n[\s\S]*?\n---)\n/.exec(read("skills/openmausbot-launcher/SKILL.md"));
  assert.ok(m, "SKILL.md opens with a YAML frontmatter block");
  return m[1];
}

function registeredVerbs() {
  const r = spawnSync(process.execPath, [OMB], { encoding: "utf8" });
  assert.equal(r.status, 2, "no verb is a usage error");
  return JSON.parse(r.stdout).hint.replace(/^verbs: /, "").split(", ");
}

function designVerbRows() {
  const lines = read("docs/design.md").split("\n");
  const start = lines.findIndex((l) => l.startsWith("| Verb | Arguments |"));
  assert.ok(start >= 0, "docs/design.md has the verb table");
  const rows = [];
  for (const l of lines.slice(start + 2)) { if (!l.startsWith("|")) break; rows.push(/^\| `([a-z]+)`/.exec(l)[1]); }
  return rows;
}

test("README and the design verb table name every registered verb, no more", () => {
  const verbs = registeredVerbs().sort();
  const word = /The driver has (\w+) verbs/.exec(read("README.md"))?.[1];
  assert.equal(WORDS[word], verbs.length, `README says "${word}" verbs; the driver registers ${verbs.length}`);
  assert.deepEqual(designVerbRows().sort(), verbs);
});

test("every docs/upstream reference points at the dev pack, which owns that directory", () => {
  const refs = fs.readdirSync(path.join(SKILL_DIR, "references")).map((f) => path.join("skills/openmausbot-launcher/references", f));
  for (const file of ["AGENTS.md", "docs/design.md", ...refs]) {
    for (const m of read(file).matchAll(/\S*docs\/upstream\//g)) assert.match(m[0], /agent-team-devpack\/docs\/upstream\/$/, `${file}: ${m[0]}`);
  }
});

test("no shipped instruction asks the agent to compose a command that carries a credential", () => {
  const docs = fs.readdirSync(path.join(ROOT, "docs"), { recursive: true }).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`);
  const files = ["skills/openmausbot-launcher/SKILL.md", "skills/openmausbot-launcher/README.md", ...docs, ...fs.readdirSync(path.join(SKILL_DIR, "references")).map((f) => `skills/openmausbot-launcher/references/${f}`)];
  for (const file of files) {
    const text = read(file);
    // `OMB_SECRET=` in an instruction is an invitation to substitute the value
    // into the tool call, where the transcript keeps it forever.
    assert.equal(/OMB_SECRET\s*=/.test(text), false, `${file} shows an assignment to OMB_SECRET`);
  }
  const skill = read("skills/openmausbot-launcher/SKILL.md");
  assert.match(skill, /--secret-stdin/, "the skill names the path that keeps the value out of the command");
  assert.match(skill, /read -rs OMB_SECRET/, "the skill names the shell form the user types themselves");
});

test("the operator skill explains an unverified watch result and how to retry it", () => {
  const skill = read("skills/openmausbot-launcher/SKILL.md");
  assert.match(skill, /outcome:\s*["`]?unverified/);
  assert.match(skill, /complete:\s*false/);
  assert.match(skill, /checkpointed:\s*false/);
  assert.match(skill, /exit 4/);
  assert.match(skill, /call\s+`watch` again/);
  assert.ok(skill.split("\n").length < 500);
});

test("the Codex profile grants network access only to exact launcher loopback hosts", () => {
  const profile = read("skills/openmausbot-launcher/assets/codex/omb-loopback.config.toml");
  assert.match(profile, /^default_permissions = "omb-loopback"$/m);
  assert.match(profile, /^network_proxy = true$/m);
  assert.match(profile, /^extends = ":workspace"$/m);
  assert.match(profile, /^enabled = true$/m);
  assert.doesNotMatch(profile, /sandbox_mode|\[sandbox_workspace_write\]/);
  assert.doesNotMatch(profile, /permissions\.omb-loopback\.(?:workspace_roots|filesystem)/);
  assert.doesNotMatch(profile, /allow_local_binding|dangerously_|127\.0\.0\.2/);

  const domains = [...tomlTable(profile, "permissions.omb-loopback.network.domains").matchAll(/^"([^"]+)" = "allow"$/gm)].map((match) => match[1]).sort();
  assert.deepEqual(domains, ["127.0.0.1", "localhost"]);
});

test("the repository Codex profile keeps the fake proxy address maintainer-only", () => {
  const profile = read(".codex/config.toml");
  assert.match(profile, /^network_proxy = true$/m);
  assert.doesNotMatch(profile, /^default_permissions\s*=/m, "ordinary repository sessions keep Codex's default permissions");
  assert.match(profile, /^\[permissions\.omb-loopback-dev\]$/m);
  assert.match(profile, /^extends = ":workspace"$/m);
  assert.match(tomlTable(profile, "permissions.omb-loopback-dev.network"), /^enabled = true$/m);
  assert.doesNotMatch(profile, /sandbox_mode|\[sandbox_workspace_write\]/);
  assert.doesNotMatch(profile, /permissions\.omb-loopback-dev\.(?:workspace_roots|filesystem)/);
  assert.doesNotMatch(profile, /allow_local_binding|dangerously_/);
  const domains = [...tomlTable(profile, "permissions.omb-loopback-dev.network.domains").matchAll(/^"([^"]+)" = "allow"$/gm)].map((match) => match[1]).sort();
  assert.deepEqual(domains, ["127.0.0.1", "127.0.0.2", "localhost"]);
});

test("the Codex instructions warn that legacy sandbox settings override permission profiles", () => {
  const hosts = read("skills/openmausbot-launcher/references/hosts.md");
  assert.match(hosts, /sandbox_mode/);
  assert.match(hosts, /sandbox_workspace_write/);
  assert.match(hosts, /ignores?\s+`default_permissions`/);
});

test("the invocation switches are set on both sources of truth", () => {
  // Claude Code, Grok Build, OpenClaw and DeepSeek Harness read the frontmatter
  // key; Codex reads agents/openai.yaml. An operator mode that spends the
  // user's subscriptions starts when the user says so, on every host that asks.
  const frontmatter = skillFrontmatter();
  // Count every declaration, not only the true one: a second line saying
  // `false` would be the value a host reads, and the switch would be off.
  const switches = frontmatter.split("\n").filter((line) => /^disable-model-invocation:/.test(line));
  assert.equal(switches.length, 1, "exactly one `disable-model-invocation` line in the frontmatter");
  assert.equal(switches[0], "disable-model-invocation: true", "and it is the one that turns model invocation off");
  assert.doesNotMatch(frontmatter, /^user-invocable:/m, "no `user-invocable` line: the hosts that read it already default to true");

  const codex = read("skills/openmausbot-launcher/agents/openai.yaml");
  assert.match(yamlBlock(codex, "policy"), /^\s+allow_implicit_invocation: false$/m);
  assert.equal(codex.match(/allow_implicit_invocation/g).length, 1, "one `allow_implicit_invocation` line, so no second value contradicts it");
});

test("the design mirrors the shipped frontmatter verbatim", () => {
  const design = read("docs/design.md");
  const heading = design.indexOf("\n## SKILL.md\n");
  assert.ok(heading >= 0, "docs/design.md has the `## SKILL.md` section");
  const quoted = /```yaml\n([\s\S]*?)```/.exec(design.slice(heading));
  assert.ok(quoted, "that section quotes the frontmatter in a yaml block");
  assert.equal(quoted[1].trimEnd(), skillFrontmatter(), "docs/design.md quotes the frontmatter the skill actually ships");
});

test("the routing paragraph precedes setup, covers each arrival form, and states what to do", () => {
  const skill = read("skills/openmausbot-launcher/SKILL.md");
  const opening = skill.slice(0, skill.indexOf("\n## 2."));
  assert.ok(opening.length > 0, "SKILL.md has a section before `## 2.`");
  for (const form of ["ARGUMENTS:", "$openmausbot-launcher", "/openmausbot_launcher"]) {
    assert.ok(opening.includes(form), `the routing paragraph names how the request arrives as ${form}`);
  }
  // The transport tokens alone would still pass with the rule deleted, so
  // assert the outcomes: the guard against an arrival with no invocation
  // marker, what a named verb does, both branches of the one exit 3 that
  // means setup, and what a task ends in. The file is hard-wrapped, so match
  // against the text with its line breaks collapsed.
  const flowed = opening.replace(/\s+/g, " ");
  const rules = [
    "run no verb at all",                       // an arrival the host did not inject
    "run that verb",
    "and stop",
    "no team is recorded for this project",     // the only exit 3 that means setup
    "read `error` and `hint`",                  // every other non-zero result
    "instead of setting up",
    "then `task`",                              // a task ends in the task verb
    "runs no verb before the user approves",     // a package is written, not imported, on arrival
    "ask the user",
    "Hermes does not read the switch",
  ];
  for (const rule of rules) assert.ok(flowed.includes(rule), `the routing paragraph states "${rule}"`);
  for (const worked of ["Show status using $openmausbot-launcher", "/openmausbot-launcher do T10 in ~/proj",
    "/openmausbot-launcher write a team package for reviewing pull requests"]) {
    assert.ok(opening.includes(worked), `the routing paragraph works through "${worked}"`);
  }
});

test("the skill README states the prerequisites and its links resolve, and SKILL.md does not reference it", () => {
  const readme = read("skills/openmausbot-launcher/README.md");
  const version = /^\s+omb-version:\s*"([^"]+)"$/m.exec(skillFrontmatter());
  assert.ok(version, "the frontmatter records metadata.omb-version");
  assert.ok(readme.includes(version[1]), `the README names OpenMausBot ${version[1]}, the version the skill was written against`);

  const targets = new Set();
  for (const link of readme.matchAll(/\]\(([^)]+)\)/g)) if (!/^[a-z]+:/.test(link[1])) targets.add(link[1]);
  // A backticked token with a slash is a path in this directory; `cli.js` and
  // `.openmaus.json` name the user's own files and are not ours to resolve.
  for (const quoted of readme.matchAll(/`([^`]+)`/g)) if (/^[\w.-]+(\/[\w.-]+)+$/.test(quoted[1])) targets.add(quoted[1]);
  for (const named of ["SKILL.md", "references/hosts.md", "scripts/omb.mjs"]) {
    assert.ok(readme.includes(named), `the README points at ${named}`);
    targets.add(named);
  }
  for (const target of targets) assert.ok(fs.existsSync(path.join(SKILL_DIR, target)), `the README names ${target}, which does not exist in the skill directory`);

  for (const form of ["OMB_BIN", "/openmausbot-launcher", "$openmausbot-launcher", "/openmausbot_launcher"]) {
    assert.ok(readme.includes(form), `the README names ${form}`);
  }
  // The prerequisites a person has to satisfy before the first `doctor`.
  const flowed = readme.replace(/\s+/g, " ");
  const prerequisites = [
    "Node 24",
    "git repository with a test command",
    "`.openmaus.json`",
    "engine CLIs",
    "Linux for `up`, `down` and `cleanup --kill`",
  ];
  for (const fact of prerequisites) assert.ok(flowed.includes(fact), `the README states the prerequisite ${fact}`);
  const body = read("skills/openmausbot-launcher/SKILL.md").split("\n---\n").slice(1).join("\n---\n");
  assert.doesNotMatch(body, /README/, "SKILL.md is the operator's file and never sends the agent to the README");
});

test("the authoring section runs an interview, names the reference and ends in `validate`", () => {
  const skill = read("skills/openmausbot-launcher/SKILL.md");
  const start = skill.indexOf("\n## 3. Writing a team package\n");
  assert.ok(start >= 0, "SKILL.md has the `## 3. Writing a team package` section");
  const section = skill.slice(start, skill.indexOf("\n## 4.", start));
  assert.ok(section.includes("references/team-authoring.md"), "the section sends the agent to the reference");
  assert.ok(section.includes("omb validate"), "the section names the offline check");
  // The three rules that make this an interview rather than a guess. The file
  // is hard-wrapped, so match against the text with its line breaks collapsed.
  const flowed = section.replace(/\s+/g, " ");
  for (const rule of ["one question per message", "No file, no verb, no draft JSON before an explicit yes", "Import only when the user asks"]) {
    assert.ok(flowed.includes(rule), `the authoring section states "${rule}"`);
  }
});

test("every section cross-reference in SKILL.md names a section the file has", () => {
  const skill = read("skills/openmausbot-launcher/SKILL.md");
  const headings = new Set([...skill.matchAll(/^## (\d+)\. /gm)].map((m) => m[1]));
  const mentions = [...skill.matchAll(/§(\d+)|section (\d+)/g)].map((m) => m[1] ?? m[2]);
  assert.ok(mentions.length >= 4, "the file cross-references its own sections");
  for (const n of mentions) assert.ok(headings.has(n), `SKILL.md points at section ${n}, which it does not have`);
});

test("the authoring reference ships, is listed, and states the format's own limits", () => {
  const rel = "skills/openmausbot-launcher/references/team-authoring.md";
  assert.ok(fs.existsSync(path.join(ROOT, rel)), "the authoring reference ships with the skill");
  const skill = read("skills/openmausbot-launcher/SKILL.md");
  const references = skill.slice(skill.indexOf("\n## 10. References\n"));
  assert.ok(references.includes("references/team-authoring.md"), "the References section lists the authoring reference");

  // The limits in the tables are the ones the driver enforces: a drift between
  // the reference and `package.mjs` would send the agent to the server to
  // discover a limit it was told wrongly.
  const text = read(rel);
  const cell = (limit) => (Array.isArray(limit) ? `${limit[0]}\u2013${limit[1]}` : `\u2264 ${limit}`);
  const FIELDS = [["tagline", LIMITS.tagline], ["description", LIMITS.agentDescription], ["instructions", LIMITS.instructions],
    ["outcomes", LIMITS.outcomes], ["setupMinutes", LIMITS.setupMinutes], ["agents", LIMITS.agents]];
  for (const [field, limit] of FIELDS) {
    const rows = text.split("\n").filter((line) => line.startsWith(`| \`${field}\` |`));
    assert.equal(rows.length, 1, `exactly one table row whose first cell is \`${field}\``);
    assert.ok(rows[0].includes(cell(limit)), `the \`${field}\` row states ${cell(limit)}`);
  }
  for (const color of COLORS) assert.ok(text.includes(color), `the reference names the colour ${color}`);
});
