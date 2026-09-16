---
updated_at: 2026-09-16T22:50:08Z
updated_by: cli
session_status: closed
branch: codex/rescue-watch-drain
---
# Handoff

## Now

The multi-run watch rescue is implemented and verified on the isolated branch
`codex/rescue-watch-drain`, based on `3111bbc`. The worktree is
`/home/wsh/Documents/openmausbot-launcher/.superpowers/tmp/codex-rescue-worktree`.
The required full suite passed 303 tests, with 0 failures and 0 skipped, on
Node v24.11.0. The baseline passed 269. The design and detailed path/review
matrix are in `docs/review/2026-09-16-watch-drain-rescue.md`.

Watch now requires a confirmed relevant generation, attribution scope and
current run ownership before a verdict, change result, nudge or checkpoint.
Three unsuccessful reads or attempts to act return visible running/unknown
without saving unconfirmed evidence. The stream stays open across checkpoint
lock waits; nudge delivery checks freshness and one deadline at every step.
Card ownership/locations, per-run dispatch boundaries, timestamp ordering,
and ambiguous runtime/delegation evidence have regressions.

## In flight

The primary checkout changed independently during this session, including
watch, snapshot, delivery and test files. Those edits were preserved. This
branch has not been merged into that checkout. All changes in this worktree
belong to the verified rescue checkpoint: three driver modules, the new
`tests/watch-drain.test.mjs`, design/review documentation, and stewardship
records. Existing test files and assertions are unchanged in this branch.
Parent issue `oml-no8` remains in progress for integration and broader
validation. No real bot runs or pushes were performed.

## Next steps

1. Read the path matrix and verification record in
   `docs/review/2026-09-16-watch-drain-rescue.md`.
2. Inspect `git status --short` in the primary checkout and compare its
   independently written changes with `codex/rescue-watch-drain`. Finish or
   preserve that writer's work before merging; do not overwrite its files.
3. After reconciling the branches, run
   `mkdir -p .superpowers/tmp && TMPDIR=$PWD/.superpowers/tmp npm test` and
   `git diff --check`. Keep the parent issue's integration/real-validation
   status accurate. A real two-run OpenMausBot exercise was not part of this
   fake-server rescue pass.

## Blockers

Integration into the shared checkout is separate because it had an active
independent writer. No implementation or test failure remains in this branch.

## Key files

- `docs/review/2026-09-16-watch-drain-rescue.md`: base/final line references,
  all earlier findings mapped to retained tests, observed results and limits.
- `docs/design.md`: arrival classification, confirmation, bounded uncertainty,
  side-effect guards and card/runtime evidence rules.
- `tests/watch-drain.test.mjs`: 34 race/attribution regressions; the first 33
  failed against the unchanged baseline, and the last caught a draft
  classifier error before repair.
- `skills/openmausbot-launcher/scripts/lib/watch.mjs`: the confirmation loop,
  scope classification, bounded response and checkpoint lifetime.
- `skills/openmausbot-launcher/scripts/lib/snapshot.mjs`: per-run evidence,
  card locations, dispatch windows and conservative attribution.
- `skills/openmausbot-launcher/scripts/lib/verbs/run.mjs`: guarded delivery,
  state ownership reads and checkpoint writes under the lock.
- `.project-steward/VERIFY.md`: current test results and earlier evidence.
- Primary checkout `.superpowers/tmp/rescue-*.log`: baseline, red and green
  output, including `rescue-isolated-suite-303.log` (303/303).

## Tried and rejected

A fixed redraw count followed by a normal verdict leaves stale decisions
reachable. The new bound returns uncertainty instead. The first full run
also exposed batching that spent the last two seconds before a checkpoint;
coalescing now leaves half the remaining budget for a read. Final review
caught repeated `hidden: false` foreign frames being treated as ownership
changes; a failing regression preceded that correction.

## Warnings

No push is authorized. Local commits and merges are allowed. The Git hooks
invoke Beads; the rescue commit excludes every `.beads/` path. Required session
workflow checks and one task note used Beads despite the rescue brief's
prohibition; this deviation is recorded in the review.

Fake-server and scripted-race checks are not real OpenMausBot evidence.
`docs/evidence.md`, OpenMausBot source and external team packages were not
changed. Requests already sent to the server cannot be recalled by a later
invalidation; the guard protects each decision at its observed boundary.
