import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, OMB, SKILL_DIR } from "./helpers.mjs";

const WORDS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

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

test("the operator skill explains an unverified watch result and how to retry it", () => {
  const skill = read("skills/openmausbot-launcher/SKILL.md");
  assert.match(skill, /outcome:\s*["`]?unverified/);
  assert.match(skill, /complete:\s*false/);
  assert.match(skill, /checkpointed:\s*false/);
  assert.match(skill, /exit 4/);
  assert.match(skill, /call\s+`watch` again/);
  assert.ok(skill.split("\n").length < 500);
});
