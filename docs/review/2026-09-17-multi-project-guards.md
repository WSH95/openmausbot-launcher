# Several projects on one machine: review record

Base: `8fc6828`. Work branch: `fix/multi-project-guards`, ten commits,
fast-forwarded into `main` at `73c623c` on 2026-09-17. Beads closed:
`oml-jpu` (`bind`), `oml-1gd` (`up`), `oml-6kr` (`down`). Bead filed:
`oml-0vr`. No real OpenMausBot run was started and no bot turn was spent;
every check ran against `tests/fixtures/fake-omb.mjs`. The specification is
Addendum F of the session's plan file; the pipeline was the one used for the
watch and report repairs the same day.

## The question

The user asked whether several projects can use the skill at once with the
same team package. The package file is only read, and each project has its
own `.omb/state.json` and lock, so the file was never the problem. A shared
server was: a package import is additive, so independently imported teams
coexist on one server, but `bind`, `up` and `down` consulted only their own
state. Three unguarded paths were found and are now guarded.

## Pipeline

| Step | Who | Result |
| --- | --- | --- |
| Plan review 1 | Codex gpt-6-astra, max, read-only sandbox | 16 findings, 1 blocker: upstream already holds an exclusive data-directory lease, so the `/proc` environment scan was dropped |
| Plan review 2 | same | 9 findings, 1 blocker: a version-1 state's open work would have been ignored; per-attempt log files; the CLI error path and `cleanup --down` |
| Implementation 1 | Opus 5 subagent in a worktree | F1, F2, F3; 481 tests |
| Code review 1 | Codex gpt-5.6-sol, max, read-only sandbox | 11 findings, 2 blockers (a discarded foreign delegation; an unbounded read) |
| Implementation 2 | same Opus subagent | all 11; 493 tests |
| Code review 2 | gpt-5.6-sol, max | 7 of 11 fixed, 4 partly, 7 new findings, 1 blocker (a malformed sibling array erasing an observed delegation) |
| Rescue (two-rounds rule) | gpt-6-astra, max, `omb-loopback-dev` profile, no commits | 10 rulings completed; 515 tests |
| Completeness review | fresh Opus 5 subagent, read-only | COMPLETE, 0 blocking gaps, 9 observations |
| Hardening and merge | Claude Fable 5.1 | `O_NONBLOCK` on the foreign state open, a run-less version-1 task is unknown, a guarded log close; 516 tests on `main` |

## Decisions the reviews changed

- The first draft detected a data directory in use by scanning process
  environments for `OMB_DATA_DIR`. Upstream already refuses a second server
  with "OpenMausBot is already using this data directory (process N)"
  (`electron/data-dir-lease.mjs:323-331`), so `up` only translates that
  refusal, from a log file that belongs to the one attempt.
- A configured folder is evidence of configuration, not of ownership or
  activity; a folder that is missing is still a configured outside folder.
  `bind` refuses over the exact set it would change and `facts` over the lead
  alone; `--take-over` moves the default folder for new tasks and nothing else.
- `down` protects other work it observed, and says what it could not read.
  Each evidence source is independent; a malformed sibling never erases a
  positive; absent response arrays are unreadable, not empty; the inspection
  budget is monotonic and checked inside every loop; the final identity check
  has no `await` before the signal.
- The ancestor walk for foreign state files was cut: the launcher only ever
  configures a project root, and the walk could have rediscovered this
  project's own state.
- Docs state the limits: shared writable states of one team need one
  authoritative state; a custom `--state` location, a foreign card without
  waiting activity and a stalled synchronous filesystem call are outside the
  guards; tokens are one user-wide table keyed by origin; two hosts holding
  copies of one state share no lock; the upstream lease decides by hostname
  and pid liveness.

## Left open

- `oml-0vr`: `tests/watch-drain.test.mjs:417` failed once in about fourteen
  loaded full runs during the rescue; not reproduced since.
- A relative bot `cwd` would resolve against the driver's working directory;
  upstream validates `cwd` as absolute, so it is not reachable.
- `up` reports `otherConfiguredFoldersKnown: false` when only `groups` is
  unreadable although only `bots` feeds the folder list; conservative.
- The fake retires a dead lease claim by unlinking it, where upstream elects a
  successor at a token-derived path; the visible contract (refusal texts,
  crash recoverability, one winner) matches and the fixture says so.
