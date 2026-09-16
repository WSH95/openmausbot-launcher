# Multi-run watch follow-up: final rescue audit

Scope: the inherited dirty follow-up to `0492520`, plus reviewer gaps G1–G5.
This audit replaces the inherited follow-up audit. It distinguishes newly
reproduced failures from tests of behavior already present at `0492520`.
“Closed” below is a code-review inference supported by the named failing
regression and subsequent passing runs; it is not a claim of an atomic
transaction with OpenMausBot.

The checkout began at `9b9fbe8` with the 15 files listed below. Its untouched
inherited suite passed **340/340**, zero failures or skips, in 85.228 seconds.
During review, another writer committed that implementation as `d68856b`,
then amended it to `0c7fcd2`. That writer also changed `.project-steward/`.
The remaining work was isolated on `codex/rescue-runs-2`; the rescue commits
preserve the other writer's commit rather than rewriting it.

## Inherited file decisions

Paths below are relative to the repository, with `lib/` meaning
`skills/openmausbot-launcher/scripts/lib/`.

| Inherited file | Decision and reason |
| --- | --- |
| `lib/snapshot.mjs` | Changed. Kept chronological drop matching, conservative report windows, runtime proof, scoped lead evidence and card provenance. Extended the legacy-card completeness check to closed history; corrected the drop-window comment. |
| `lib/watch.mjs` | Kept. Final-return guards, authoritative checkpoint cancellation, discarded-read quiet reset, deadline-bound parsing, foreign-frame scoping and live durable progress all have regressions below. |
| `lib/verbs/run.mjs` | Changed. Kept deadline and history plumbing; added G2's shared-specialist send guard. |
| `lib/verbs/report.mjs` | Kept. A live report receives historical card provenance; the lifecycle test now checks that route explicitly. |
| `docs/design.md` | Changed. Kept the behavior descriptions, documented G2 and archived legacy uncertainty, and corrected the public JSON description: `complete:false`, not an exported `unknown` field. |
| `tests/snapshot.test.mjs` | Kept. The sibling's completed runtime file is necessary positive evidence; a missing file no longer proves exclusive ownership. |
| `tests/watch.test.mjs` | Changed. Kept the runtime fixture correction and both binary two-run watches. Replaced G4's short-budget/sleep assumptions with verified-poll and HTTP-response barriers. |
| `tests/watch-drain.test.mjs` | Changed. Kept every inherited assertion except replacing the flood's machine-speed limit with a stronger controlled-clock assertion: exactly one frame parsed before expiry, no checkpoint. |
| `tests/card-lifecycle.test.mjs` | Changed. Added a live report check before the later watch/answer checks. |
| `tests/delegation-drops.test.mjs` | Changed. Kept the 7,776-history oracle and ambiguity bound; added the partial-drop reporting/turn-allocation regression. |
| `tests/watch-deadline.test.mjs` | Changed. Replaced 50/70 ms sleeps with an explicitly pending read, timer cancellation, and a completed event-loop turn. |
| `tests/watch-followups.test.mjs` | Changed. Made frame consumption mandatory instead of conditional; added inactive legacy-card recovery, archived legacy uncertainty and discarded-outcome retention; removed unused imports. |
| `tests/watch-local-progress.test.mjs` | Kept. Both live-progress regressions fail on `0492520`. |
| `tests/watch-membership.test.mjs` | Kept as supporting coverage. It already passes on `0492520`; no new closure is claimed for that path. |
| `docs/review/2026-09-16-watch-drain-followups.md` | Replaced. Removed mixed-base line references, unverified historical conclusions and obsolete validation counts. |

No inherited implementation was dropped. The additional files changed by this
rescue are `SKILL.md`, `tests/identity.test.mjs`, `tests/docs.test.mjs` and the
new `tests/send-ownership.test.mjs`.

## G1–G5 and verified paths

Source shorthand: `S` = `lib/snapshot.mjs`, `W` = `lib/watch.mjs`,
`R` = `lib/verbs/run.mjs`, `P` = `lib/verbs/report.mjs`.
Test paths in the following table are under `tests/`. Line numbers refer to
the final source, not the older rescue. Every row marked **red** was observed
failing against an archive of `0492520` containing the final test files.

| Gap / path | Final guard | Failing-first regression / disposition |
| --- | --- | --- |
| G1: partial drops leave report windows open | S:116–145 closes all uncertain windows at the drop while retaining possible inflight work separately | **red** `delegation-drops.test.mjs:10`, “a partial anonymous drop closes report windows without settling surviving work”; checks later turns remain shared, including their usage |
| G1/G5: drop debt leaks into later batches or loses possible owners | S:33–106 matches removals only to preceding queues, keeps possible owners and bounds ambiguity at 512 nodes | **red** `delegation-drops.test.mjs:26,35,49,69`; chronology, repeated names, exhaustive oracle and conservative bound |
| G2: implicit send can steer another run's specialist | R:370–383 requires complete, exclusive attribution before delivery; explicit `--thread` remains deliberate delivery | **red** five cases in `send-ownership.test.mjs:8`: foreign/no/two owners, unresolved delegate, incomplete observation; also assert dry-run refusal, zero POSTs, explicit-thread and sole-owner success |
| G3: operator has no instructions for `unverified` | `SKILL.md`, watch loop and reading table; `docs/design.md`, watch rule | **red** `docs.test.mjs:40`, “the operator skill explains an unverified watch result and how to retry it” |
| G4: silence depends on a two-second wall-clock race | `watch.test.mjs`, `timeoutAfterObservation` and `responses` | Tests-only repair: clock expires after a verified poll wait; response barriers replace the 500/6500 ms sleeps. Original timeout, silence, change and polling assertions remain. No production behavior closure claimed. |
| G4: abandon may start after the replacement | `identity.test.mjs`, “abandon refuses a run replaced while it waits for the state lock” | Tests-only repair: wait for real SQLite contention before replacement; assert exit 3, replacement retained, and the specific stale-lock error. Uses the real CLI handler in-process, not an estimated subprocess startup delay. |
| G5: local closure after `finish` resolves returns stale done | W:390–392 and W:418–420 recheck after the final await | **red** `watch-drain.test.mjs:442`, “a terminal return rechecks ownership after the final checkpoint promise resolves” |
| G5: a consumed late settlement returns stale needs-user | W:390–392 rechecks before synchronous teardown | **red** `watch-followups.test.mjs:170`, “a consumed checkpoint frame is drained before final return”; consumption assertion is unconditional |
| G5: aborted optional checkpoint passes its guard or escapes as an error | W:268–293 checks child cancellation and handles the exact optional deadline error | **red** `watch-followups.test.mjs:141` and `watch-drain.test.mjs:461` |
| G5: discarded busy snapshot preserves older quiet | W:330–336 resets quiet before rejecting the read | **red** `watch-drain.test.mjs:580`, “an invalidated snapshot showing inflight work breaks the quiet interval” |
| Idle lead versus proven foreign work changes own evidence | S:407–413 normalizes the selected lead's work state/thread | **red** `watch-drain.test.mjs:505` |
| Unresolved delegate alone claims a card exclusively | S:431–454 retains uncertainty alongside direct owners | **red** `watch-drain.test.mjs:520` |
| Foreign specialist runtime traffic starves a verdict | W:182 scopes runtime dependencies | **red** `watch-drain.test.mjs:528` |
| Excluded hidden bot starves a verdict | W:213 excludes a hidden outsider absent from the roster and scope | **red** `watch-drain.test.mjs:538` |
| Stream parsing consumes checkpoint grace during observation | W:16–58 and W:203–207 use the current observation deadline | **red** `watch-drain.test.mjs:547`; controlled clock, no machine-speed threshold |
| Deadline leaves unread evidence/partial frame trusted | W:26–37,57 distinguishes a bounded benign tail from unread evidence | **red** evidence and partial cases at `watch-followups.test.mjs:219`; empty/heartbeat cases already pass on the base and remain supporting coverage |
| Foreign first-seen owner is forgotten between watches | S:347–359,431–454; W:328,360 retain locations and owner ids | **red** `watch-drain.test.mjs:568` |
| Older/closed owner is forgotten, or ownership changes during a watch | S:345–395,431–480 reads historical provenance beyond open dispatch cutoffs | **red** `watch-followups.test.mjs:59,69,230`; closed cards stay shared until settled |
| Historical over-read assigns an old unobserved card to a newer run | S:438 excludes later dispatches as possible origins | **red** `watch-followups.test.mjs:159` |
| Historical read failure is treated as settled | S:375–382 only accepts exact historical-only `404 no such conversation` as positive absence | **red** 503 case at `watch-followups.test.mjs:83`; the 404 and required-live-thread cases are supporting checks, not new base failures |
| Missing sibling log proves exclusive lead ownership | S:154–176 requires every candidate log to be readable | **red** `watch-followups.test.mjs:202`; `snapshot.test.mjs` and `watch.test.mjs` supply the sibling's completed history when proving exclusivity |
| Saved outcome is ignored on refresh or overwritten at checkpoint | W:128–134,248,316–317 includes the watched run's persisted outcomes in freshness and hydration | **red** `watch-followups.test.mjs:250,258` |
| Newer saved progress permits a stale stalled verdict | W:133,248,318 refreshes and guards the watched run's progress clock | **red** `watch-local-progress.test.mjs:22,29` |
| Active-task child timeout becomes a switch/retry | R:304–309 propagates cancellation even before outer-clock expiry | **red** `watch-deadline.test.mjs:7`; deferred read also verifies no detached retry |
| Legacy owner loses an inactive task's pending card | S:356–360 reads task lists when location was not recorded | **red** `watch-followups.test.mjs:108` |
| Closed history's unlocated legacy card permits complete truth | S:392–394 checks historical as well as open legacy owners | **red** `watch-followups.test.mjs:119`, also failed the inherited `0c7fcd2` implementation before the one-line fix |
| Discarded read loses an outcome when the next read is pruned | W:330 retains observed outcomes without authorizing that read | **red** `watch-followups.test.mjs:127` |
| Live report or later answer loses closed-owner provenance | P:42; R:411,540 pass history to snapshot/watch | **red** `card-lifecycle.test.mjs:7`; actual driver → fake server → watch → close → report → later watch → implicit refusal → explicit answer |

G1's implementation and most G5 guards were inherited and committed by the
other writer in `0c7fcd2`; this invocation independently verified them.
`ab1bf8c` implements G2. `7b42d02` fixes archived legacy uncertainty and adds
G1/report/outcome regressions. `e21a6b0` commits G4 and the retained deadline,
progress and membership tests. The final documentation commit supplies G3
and this audit.

## Earlier findings retained

The fifteen earlier findings remain mapped by test name in
[the first audit](2026-09-16-watch-drain-rescue.md#earlier-findings-reverified).
They were exercised again in the final full suites: bound implementers,
shared-specialist interruption, shared-lead quiet, foreign bot starvation,
foreign work evidence, whole-token run names, unreadable task logs, retained
card ownership, dropped windows, queued versus converted turn allocation,
report closure ownership, duplicate slug claims, exact worktree/branch pairs,
foreign-settlement draining, and dry-run claim conflicts.

The third-round attribution-confirmation and pre-nudge drain regressions in
`monitoring.test.mjs` and the lifecycle port-reservation tests also remain.
Both multi-run `watch.test.mjs` cases still spawn the actual driver against
the HTTP fake. Assertions for those findings were retained; the two runtime
fixtures now provide complete sibling-log evidence rather than treating a
missing file as proof. This invocation reran regressions; it did not repeat
the earlier reviewer's individual revert experiments.

## Validation and limits

- Initial inherited full run: 340 passed, zero failed/skipped, 85.228 s.
- Final focused regressions against unchanged `0492520` source: **83 tests,
  44 passed, 39 failed, zero skipped**. The log distinguishes already-covered
  paths from newly reproduced failures.
- Focused final watch/identity validation: 80 passed; snapshot/card/deadline
  validation: 30 passed. Documentation and skill-size checks pass.
- Node `v24.11.0`; `SKILL.md` is 304 lines. `git diff --check` passes.
- Three consecutive full runs on the final implementation and tests:

| Run | Command | Passed | Failed | Skipped | Duration |
| --- | --- | --- | --- | --- | --- |
| 1 | `npm test` | 350 | 0 | 0 | 73.208 s |
| 2 | `npm test` | 350 | 0 | 0 | 70.736 s |
| 3 | `npm test` | 350 | 0 | 0 | 70.623 s |

All three runs also reported zero cancellations. Only this audit's validation
record was finalized afterward; no implementation or test changed between
the three runs.

Logs are retained outside the repository in `/tmp/omb-rescue-runs-2/`,
including `inherited-suite.log`, `final-baseline-regressions.log`,
`followups-review.log` (the archived-legacy failing test), and `full-*.log`.
The regression archive uses `git archive 0492520`; only its tests were
replaced. The working-tree snapshot was saved before editing.

No new real OpenMausBot run or bot turn was spent, no upstream source was
changed, no dependency was added, and no push was made. Real two-run
OpenMausBot validation remains outside this fake-server Phase 5 repair.
The 512-node ambiguity fallback deliberately retains uncertain open work;
missing runtime proof deliberately keeps a busy lead shared. A request
already sent to the server cannot be recalled by a later invalidation.

The session's higher-priority workflow required Beads context checks and progress notes despite
the rescue note's prohibition. `oml-no8` remains open for the broader real-server
validation; `oml-2rc` retains its separate lifecycle/load-hammer acceptance. No `.beads/` or `.project-steward/` path is
staged in this invocation's rescue commits. The other writer's pre-existing
`0c7fcd2` checkpoint, including its project-state files, is preserved.
