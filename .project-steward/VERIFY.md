# Verification

Run the relevant checks before marking work as verified in `HANDOFF.md`.

| Check | Command | Expected |
| --- | --- | --- |
| Build | `none` | exits 0 |
| Tests | `npm test` | all pass |
| Lint | `none` | clean |

## Current M1 completion checkpoint

2026-09-08, Node 24.11.0, `npm test` outside the socket-restricted sandbox:
**154 passed, 0 failed, 0 skipped**, 52.225 s after the source fix.
`node --test tests/snapshot.test.mjs`: **5/5**, 3.441 s. Before the fix,
the new standalone-send regression failed on the missing leader field.
No build or lint command is configured. `git diff --check` passed.

Real OMB 0.1.56: Claude Code 2.1.263, Codex CLI 0.153.4, and Grok Build
1.0.13 each executed local doctor (5/5), server doctor (10/10), status,
one send and reply observation through native shell tools. Codex network
commands required escalation in the recorded configuration. Claude resumed
read-only observation after the fix, without a duplicate send. Native
transcripts and OMB message IDs correlate each command with its reply;
the stored sender role is user, and the operator supplied the text.

All five requested bindings were read back; only Sudo executed (three
successful OMB turns). The other four models, a new full-team task, long
Codex SSE, and OpenClaw/Hermes/DSH remain unverified by this checkpoint.
The supplied package hash is unchanged. Cleanup found a clean main, one
worktree and no orphan candidates. Down succeeded; both recorded PIDs are
absent, health refuses connections, and no process remains with a fixture
cwd. Evidence extraction asserts these checks from native results and
runtime events; see `docs/validation/2026-09-08-m1-hosts.json`.

T12's historical 8/9 package score is unchanged. No pushes occurred.

## Earlier M1.1 repair and policy checkpoints

Full suite for the requested repair commit: 2026-09-08, Node 24.11.0, `npm test` outside the
socket-restricted sandbox: **153 passed, 0 failed, 0 skipped**, 49.324 s
(fresh run before the requested local commit). `git diff --check` passed.
No build or lint command is configured. Skill frontmatter and size checks
are part of that suite.

The first integrated run found three failures (149/152 passed): two old
snapshot fixtures used the ambient data directory, and cleanup could report
failure during a process's exit. Fixtures now use their fake's directory;
a deterministic regression reproduced transient cwd loss during SIGTERM
before the reporting fix. Focused checks passed, then the full suite above.

Independent spec/quality reviews approved state serialization, monitoring,
command safety, cleanup, and reports after fixes. Documentation retrieval
checks cover lock migration, offline dry runs, unsaved checkpoints and
typed cards. Real T12 archive reanalysis confirms the approval at
03:10:22.421Z and the retained ListAgents residual, without HTTP, Git, test
execution, state writes, or bot turns. See `docs/evidence.md` for scope.

Not newly verified during M1.1: the six remaining T12 repository/test checks
and the formal doctor/status/send sequence on all three hosts. Original T12 is 8/9.
No project Git status, commit, or push was run during that repair under its
then-active session hook.

Policy correction (`oml-2d5`, Decision 0005): verified `bd prime --full` and
`bd prime --hook-json` both permit local Git and require explicit user
permission for every push. AGENTS.md and CLAUDE.md agree. Effective settings:
`no-git-ops=false`, `no-push=true`, `backup.git-push=false`; Steward retains
`commit_policy="auto"` and disables automatic pushes. No driver code changed;
the 153-test result above was the full-suite verification for that checkpoint.

Package scope correction (`oml-qh7`, Decision 0006): inspected import's
supplied-path parsing, roster mapping and lead selection, and report's
explicit `check-042` flag branch. No dev-team package path or fixed bot keys
occur in the driver. Ran `node --test tests/team.test.mjs tests/report.test.mjs
tests/report-evidence.test.mjs` outside the socket-restricted sandbox:
**50 passed, 0 failed, 0 skipped**, 7.119 s. `git diff --check` passed.
Only documentation and task scope changed; no new bot runs or package edits.
