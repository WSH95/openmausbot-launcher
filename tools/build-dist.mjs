#!/usr/bin/env node
// Build the distribution payload: copy the canonical skill directory
// (skills/openmausbot-launcher/) into dist/openmausbot-launcher/, the exact
// tree that ships to the agent-skills registry. Runtime junk is pruned, a set
// of required files is checked before anything is written, and a stale
// payload is replaced, never merged. Node built-ins only.
//
//   node tools/build-dist.mjs                 # skills/openmausbot-launcher -> dist/openmausbot-launcher
//   node tools/build-dist.mjs --out DIR       # build elsewhere (the tests do)
//   node tools/build-dist.mjs --src DIR       # build from another source tree
//
// Prints one JSON object: { ok, src, out, files }. Exit 1 with the missing
// files on stderr when the source is incomplete.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NAME = "openmausbot-launcher";

// Every file a payload must carry; the skill is unusable without any of them.
const REQUIRED = [
  "SKILL.md",
  "README.md",
  "scripts/omb.mjs",
  "scripts/lib/cli.mjs",
  "scripts/lib/package.mjs",
  "scripts/lib/verbs/validate.mjs",
  "references/api.md",
  "references/dev-team.md",
  "references/evidence.md",
  "references/hosts.md",
  "references/limits-and-pitfalls.md",
  "references/team-authoring.md",
  "assets/codex/omb-loopback.config.toml",
  "agents/openai.yaml",
];
// Directories that never belong in a payload (driver state, caches, worktrees).
const PRUNE_DIRS = new Set([".omb", ".git", ".worktrees", "node_modules", "__pycache__", ".pytest_cache"]);
// Files that never belong in a payload (server logs, editor and OS cruft).
const junk = (name) => name === ".DS_Store" || name === "Thumbs.db" || /\.(log|pyc|pyo|swp|swo|tmp|orig|rej)$/.test(name);

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
for (const a of args) if (a.startsWith("--") && !["--src", "--out"].includes(a)) fail(`unknown option ${a}; use --src DIR and --out DIR`);
const src = path.resolve(ROOT, flag("--src") ?? path.join("skills", NAME));
const out = path.resolve(ROOT, flag("--out") ?? path.join("dist", NAME));

function fail(message) { process.stderr.write(`build: ${message}\n`); process.exit(1); }

if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) fail(`source directory not found: ${src}`);
const missing = REQUIRED.filter((f) => !fs.existsSync(path.join(src, f)));
if (missing.length) fail(`source is incomplete, missing required file(s):\n  ${missing.join("\n  ")}`);
const skill = fs.readFileSync(path.join(src, "SKILL.md"), "utf8");
if (!skill.startsWith("---\n") || skill.indexOf("\n---", 4) < 0) fail("SKILL.md has no closed YAML frontmatter");
const fm = skill.slice(4, skill.indexOf("\n---", 4));
for (const key of ["name:", "description:"]) if (!fm.split("\n").some((l) => l.startsWith(key))) fail(`SKILL.md frontmatter has no ${key.slice(0, -1)}`);
const nameLine = fm.split("\n").find((l) => l.startsWith("name: "));
if (nameLine !== `name: ${NAME}`) fail(`SKILL.md frontmatter name is "${nameLine?.slice(6)}", expected "${NAME}"`);

// Never remove anything that is not a payload directory of our own making.
const outRoot = path.parse(out).root;
if (out === outRoot || out === ROOT || src === out || src.startsWith(out + path.sep) || out.startsWith(src + path.sep)) fail(`refusing to write the payload at ${out}`);
if (fs.existsSync(out)) fs.rmSync(out, { recursive: true, force: true });

const files = [];
function copyTree(from, to, rel) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { if (!PRUNE_DIRS.has(entry.name)) copyTree(path.join(from, entry.name), path.join(to, entry.name), relPath); continue; }
    if (!entry.isFile() || junk(entry.name)) continue;   // symlinks and junk are left behind
    fs.copyFileSync(path.join(from, entry.name), path.join(to, entry.name));
    fs.chmodSync(path.join(to, entry.name), fs.statSync(path.join(from, entry.name)).mode & 0o777);
    files.push(relPath);
  }
}
copyTree(src, out, "");
files.sort();
process.stdout.write(JSON.stringify({ ok: true, src, out, files }, null, 2) + "\n");
