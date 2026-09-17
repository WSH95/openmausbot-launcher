import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, OMB, SKILL_DIR } from "./helpers.mjs";

const WORDS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function tomlTable(source, name) {
  const lines = source.split("\n");
  const start = lines.indexOf(`[${name}]`);
  assert.ok(start >= 0, `missing TOML table [${name}]`);
  const end = lines.findIndex((line, index) => index > start && /^\[.+\]$/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
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
  const files = ["skills/openmausbot-launcher/SKILL.md", ...docs, ...fs.readdirSync(path.join(SKILL_DIR, "references")).map((f) => `skills/openmausbot-launcher/references/${f}`)];
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
