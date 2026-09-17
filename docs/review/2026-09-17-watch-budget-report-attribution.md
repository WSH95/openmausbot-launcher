# Watch budget, report attribution and timing repairs: review record

Base: `2234084`. Work branch: `fix/oml-fg8-j4r-2rc`, eight commits,
fast-forwarded into `main` at `0278dfd` on 2026-09-17. Beads closed:
`oml-fg8`, `oml-j4r`, `oml-2rc`, `oml-jc1`. Beads filed: `oml-507`, `oml-47p`.
No real OpenMausBot run was started and no bot turn was spent; every check
ran against `tests/fixtures/fake-omb.mjs`.

## Pipeline

| Step | Who | Result |
| --- | --- | --- |
| Plan | Claude Fable 5.1 | three explorations, then the plan |
| Plan review 1 | Codex gpt-6-astra, max, read-only sandbox | 10 findings, 2 blockers; "revise before implementation" |
| Plan review 2 | same | 5 of 10 resolved outright, 8 new findings, 2 blockers |
| Implementation 1 | Opus 5 subagent in a worktree | packages A, B, C; 404 to 418 tests |
| Addendum D review | gpt-6-astra, max | 6 findings on the `oml-jc1` rule, no blocker |
| Code review 1 | Codex gpt-5.6-sol, max, read-only sandbox | 11 findings, 4 blockers |
| Implementation 2 | same Opus subagent | review fixes and package D; 437 tests |
| Code review 2 | gpt-5.6-sol, max | 10 of 11 fixed, 7 new findings, 2 blockers |
| Rescue (two-rounds rule) | gpt-6-astra, max, `omb-loopback-dev` profile, no commits | 8 rulings completed; 463 tests |
| Completeness review | fresh Opus 5 subagent, read-only | one blocking gap (merge denial forms) |
| Last fix and merge | Claude Fable 5.1 | 464 tests on `main` |

The Codex companion rejects `--effort max` and its forwarder refuses under
plan mode, so every Codex step ran as `codex exec -m <model> -c
model_reasoning_effort="max"`, with `--sandbox read-only` for reviews and
`-c default_permissions="omb-loopback-dev"` for the rescue. A Codex run in a
worktree under that profile cannot commit, because the worktree's git
directory lies outside the workspace; the orchestrator committed after the
completeness review.

## What the beads turned out to be

`oml-fg8` was not an attribution lockout. T15 settled as `attention` four
times under 45 to 55 s watches. `report --run t14` closed T14 at 06:00:20Z,
which unmasks the bots T14 had claimed and changes T15's evidence once, so
the stored verdict was correctly refused and `report --run t15` one second
later read `running`. Every later `watch --run t15` used `--max-seconds` 8,
8, 12 and 20 against the 30 s quiet window (session transcript), so each
evaluated once, slept to its deadline and returned that first evaluation:
`idle for 0 s`. A 35 s watch settles. The defects were the misleading
timeout output and the missing guidance.

`oml-2rc` listed four tests; two were already repaired (`e21a6b0`,
`b8aa65d`). The lifecycle flake's cause was not the 10 s startup bound but
`up`'s first health probe spending the client's whole 15 s timeout on a
silent TCP blocker.

## Decisions that reviews changed

- Keeping `state` and `lastReported` on a timeout checkpoint was cut: it can
  preserve a verdict the watch itself saw invalidated, and it makes every
  short watch read as a change. Quiet is still never persisted.
- The budget and settlement hints require `quietSettles`, the ladder's answer
  at the time the quiet window would complete, because an idle run can need
  new lead activity that no budget delivers.
- A task-log entry belongs to the run it names first among the runs its dated
  heading admits. The window only excludes. A re-dispatched twin needs a
  distinguishing identifier. Unresolved attribution is `null`, which also
  decides `task-log-changed`.
- A bare `` `main` at `<sha>` `` (T15's closing text) is not a merge assertion;
  T15 stays `unknown` from its closing. The explicit `merged … into <branch>
  at <sha>` form (T13's closing) is accepted.
- In closing text and record subjects a rival named only through a shared
  identifier is ignored only when the evidence time lies outside its window,
  or when the text carries an identifier exclusive to the target and none
  exclusive to the rival. Unknown time permits no such exclusion.
- A merge that is denied, still to come, impossible or undone is not a merge;
  the denial is read in the predicate governing `merged`. In a record subject
  only a denial directly before `merged` counts, because the task text is a
  free title.
- Reaching the deadline in the idle wait is an observation boundary (either
  timer, no invalidation of any kind, unchanged local inputs), with the wake
  reason local to each wait. A timed-out watch can therefore report
  `checkpointed: true` where it used to report an unverified line, and a fast
  final read that would have found a change is skipped until the next call.

## Left open

- `oml-47p`: a quiet-bound wait that ends a few milliseconds before the
  deadline still starts a read that cannot verify, and `streamReady`'s early
  rejection can rethrow while the budget is not yet spent.
- `oml-507`: `tests/repo.test.mjs:173` guesses a 100 ms grace; it failed once
  in 16 concurrent full suites.
- The closing-text denial rule matches `not` inside a hyphenated word
  (`T14 was not-blocked and merged as …`); the result is a conservative
  `null`.
- `tests/helpers.mjs` `heldWatchTimers` finds the watch's timers by the
  callback names `wokeUp`, `reachDeadline` and `done`; a rename makes the
  affected tests fail with "the watch never installed a … timer".
