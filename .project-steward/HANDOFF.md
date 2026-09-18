---
updated_at: 2026-09-18T20:05:42Z
updated_by: codex
session_status: closed
branch: main
---
# Handoff

## Now

`oml-c37` is in the Codex rescue stage after two review rounds returned
rework. The five required changes and the saved DSH evidence are implemented:
SKILL.md refuses an uninvoked disk read, the whole frontmatter is explicitly
nonconforming because of its one extension, tests pin every top-level key,
routing outcomes and README prerequisites, and host claims match the probes.
DSH completed two after-edit sessions; its positive ran read-only
`state --show` before `status`. Four earlier launches failed before inference.
The OpenClaw phone invocation remains unexercised.

## In flight

All rescue edits are uncommitted on `main` at
`e0d77350df46545b3b36297c133aeb6f442fdc33`. The user explicitly forbids commits
until the coordinator's Opus completeness review; nothing was pushed. Only
documentation, skill text, the two documentation tests and Steward state
changed. No driver implementation or host policy value changed.

Three mutation/restore cycles in `/tmp/oml-rescue-validation-5xpltkwu`
caught the intended regressions; all restored suites passed 520/520. Final
working-tree `npm test` passed 520/520 in 112.4 s, and `git diff --check`
passed. Results are in `VERIFY.md` and the report below. `oml-c37` stays in
progress for the coordinator's review and commit.

## Next step

The coordinator reads the rescue report, runs the Opus completeness review,
and commits only after that review. Detailed work belongs in Beads. The
existing phone follow-up is `oml-u43`; macOS lifecycle is `oml-hou`. A new
follow-up, `oml-xml`, records a port collision in the untouched lifecycle
overlap test; its subsequent restored suite passed.

## Evidence and verification

- `docs/evidence.md`, 2026-09-18 section: five hosts exercised, four with a
  before/after comparison; DSH source paths, revisions, hashes and session IDs.
- `skills/openmausbot-launcher/SKILL.md` §1 and `references/hosts.md`: the
  host-delivery guard and invocation policy versus manual file reads.
- `tests/docs.test.mjs` and `tests/size.test.mjs`: strengthened assertions.
- `.project-steward/DECISIONS.md` 0019: accepted nonconforming frontmatter.
- `/tmp/claude-1000/-home-wsh-Documents-openmausbot-launcher/2b4b2778-354c-488a-9e30-f8796e2611c7/scratchpad/rescue-report.md`:
  per-finding changes, mutation red/green logs and the DSH rows as written.

## Limits and working rules

The rescue ran no host CLI and no live OpenMausBot server, read no credential
file, and spent zero OMB bot turns. The new invocation guard is covered by
text regression tests, not a fresh host session. The saved probes precede it.
Run `npm test` under `omb-loopback-dev` with both `NO_PROXY` and `no_proxy`
set to `127.0.0.1,localhost,127.0.0.2` as documented in the root README.
Beads is embedded; use `DOLT_DISABLE_EVENT_LOG=true` and
`bd --dolt-auto-commit off --sandbox` during this no-commit rescue. Every push
still requires explicit permission. The phone check needs the user's phone;
macOS lifecycle needs a Mac or an implementation decision.
