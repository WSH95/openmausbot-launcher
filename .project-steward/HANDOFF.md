---
updated_at: 2026-09-16
updated_by: codex
session_status: closed
branch: main
---
# Handoff

## Now

Phase 5's watch-contract rescue is repaired on `main` after `0492520` and
`9b9fbe8`. The final audit is
`docs/review/2026-09-16-watch-drain-followups.md`; it supersedes the first
rescue audit's claim that every path was closed. A snapshot can authorize a
verdict or effect only after its relevant generation, attribution scope and
live run inputs are confirmed. Exhausting three attempts returns visible
running/unknown. Follow-up repairs preserve card owners through closure,
thread/membership changes and historical reads, retain durable outcomes and
progress, bound stream parsing, and check freshness after the final await.
No new real bot run or push was performed. Real two-run validation remains
Phase 7; the Beads task was not closed by this checkpoint.

## In flight

An independent writer added `tests/watch-membership.test.mjs`,
`tests/watch-local-progress.test.mjs` and `tests/watch-deadline.test.mjs`
during this invocation. Their corresponding production changes were
reviewed and preserved. These three files contain four regressions; they
are included in the observed 340-test workspace suite but are left
unstaged because this invocation did not edit them. The explicit-path
repair commit contains the other 336 tests. Check `git status` before
integrating any further work; another process has been editing this checkout.
Verification commands and their final results are in `VERIFY.md`.

After those passing runs and the repair commit, the independent writer
also added `tests/send-ownership.test.mjs` and edited
`tests/delegation-drops.test.mjs` and `tests/watch-followups.test.mjs`.
Those later changes are outside the recorded 340-test verification and
are left unstaged. The repair commit's source and tests remain the
checkpoint to review; do not mistake a changing workspace for that tree.

## Next steps

1. Review the final audit and `git status`. Let the independent writer
   finish its remaining test edits and specialist-send ownership work;
   preserve those files and verify that work separately.
2. Continue the v2 plan from `PLAN.md`. Phase 7 still owes a real two-run
   OpenMausBot 0.1.56 exercise; this repair spent no bot turns and does not
   claim that evidence. Record any authorized real run in `docs/evidence.md`.
3. Reconcile the existing task `oml-no8` only in a session where Beads access
   is authorized. This task's user explicitly prohibited `bd`, `.beads/`
   changes and pushes; no automatic task-backend update belongs here.

## Blockers

There is no observed remaining implementation failure in the repair tests.
Concurrent edits prevented claiming ownership of the three separate test
files. The two-second quiet-output integration test exhausted its REST
budget in one full run; the failure and unchanged rerun are recorded in
`VERIFY.md`. Load sensitivity is an inference, not a proved cause.

## Key files

- `docs/design.md`: evaluation, attribution, drain and deadline rules.
- `docs/review/2026-09-16-watch-drain-followups.md`: base/final path matrix,
  regression evidence and limitations; the first audit maps the earlier
  fifteen findings and third-round checks.
- `skills/openmausbot-launcher/scripts/lib/watch.mjs`: observer lifetime,
  generation guard, live local inputs and bounded drain.
- `skills/openmausbot-launcher/scripts/lib/snapshot.mjs`: run attribution,
  retained card provenance and chronological delegation-drop matching.
- `tests/watch-drain.test.mjs`, `tests/watch-followups.test.mjs`,
  `tests/card-lifecycle.test.mjs`, `tests/delegation-drops.test.mjs`: focused
  regressions, an actual driver/fake-server card lifecycle, and an exhaustive
  7,776-history matching oracle.

## Tried and rejected

A fixed redraw count followed by a verdict still returned stale evidence.
Checking only inside an async checkpoint missed the final promise boundary.
An unconditional parser-deadline invalidation made unchanged quiet watches
print uncertainty with no unread evidence; bounded empty/heartbeat tails
now remain benign. A scalar anonymous-drop debt consumed later queue
batches; chronological matching retains every possible outstanding owner.

## Warnings

Keep all original assertions and both two-run HTTP-fake watches. Missing
runtime logs cannot prove that another lead thread is idle. Ambiguous
histories beyond 512 queue/removal nodes retain unknown/open work; do not
turn that fallback into completion. An HTTP mutation already sent cannot
be recalled when later evidence changes. Use only Node built-ins; never
modify OpenMausBot. Do not push without explicit permission. Do not run
Beads or stage `.beads/` for this rescue.

## Historical M1 handoff (2026-09-08)

The following archived state belongs to the earlier M1 session. Its runtime
and Git observations are not fresh observations from this repair.

## Now

The M1 fix pass is finished and committed on `main`; no push was made and
none is authorised without the user's explicit permission. Epic `oml-nqo`
(the 2026-09-08 M1 review) is closed with all 26 findings resolved: code
findings 1, 6–17 and 21–26 by one test-first commit each, findings 2, 4 and
5 on the review's tier 2/3 evidence, finding 3 on tier 3 plus the T13 run,
18 by the documentation pass, 19 by killing pid 426150 at the user's
decision, 20 by the full-team run T13. `npm test`: 197 passed, 0 failed, 0
skipped (198 tests). One load-dependent flake found during the pass was
filed as `oml-oqo` and then fixed on the user's instruction (`02e7945`):
`watch` could exit 1 "observation deadline reached" instead of exit 4
because the budget guard and the observation loop disagreed about a
sub-millisecond remainder. Nothing is in flight; no OpenMausBot server is
running.

Next work comes from `bd ready`: the v2 beads (OpenClaw, Hermes and DSH
verification; `pair`; macOS lifecycle; unsupported request types; parallel
runs; long SSE inside Codex's sandbox). The devpack's own follow-up, retiring
its four scripts (`atw-07l.27`), is now unblocked but belongs to that
repository.

## What was validated

T13 (`max_words`, bead `slg-8ia`) on the slugkit clone through the fixed
driver, real OpenMausBot 0.1.56, the user's roster (Sudo
`codex/gpt-5.6-luna/high`, Sage `claude/claude-sonnet-5/high`, Vale
`codex/gpt-5.6-terra/high`, Nova `claude/claude-opus-5/high`, Quill
`grok/grok-4.6/medium`, Quill on ask): run `6b0b7b17800c3d64`, incomplete,
9 turns (Sudo 5, Sage 1, Vale 1, Nova 1, Quill 2 1), 16 min 38 s dispatch to
DONE, 7 Grok approval cards allowed once (never "Always allow"),
`--check-042` 8/9 with the native-log checks scored from the Codex lead's
JSON-RPC log, merge `--ff-only` at `0918e0e`, record commit `d85cae5`,
`cleanup --kill` found no orphan, `down` verified. Record: `docs/evidence.md`
"M1 fix pass, full-team validation" and
`docs/validation/2026-09-08-fix-pass-t13.json`; devpack pointer in
`~/Documents/agent-team-devpack/EVIDENCE.md` (commit `ab94d6d` there).

Fixes validated for real by that run, not only against the fake: `up`
reporting `ports: [8899, 8900]`; the roster line for a grok bot reading
`(ask)` rather than `(undefined)`, with the `approval ask` PATCH that
materialises the field; `facts` reporting `provenance {test: flag, setup:
flag}`; `reconcile` reporting `defaultBranchSource: facts`; the Codex
native-log parser; `send` reporting `duplicate: false` for the operator's one
message. See `VERIFY.md`, "M1 fix pass", for the per-finding commit list.

One check stayed unknown: `worktree-after-approval`. The parser found the
reviewer's reply in the Codex log, attributed it by `ask_bot.bot_id` and
dated it before `git worktree add`; `approvalVerdict` then declined the
verdict because the reply puts `approve` mid-text and ends on a findings
line. That is a pack-side verdict-format observation, not a launcher defect,
and the run therefore closed `incomplete` — unknown evidence never
authorises a pass.

## Repository and runtime

Work is on `main`; local Git operations and tested Conventional Commits are
authorised, every push needs the user's explicit permission (Decision 0005).
`AGENTS.md` was changed with the user's approval of the fix plan (Decision
0008); `CLAUDE.md` was not.

No server is running: T13's server (supervisor 1161247, health 1161254, port
8899, webhook 8900, data dir
`~/.cache/agent-team/omb-launcher-data-20260908T142522-X8fDYx`) was stopped
with `down`; both pids are absent and both ports refuse. The T13 data dir is
kept as the run's archive, as is
`~/.cache/agent-team/omb-launcher-data-20260907-2300` (T12) and
`/tmp/oml-m1-hostcheck-VslL6s` (the M1 host evidence). The slugkit clone is
at `d85cae5` on `main`, clean, one worktree, 85 tests OK. Pid 426150 no
longer exists; `pgrep -af codex-linux-sandbox` finds nothing. Its inert
scratch directory `/tmp/m1-lock-validation-HHYuW2` was left for the user, as
were the roughly 7,400 pre-existing `/tmp/oml-*` directories that leaked
before finding 15 was fixed.

The external test input
`~/Documents/agent-team-devpack/packages/dev-team/dev-team.openmaus.json`
hashes `48e4ac63…3255949`, unchanged. The only devpack write was
`EVIDENCE.md` (and its beads export), committed there locally, not pushed.

## Key evidence

- `docs/review/2026-09-08-m1-review.md`: the review and its "Resolution"
  table (finding → bead → commit).
- `docs/evidence.md`: Corrections in the spike, T12 and host-check sections;
  the housekeeping note; the T13 section with its `report --md --check-042`
  block.
- `docs/validation/2026-09-08-fix-pass-t13.json`.
- `.project-steward/VERIFY.md`, "M1 fix pass (2026-09-08)".
- `bd show oml-nqo`: closed, 30 children closed.

## Preserved constraints

Bot turns and native host CLI sessions cost the user's subscriptions: count
both, keep runs bounded. Never answer "Always allow". Always `watch` before
`answer`; never answer a human decision for the user.

A lead's prose is not evidence that a tool ran; read
`<dataDir>/native/<thread>.ndjson`. A Codex bot under `ask` raises one MCP
card per tool before any peer gate — T13's Grok reviewer raised seven in
three minutes. Peer decisions do not appear in `/api/decisions`. A Grok bot
has no auto approval level.

`up --port N` also occupies N+1 and now says so. `import --adopt` now writes
the exclude entries. Inside Codex `workspace-write`, `up` and `status` exit 1
naming the sandbox or the URL. `dev-team.openmaus.json` is an external test
input, never a launcher requirement; T12 keeps its original incomplete report
and 8/9 package score.

For a legacy `.omb/lock` refusal, stop every launcher command and automation,
update every installed copy, then remove only that legacy path. Never unlink
or rotate `lock.sqlite`. `checkpointed:false` means an observation was not
saved. Unknown evidence never authorises done or a passing report; dry-run
reports execute no tests.
