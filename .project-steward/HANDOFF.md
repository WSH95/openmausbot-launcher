---
updated_at: 2026-09-08
updated_by: codex
session_status: closed
---
# Handoff

## Now

The user-approved M1.1 repair is complete under Beads epic `oml-t8u`.
The full `npm test` suite passed 153/153 again in 49.324 s on Node 24.11.0;
independent code and documentation reviews approved the final changes.
M1 itself remains open (`oml-axr`): formal host command checks are incomplete,
tracked in `oml-axr.15`. Decision 0006 clarifies that team packages are supplied
inputs and `dev-team.openmaus.json` is a test configuration. Its optional
package checks do not gate launcher acceptance. Original T12 remains 8/9.

## In flight

No repair implementation remains. Commit `5cfde51` contains the M1.1 repairs
and Git policy correction on `main`, following the user's explicit commit
request. The current documentation checkpoint corrects the supplied-package
boundary and M1 criteria under `oml-qh7`; it changes no driver or package code.
The 50 existing import/report tests passed in 7.119 s; `git diff --check`
passed. Local Git work and tested commits are permitted; every `git push`
requires explicit permission (Decision 0005, `oml-2d5`).
The initial repair used `/tmp/oml-m1-baseline-tzs2tgl8` for review; this
checkpoint was also reviewed with Git and passed `git diff --check`.

Changed source areas: state/session transactions and SQLite locking;
HTTP cancellation; snapshot/watch evidence and deadlines; command identity
and dry-run guards; process cleanup; archived report evidence and approval
attribution. New modules are `lib/session.mjs` and `lib/verbs/report.mjs`.
Tests and the fake card contract changed alongside them. README, design,
evidence, SKILL.md, API/host/dev-team/pitfall references, and steward records
were updated. Steward runtime files also reflect CLI bookkeeping.
The subsequent policy correction changed AGENTS.md, CLAUDE.md,
`.beads/PRIME.md`, Beads configuration and steward policy records; it
changed no driver code.

## Next steps

1. Read `bd show oml-axr.15` for the missing doctor/status/send evidence on
   Claude Code, Codex and Grok. Use the existing supplied test package and
   record each host's commands and results. No package edit or 9/9 package
   score is a prerequisite. The M1.1 repair and this scope correction spent
   no new bot turns.
2. Use `bd ready` for later work; the existing v2 issues own special
   request types, pairing, macOS, phone-host verification and parallel runs.
3. Obtain explicit user permission before any `git push`; the checkpoint
   is local only.

## Blockers

Missing host command evidence keeps M1 open. The dev-team ListAgents finding
is a package diagnostic, not a launcher blocker. The repository permits Git
operations. The previous hook prevented the full Git-reading T12 report
invocation; that is historical,
not current policy. A Git-free reanalysis using the same report helpers
verified three archive checks without HTTP, tests, state writes, or bot
turns. The six repository/test checks retain their original evidence only.

## Key files

- `docs/design.md`: authoritative repaired behavior, state and identity rules.
- `docs/evidence.md`: original T12 and the offline attribution correction.
- `.project-steward/VERIFY.md`: full suite, review results and explicit gaps.
- `skills/openmausbot-launcher/references/limits-and-pitfalls.md`: lock
  upgrade, bounded checkpoints, and report evidence rules.
- `tests/monitoring.test.mjs`, `identity.test.mjs`, `dry-run.test.mjs`,
  `report-evidence.test.mjs` and extended existing suites: repair regressions.

## Tried and rejected

Directory-lock reclaiming and age-based stealing admit concurrent writers.
SQLite uses immediate attempts, bounded asynchronous busy retries, and a
persistent database. Unknown evidence cannot authorize done or report pass.
The lead's paraphrase is not reviewer approval; the real T12 ask result is
03:10:22.421Z, before the worktree at 03:10:32.046Z. Do not weaken regressions
to reinstate either behavior.

## Warnings

For legacy `.omb/lock` refusal, stop every launcher command and automation,
update every installed copy, then remove only that legacy path. Never
unlink or rotate `lock.sqlite`; a hung live writer is stopped explicitly.
Node's experimental SQLite warning stays on stderr; JSON is on stdout.
`checkpointed:false` means an observation was not saved, so watch again.
Dry-run reports execute no tests; skipped required evidence stays unknown.
Historical reanalysis preserves the original report. Startup identity
failure reports the URL, log and spawned PIDs for manual recovery.

Do not claim 9/9 pack validation or all-host coverage. Package-specific
checks apply only when requested; preserve the historical T12 result.
M1.1 and this scope correction spent zero new bot turns and changed no
dev-pack files. All remaining work is in Beads.
