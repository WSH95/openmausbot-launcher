import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SKILL_DIR } from "./helpers.mjs";

function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(m, "SKILL.md starts with a YAML frontmatter block");
  const fields = Object.create(null);
  // Every top-level key, whatever it is spelled with: the key is the text
  // before the first colon on an unindented line. A narrower pattern would
  // let a vendor key like `vendor_flag: true` through unexamined.
  for (const line of m[1].split("\n")) {
    const k = /^([^\s:][^:]*):\s*(.*)$/.exec(line);
    if (k) fields[k[1].trim()] = k[2];
  }
  return { fields, body: m[2] };
}

// The six top-level fields the agentskills.io specification defines. Its
// reference validator (skills-ref `validator.py`) reports anything else as
// "Unexpected fields in frontmatter", so this frontmatter does not conform:
// it carries one extension key on purpose, argued in DECISIONS.md 0019. What
// the tests can still guarantee is that it is the only one.
const SPEC_FIELDS = ["name", "description", "license", "allowed-tools", "metadata", "compatibility"];

test("SKILL.md frontmatter does not conform to the spec: one extension key beyond the six, no other, and the body stays small", () => {
  const text = fs.readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf8");
  const { fields, body } = frontmatter(text);
  assert.equal(fields.name, path.basename(SKILL_DIR), "name equals the directory name");
  assert.match(fields.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(fields.name.length <= 64);
  assert.ok(fields.description && fields.description.length > 0 && fields.description.length <= 1024, "description 1-1024 chars");
  assert.ok(!fields.compatibility || fields.compatibility.length <= 500);
  const extensions = Object.keys(fields).filter((key) => !SPEC_FIELDS.includes(key));
  assert.deepEqual(extensions, ["disable-model-invocation"], "the only field outside the specification's six is the invocation switch the hosts read at the top level");
  assert.ok(body.split("\n").length < 500, "body under 500 lines");
});

test("metadata values are strings (a string map per the spec)", () => {
  const text = fs.readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf8");
  const block = /^metadata:\n((?:  .*\n)+)/m.exec(text.split("\n---\n")[0] + "\n");
  if (!block) return;
  for (const line of block[1].trimEnd().split("\n")) assert.match(line, /^  [a-z][a-z0-9-]*: \S/, `scalar metadata line: ${line}`);
});
