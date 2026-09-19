---
updated_at: 2026-09-19T00:33:54Z
updated_by: cli
session_status: closed
branch: main
---
# Handoff

## Now

The skill is distributed. `main` is public at
`https://github.com/WSH95/openmausbot-launcher` (MIT detected from the
repository's `LICENSE`; tag `v0.1.0` pushed at `67abb01`), and the registry
pull request `https://github.com/WSH95/agent-skills/pull/6` "Publish
openmausbot-launcher 0.1.0" is open and not merged: 36 files, the payload at
`skills/openmausbot-launcher/` plus this skill's bullet and use-case block in
that README and nothing else. The tooling: `tools/build-dist.mjs` (Node,
built-ins only) builds `dist/openmausbot-launcher/` (gitignored) from the
skill directory, prunes `.omb/`, `node_modules/`, logs and editor cruft,
refuses a source missing a required file and replaces a stale payload;
`tools/publish_agent_artifact_pr.py` is the sibling projects' publish script
adapted to read the version from `package.json`, title the PR `Publish
<name> <version>` and clone through `gh repo clone`, driven by
`agent-artifacts.json` and the registry entry
`docs/registry/openmausbot-launcher.md`. `tests/dist.test.mjs` (8 tests)
pins the payload to the tracked skill tree byte for byte; `npm test` passes
598/598. Decision 0021 records it, with the one AGENTS.md Layout bullet as an
approved exception. Beads: `oml-2k0` closed; `oml-i13` open for host
acceptance of the authoring interview; `oml-hou` (macOS) open. Two local
commits are ahead of `origin/main`: `0a0b839` (the gh-clone fix found on the
first publish attempt) and the steward commit that carries this handoff;
pushing them needs the user's permission. This session spent 0 OpenMausBot
bot turns.

## In flight

Nothing. The working tree is clean after the steward commit (checked with
`git status`); `dist/openmausbot-launcher/` exists locally from the publish
build and is ignored.

## Next steps

1. Ask the user whether to push the two local commits: `git push origin
   main`, only on an explicit yes for that push.
2. After the user merges PR #6, the skill installs with
   `npx skills add WSH95/agent-skills@openmausbot-launcher`; nothing else is
   needed. For a later release: bump `version` in `package.json` and
   `metadata.version` in `SKILL.md` together (a test keeps them equal, and
   the frontmatter mirror in `docs/design.md` must follow), commit, run
   `python3 tools/publish_agent_artifact_pr.py --dry-run`, then without
   `--dry-run` with the user's permission; the script exits without a PR
   when the payload equals what is published.
3. Host acceptance of the authoring interview (`oml-i13`), the user's step:
   in Claude Code run `/openmausbot-launcher write a team package for
   <something small>`; expect a question first and no verb, a proposal with
   reasons, the summary before any file, a change at the summary reflected
   and re-sent, then a file that `omb validate` passes with a roster equal to
   the summary. Close the bead on the result or on a waiver.
4. Two `--fresh` data directories from the parity check sit in the home
   directory (`/home/wsh/.openmausbot-20260918T233400-ttDip9` and
   `…-20260918T233455-2ItQID`); delete them only when the user says so.
5. `oml-hou`: macOS lifecycle, only when a Mac or an explicit decision is
   available.
6. Reviews (user instructions of 2026-09-18): `/grok-build:review` on grok-4.6
   (`high`, the bridge's maximum) plus a Fable 5.1 reviewer at xhigh; after
   two rounds, a Fable 5.1 xhigh rescue, then an Opus 5 (max) completeness
   review. Opus 5 (max) implements; Fable plans; gpt-6-astra reviews plans.

## Blockers

None.

## Key files

- `tools/build-dist.mjs`: `REQUIRED`, `PRUNE_DIRS`, `junk()`, the guard that
  refuses to write outside a payload directory; `--src` and `--out`.
- `tools/publish_agent_artifact_pr.py`: `merge_skill_into_readme` upserts
  only this skill's bullet and `#### openmausbot-launcher Use Case` block;
  `version()` reads `package.json`; `gh repo clone`; never merges; `--dry-run`
  makes no network call.
- `agent-artifacts.json`: the manifest; `docs/registry/openmausbot-launcher.md`:
  the registry entry (edit this, never the registry README by hand).
- `tests/dist.test.mjs`: the payload, junk, missing-file, stale-output,
  manifest, version, ignore and dry-run tests.
- `README.md` "Build and publish"; `docs/design.md` layout tree and the
  "Distribution" paragraph; `.project-steward/DECISIONS.md` 0021; `PLAN.md`
  "Distribution".
- The feature files from the previous handoff are unchanged: `SKILL.md` §3,
  `references/team-authoring.md`, `scripts/lib/package.mjs`,
  `scripts/lib/verbs/validate.mjs`, `tests/validate.test.mjs`.

## Tried and rejected

- Cloning the registry over https inside the publish script: the branch
  push failed with `could not read Username for 'https://github.com'`
  because git had no credential helper while `gh` uses ssh. `gh repo clone`
  follows the configured protocol; the first attempt left nothing on the
  remote and the second opened PR #6.
- Renaming `skills/` to `skill-src/`: the layout was already one canonical
  tree plus a generated payload, so the names were kept.
- `gh repo create --license mit` together with `--source .`: the repository
  already carries `LICENSE`, which GitHub detects as MIT.

## Warnings

- `dist/` is generated: never edit or commit it. The dist test compares the
  payload with `git ls-files skills/openmausbot-launcher`, so an untracked
  file inside the skill directory fails the test until it is tracked or
  removed.
- The registry README is shared with other skills; the script writes only
  this skill's bullet and block, found by `- [openmausbot-launcher]` and the
  `#### openmausbot-launcher Use Case` heading. Keep both spellings.
- The repository is public. A scan of every tracked file before the push
  found no credential; the Tailscale MagicDNS name in
  `docs/validation/2026-09-16-remote-tailscale.json` and `PROGRESS.md` is
  published knowingly (Decision 0021). Scan again before pushing new
  evidence.
- Every push needs the user's explicit permission for that push
  (`config.toml` `never_push = true`; Decision 0005).
- SKILL.md is 463 lines of a 500 cap; its frontmatter must stay
  byte-identical to the yaml block in `docs/design.md`; its body must never
  contain "README"; `LIMITS` and the reference's field tables are pinned to
  each other.
- A background `codex exec` under the Bash tool is capped at ten minutes;
  the grok-build bridge accepts `--effort` up to `high` only.
