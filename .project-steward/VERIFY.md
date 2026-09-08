# Verification

Run the relevant checks before marking work as verified in `HANDOFF.md`.

| Check | Command | Expected |
| --- | --- | --- |
| Build | `none` | exits 0 |
| Tests | `npm test` | all pass |
| Lint | `none` | clean |

## M1 review checkpoint (2026-09-08)

Independent review and test of M1 at HEAD `b1a1f77` (Beads epic `oml-nqo`,
plan `~/.claude/plans/based-on-the-development-lucky-shell.md`). This section
records Tier 0 and Tier 1 only; Tiers 2 and 3 (real OpenMausBot) are still
open as `oml-nqo.23` and `oml-nqo.24`. No source, test or documentation file
was changed by either tier.

### Tier 0 — suite and static checks

Node v24.11.0, worktree clean. `npm test`: **154 passed, 0 failed, 0 skipped**,
`duration_ms 50994.86` (51.2 s wall). `node --test tests/snapshot.test.mjs`:
**5/5**, 3.444 s. `git diff --check`: clean.

Static checks, all as expected: the four usage probes (`omb`, `omb bogus`,
`omb doctor --bogus`, `omb state --show`) each exit 2; the verb list holds
**15** names with no `state` verb, confirming finding 1. The supplied
dev-team package hashes to `48e4ac63…3255949`, unchanged. Both `sha256sum -c`
manifests from `docs/validation/2026-09-08-m1-hosts.json` verify: 2/2 source
files and 6/6 host transcripts under `/tmp/oml-m1-hostcheck-VslL6s/logs` are
byte-identical to their recorded digests. `grep -c '"watch"'` on that file is
**0**, confirming finding 2 (no `watch` invocation was ever evidenced).

Leaked temporary directories (finding 15): **2,864** `/tmp/oml-*` directories
existed before the run — exactly the count the review recorded — and **3,010**
after, so this suite run leaked **146** more. Nothing under `/tmp` that this
session did not create was deleted.

### Tier 1 — scripted end-to-end against the fake server

21 scripted steps, **211 assertions, 209 ok, 2 deviations**, across 78 driver
invocations, with `OMB_BIN` pointing at `tests/fixtures/fake-omb.mjs`,
`OMB_TOKEN` empty and every ambient `OMB_*` variable unset. Fake-server runs
are not evidence, so this stays here and not in `docs/evidence.md`.

Verified end to end: `doctor` (5 checks) and `doctor --server` (10 checks,
engines available, no provider keys in the server's environment, identity ok);
`up` in dry-run, `--fresh`, attach-again and refuse-while-owned forms, with the
health pid proven to be the supervisor's child through `/proc` and
`ANTHROPIC_API_KEY` and `OMB_TOKEN` proven absent from the server's environment;
`import`, `import --dry-run`, `import --adopt` into a second project
(`owned:false`); `bind` (Quill skipped for auto because a grok bot has no auto
approval level, exclude entries added exactly once, a repeat changes nothing);
`facts`; `task` dispatch, refusal while open, and `--resume --dry-run`;
`status` in plain, `--brief` and `--tail` forms; `watch` in its timeout,
`--quiet-if-unchanged`, `--dry-run`, stalled, `--nudge`, needs-user,
polling-only and done paths; `send` dedupe, queueing while busy, the 409
stale-thread refusal that retargets nothing, and the legacy-`.omb/lock`
refusal; `answer` for approval, question, dead and connector requests;
`interrupt` including busy-elsewhere; `reconcile` including `--remove` and its
dry run; `cleanup` including a real `--kill` (SIGTERM) of a genuine orphan;
`report` in `--dry-run`, `--md`, no-open-run and `--run last` forms; and
`down`, restart, and the post-`newEnvironment` refusal. Every `--dry-run`
left the state file's md5 unchanged.

Deviations from the plan's expectations, both reproduced in two independent
runs:

1. `watch --nudge` exits **6** (stalled), not the 4 the plan predicted. This is
   a plan error, not a defect: `lib/watch.mjs:165-172` forces `running` only for
   the iteration that nudges, the loop re-evaluates, the lead is still silent,
   and `:176` breaks on the terminal `stalled` state, whose exit code is 6
   (`lib/snapshot.mjs:261`). The repository's own test (`tests/watch.test.mjs:118-119`)
   asserts only `nudged` and the single `status?` message, never an exit code.
   The substance passed: one nudge, exactly one `status?`, never a second.
2. `status` never emits a `carried` field. The carried verdict itself works —
   `state` is `done` and `reasons[0]` is "from the last watch: done" — but
   `lib/verbs/run.mjs:39` computes `carried: true` and `:42` drops it when
   assembling the result (`lib/verbs/report.mjs:46` does the same). Filed as
   `oml-nqo.25`, severity low.

Findings confirmed by direct observation: 8 (an identical resend returns the
same `messageId` with no `duplicate` flag), 12 (`down` refuses with "the
environment id changed" and names no pid; recovery was a manual kill), and 19
(`cleanup` on the default pattern correctly ignores pid 426150, whose cwd is the
repository root rather than `.worktrees/`).

Fixture cleanup: no `fake-omb` process remained on the port and no process had a
cwd under the fixture root, for both the first and the corrected run; both
fixture directories were removed after their logs were copied out. Raw logs,
`run.sh`, `results.md` and `results.json` live in the session scratchpad.

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
