---
updated_at: 2026-09-17T19:35:39Z
updated_by: claude
session_status: closed
branch: main
---
# Handoff

## Now

The three non-macOS beads are closed, plus one found on the way: `oml-fg8`,
`oml-j4r`, `oml-2rc`, `oml-jc1`. `main` fast-forwarded from `2234084` to
`0278dfd` (eight commits); the merged tree passed 464/464 tests in 81.5 s.
Nothing was pushed, no OpenMausBot server was started and no bot turn was
spent. Every check ran against `tests/fixtures/fake-omb.mjs`.

What changed for an operator: a `watch` that times out while the run is idle
now reports the idle time it observed instead of `idle for 0 s`, and, only
where the quiet window alone would settle the run, names the budget it needs
in JSON and in `--brief`. `report` on such a run says to watch with
`--max-seconds 35` or more and report again. Reaching the deadline in the
idle wait ends the observation on the last verified view, so a timed-out watch
can now return `checkpointed: true` where it used to return an unverified
line. The report attributes the task-log entry and the merged commit by rule
and returns `null` when it cannot tell; T15's closing text from the
2026-09-17 run stays `unknown` on purpose.

## In flight

Nothing. `main` is the only worktree and the working tree is clean after this
handoff's commit. The feature worktree and its two merged branches were
removed.

## Next steps

1. `oml-47p` (P3): read its description with `bd show oml-47p`. Decide the
   rule for a quiet-bound wait that ends a few milliseconds before the
   deadline (`skills/openmausbot-launcher/scripts/lib/watch.mjs`, the idle
   wait near the end of `watchRun`); `tests/watch-deadline.test.mjs` pins that
   wake as a re-read today, so write the new expectation first. Do not use a
   time threshold. The `streamReady` early-rejection boundary is the second
   half of the same bead.
2. `oml-507` (P3): in `tests/repo.test.mjs:173`, replace the dependence on
   `killOrphan`'s `graceMs: 100` with a condition (have the child report that
   its SIGTERM handler ran) or a generous bound; keep the production default.
   It failed once in 16 concurrent full suites and never in a normal run.
3. Leave `oml-hou` open until macOS work is requested and a Mac or an explicit
   implementation decision is available.
4. The next real parallel run should confirm the new output on OpenMausBot
   0.1.56: after closing the first run, `report --run <b>` should carry the
   settlement hint, one `watch --run <b> --max-seconds 35` or longer should
   settle it, and a second report should close it. Record it in
   `docs/evidence.md`; the fake-server checks are not evidence.

## Blockers

None for the launcher. The macOS lifecycle task needs a Mac or a user
decision.

## Key files

- `docs/review/2026-09-17-watch-budget-report-attribution.md`: the pipeline,
  what each bead turned out to be, the decisions the reviews changed, and what
  was left open.
- `.project-steward/VERIFY.md`, first section: every full-suite run, the
  stress counts, the mutation results and the fake-server dry run.
- `skills/openmausbot-launcher/scripts/lib/watch.mjs`: `watchBudgetHint`, the
  timeout rewrite, and the deadline boundary at the end of the loop.
- `skills/openmausbot-launcher/scripts/lib/snapshot.mjs`: `awaitingQuiet` and
  `quietSettles` in `evaluate`.
- `skills/openmausbot-launcher/scripts/lib/report.mjs`: `taskLogEntry`,
  `mergedShaFrom`, `recordCommitSha`, `namesRival`.
- `tests/watch-deadline.test.mjs` and `heldWatchTimers` in `tests/helpers.mjs`:
  the held virtual clock for the deadline tests.
- `docs/design.md`: the task lifecycle paragraph that replaced the "Known
  gap", the settlement block, and the `watch` loop's deadline rules.

## Tried and rejected

- Keeping `state` and `lastReported` on a timeout checkpoint so a short watch
  cannot erase a verdict: it can preserve a verdict the watch itself saw
  invalidated, and it makes every short watch read as a change, which breaks
  `--quiet-if-unchanged` and `--until change`.
- Persisting quiet across `watch` invocations: `docs/design.md` forbids it,
  and the real defect was the output, not the algorithm.
- Accepting a bare `` `main` at `<sha>` `` as a merge assertion: it says where
  a branch is, and ancestry cannot tell a right sha from a wrong one.
- Letting the time window select a task-log entry: parallel runs overlap, so
  the window only excludes.
- Fixing `oml-jc1` with a minimum-budget threshold before a read: a condition
  (the wait was the deadline's, nothing arrived, inputs unchanged) replaced
  it.
- The Codex companion for max-effort work: it rejects `--effort max`, and its
  forwarder refuses under plan mode. Use `codex exec -m <model> -c
  model_reasoning_effort="max"` with `--sandbox read-only` for reviews, or
  `-c default_permissions="omb-loopback-dev"` for a rescue that must run the
  suite. Such a rescue cannot commit from a worktree.

## Warnings

Never run `watch` below `--max-seconds 35` with the default quiet window; the
driver now says so, but a shorter watch still cannot settle a run.
`heldWatchTimers` finds the watch's timers by the callback names `wokeUp`,
`reachDeadline` and `done` in `watch.mjs`; renaming them makes the deadline
tests fail with "the watch never installed a … timer". Treat every token shown
in a screenshot or UI capture as compromised. The default Codex
`workspace-write` sandbox cannot run the loopback-dependent tests; select
`omb-loopback-dev` for repository testing. Every push still requires explicit
user permission.
