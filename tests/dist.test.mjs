// The distribution payload: `tools/build-dist.mjs` copies the canonical skill
// directory into dist/ as the exact tree that ships to the agent-skills
// registry, and `agent-artifacts.json` says where it goes.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, tmpDir } from "./helpers.mjs";

const BUILD = path.join(ROOT, "tools", "build-dist.mjs");
const PUBLISH = path.join(ROOT, "tools", "publish_agent_artifact_pr.py");
const SRC = path.join(ROOT, "skills", "openmausbot-launcher");
const NAME = "openmausbot-launcher";

const build = (args) => spawnSync(process.execPath, [BUILD, ...args], { cwd: ROOT, encoding: "utf8" });
const walk = (dir) => fs.readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile())
  .map((d) => path.relative(dir, path.join(d.parentPath, d.name)))
  .sort();
const tracked = () => spawnSync("git", ["ls-files", "-z", "skills/openmausbot-launcher"], { cwd: ROOT, encoding: "utf8" })
  .stdout.split("\0").filter(Boolean).map((f) => path.relative("skills/openmausbot-launcher", f)).sort();
const frontmatter = (text) => Object.fromEntries(text.slice(4, text.indexOf("\n---", 4)).split("\n")
  .map((l) => /^([a-z-]+): (.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));

test("the build copies every tracked skill file byte for byte and nothing else", () => {
  const out = path.join(tmpDir(), "payload");
  const r = build(["--out", out]);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, true);
  const files = walk(out);
  assert.deepEqual(files, tracked(), "the payload is exactly the tracked skill tree");
  assert.deepEqual(report.files, files, "the build reports the files it wrote");
  for (const f of files) assert.ok(fs.readFileSync(path.join(out, f)).equals(fs.readFileSync(path.join(SRC, f))), `${f} is byte-identical`);
  assert.ok(fs.statSync(path.join(out, "scripts", "omb.mjs")).mode & 0o111, "the entry point stays executable");
});

test("the build strips runtime junk the source tree may carry", () => {
  const src = path.join(tmpDir(), "src");
  fs.cpSync(SRC, src, { recursive: true });
  for (const junk of [".omb/state.json", "node_modules/x/index.js", "serve.20260918.log", ".DS_Store", "scripts/__pycache__/a.pyc", "scripts/lib/.tmp.swp"]) {
    fs.mkdirSync(path.dirname(path.join(src, junk)), { recursive: true });
    fs.writeFileSync(path.join(src, junk), "junk");
  }
  const out = path.join(tmpDir(), "payload");
  const r = build(["--src", src, "--out", out]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(walk(out), tracked(), "no junk reaches the payload");
});

test("a source missing a required file fails the build loudly", () => {
  const src = path.join(tmpDir(), "src");
  fs.cpSync(SRC, src, { recursive: true });
  fs.rmSync(path.join(src, "references", "team-authoring.md"));
  const out = path.join(tmpDir(), "payload");
  const r = build(["--src", src, "--out", out]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /references\/team-authoring\.md/);
  assert.equal(fs.existsSync(out), false, "a failed build leaves no partial payload");
});

test("a rebuild replaces a stale payload instead of merging into it", () => {
  const out = path.join(tmpDir(), "payload");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "stale.txt"), "old");
  const r = build(["--out", out]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(out, "stale.txt")), false);
});

test("the manifest names this skill, its build, its destination and a registry entry that exists", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "agent-artifacts.json"), "utf8"));
  const [a, ...rest] = manifest.artifacts;
  assert.deepEqual(rest, [], "one artifact");
  const fm = frontmatter(fs.readFileSync(path.join(SRC, "SKILL.md"), "utf8"));
  assert.equal(a.name, fm.name);
  assert.equal(a.kind, "skill");
  assert.equal(a.build_command, "node tools/build-dist.mjs");
  assert.equal(a.source_path, `dist/${NAME}`);
  assert.equal(a.target_repo, "https://github.com/WSH95/agent-skills");
  assert.equal(a.target_path, `skills/${NAME}`);
  assert.equal(a.base_branch, "main");
  const entry = fs.readFileSync(path.join(ROOT, a.readme_entry), "utf8");
  assert.ok(entry.includes(`- [${NAME}](#${NAME}-use-case)`), "the registry bullet links to its use-case anchor");
  assert.ok(entry.includes(`#### ${NAME} Use Case`), "the registry entry carries the use-case block");
  assert.ok(entry.includes("npx skills add WSH95/agent-skills@" + NAME) || entry.includes(`/${NAME}`), "the entry shows how to invoke it");
});

test("the version is 0.1.0 in package.json, the SKILL.md metadata and the registry entry", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const skill = fs.readFileSync(path.join(SRC, "SKILL.md"), "utf8");
  const version = /^  version: "([^"]+)"$/m.exec(skill)?.[1];
  assert.equal(pkg.version, "0.1.0");
  assert.equal(version, pkg.version, "SKILL.md metadata.version equals package.json");
});

test("dist/ is ignored by git", () => {
  const ignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8").split("\n");
  assert.ok(ignore.includes("dist/"));
});

test("the publish dry run builds, lists the payload paths under the target path, and makes no PR", { skip: spawnSync("python3", ["--version"]).status !== 0 && "python3 not installed" }, () => {
  const r = spawnSync("python3", [PUBLISH, "--dry-run"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DRY RUN/);
  assert.match(r.stdout, new RegExp(`skills/${NAME}/SKILL\\.md`));
  assert.match(r.stdout, new RegExp(`skills/${NAME}/scripts/omb\\.mjs`));
  assert.match(r.stdout, new RegExp(`#### ${NAME} Use Case`));
  assert.doesNotMatch(r.stdout, /PR opened/);
});
