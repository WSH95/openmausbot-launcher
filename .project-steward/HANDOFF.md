---
updated_at: 2026-09-17T20:58:34Z
updated_by: claude
session_status: closed
branch: main
---
# Handoff

## Now

Every non-macOS bead is closed: `oml-fg8`, `oml-j4r`, `oml-2rc`, and three
found on the way, `oml-jc1`, `oml-47p` and `oml-507`. `main` went from
`2234084` to `0278dfd` (eight commits) and then to `c769e53` (three follow-up
commits); the merged tree passed 466/466 tests in 80.1 s. Only `oml-hou`
(macOS) is open. The repairs were then confirmed on real OpenMausBot 0.1.56
with two overlapping probe runs, V16 and V17 (2 bot turns, both Sudo's; server
stopped, clone unchanged at `ddd4684`): after a sibling opened or closed,
`report` left the run open with the settlement hint, an 8 s and a 20 s watch
returned the observed idle time with the budget hint, a 40 s and a 35 s watch
settled `done`, and the second report closed each run.
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

1. Leave `oml-hou` open until macOS work is requested and a Mac or an explicit
   implementation decision is available. `bd ready` shows nothing else.
2. Nothing else is queued. The `oml-j4r` report attribution repairs have not
   been seen on a real run that merges work and writes a record; the next
   ordinary dev-team task run will exercise them, and its `report --md
   --check-042` section belongs in `docs/evidence.md` as usual. Do not spend
   bot turns for that alone.

## Blockers

None for the launcher. The macOS lifecycle task needs a Mac or a user
decision.

## Key files

- `docs/evidence.md`, last section, and
  `docs/validation/2026-09-17-watch-budget-v16-v17.json`: the real-server
  confirmation (V16/V17), with every command, id and output.
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
- Repairing the quiet- or poll-bound wake that lands a few milliseconds before
  the deadline (`oml-47p`, first half). Restoring the last verified
  observation after a cut-short read can hide facts that read saw. Extending
  the wait when the budget left is smaller than the last read took treats an
  estimate as a bound and can suppress required reads with seconds left. Both
  were blocked in plan review; the unverified timeout it produces is accurate
  and is documented in `references/limits-and-pitfalls.md`.
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
