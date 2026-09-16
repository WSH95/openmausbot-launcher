# Final multi-run watch audit

This completes the rescue brief against base `3111bbc`. The first repair
landed as `0492520`; an external coordinator merged it into `main` and added
`9b9fbe8` while this invocation independently reviewed an ignored source
copy. This follow-up was then applied to that committed version on `main`.
The earlier audit remains historical evidence for `0492520`; its claim that
all paths were closed is superseded by the regressions recorded here.

## Paths and verdicts

`W` = `skills/openmausbot-launcher/scripts/lib/watch.mjs`, `S` = its sibling
`snapshot.mjs`, `R` = `scripts/lib/verbs/run.mjs`. Base references below are
to `3111bbc`; final references are to the follow-up source in this commit.
“Closed” is a code-review inference, supported by the listed guards and the
failing-first regressions, not a claim of atomic server transactions.

| Path | Base verdict and exact lines | Final guard and exact lines |
| --- | --- | --- |
| An own frame arrives during hydration | Closed for evaluation by W:202,222,251; quiet resets at W:146. Effects after later awaits were separate gaps below. | Closed: W:327-361 rejects invalid reads before evaluation; W:391 and W:419 recheck after the last awaited return. |
| Foreign lead traffic repeatedly invalidates ownership | Open: W:233-255 spends two redraws, then reaches terminal/change at W:266-267 or nudge at W:256. | Closed: W:346-350 returns visible unverified/running after three unsuccessful reads. |
| Attribution moves while a previously foreign bot frame arrives | Partially closed: W:230-254 confirms a changed bot set, subject to the same unsafe bound. | Closed: W:337-350 confirms bot/thread scope before authorizing a view. |
| An unclaimed specialist emits a frame during the first read | Open: W:112-124 starts with only the lead/implementer, and W:231 excludes the initial attribution from confirmation. | Closed: W:178-182 classifies cold reads conservatively; W:213-225 expands observed threads. |
| A bot is deleted after the fleet was copied | Open: W:55,68 reads `id`, while upstream emits `botId`. | Closed: W:71,84 accepts upstream botId; W:184 invalidates deletion. |
| A current/discovered specialist thread differs from its recorded thread | Open: W:210,217 observes recorded threads and prefers the old recorded thread when selecting own frames. | Closed: S:341-388 reads recorded/current/remembered threads; S:497-498 exports their scope. |
| A request still belongs to this run while its bot belongs to another | Open: W:215-217 omits the request's thread from own-frame scope. | Closed: S:498 includes pending card threads in attribution. |
| First-sight card ownership changes between hydrations, or a bot switches away from the card thread | Open: each read uses unchanged input card memory; S:288-307 reads only recorded/current threads; W:291 remembers only the final selected-run cards. | Closed: S:345-359,432-453 preserves location and owner ids; W:328,360 preserves accepted ownership across run closure. |
| A legacy boolean card owner has no recoverable thread | Open: S:288-307 reads no remembered locations, and S:339 only consults owners of cards actually found; an otherwise complete read can lose the owner without seeing settlement. | Closed: S:355-359 reads task lists; S:391-393 keeps an unlocated live legacy request incomplete. |
| A foreign bot's health/name/current thread changes during a read | Open for ignored foreign frames: W:120-124 calls them other, though health/name can affect this run. | Closed: W:185-192 checks foreign health/identity changes; ordinary work remains irrelevant. |
| Runtime events or a canonical-log failure invalidate executing-thread proof | Open: W:63-72 ignores runtime frames. S:111,115 silently skips unreadable/malformed history. | Closed: W:79,91,182,217 observes live runtime gaps; S:153-174 rejects missing/damaged logs; S:399 also respects persisted distrust. |
| A receipt arrives during a multi-run read without a message frame | Open: W:183 classifies receipt writes as other, bypassing W:251,254. | Closed: W:243 treats receipt writes as relevant; W:330 retains observed outcomes without authorizing a verdict. |
| A nudge waits for a state lock or identity read | Open: R:481-487 has no freshness check after those awaits. | Closed: R:496-503 checks under lock; R:281-324 checks every HTTP boundary. |
| An authorized nudge produces a newer card/message before returning | Open: W:258-267 can emit change using the pre-nudge snapshot. | Closed: W:373-383 always invalidates and hydrates after a nudge attempt. |
| A checkpoint waits after the observer is closed | Open: W:281-286 aborts observation before R:492-500 acquires the checkpoint lock. | Closed: W:268-293 observes while checkpointing; W:281 checks cancellation; R:507 guards the synchronous write; W:391,419 guard final returns. |
| A task switch or retry happens after the watch view changed or timed out | Open: R:281-306 drops the watch's signal/deadline and does not recheck after GET/switch. | Closed: R:281-324 retains the shared deadline, cancellation, request cap and freshness check for each send/switch/retry. |
| Another local run closes or changes ownership during a read/lock wait | Open: R:488 captures `openRuns(cfg.state)` once; the checkpoint checks only the binding. | Closed: R:519-526 reloads the full binding and run/history context; W:128-134,248,306-350 checks ownership, own durable outcomes and progress. |
| Foreign activity or active-task switches reset this run's quiet/change evidence | Activity and separate counters were closed by W:138-146 and S:320; active `threadId` still leaked through S:320. | Closed: S:406-412 masks foreign work and normalizes proven foreign lead activity; W:182 excludes foreign specialist runtime traffic and W:213 excludes hidden outsiders. |
| One run reads lead text/outcomes from before its own dispatch | Open: S:299-305 reads to the earliest run, then S:346 uses that full tail for each view. | Closed: S:458 filters each lead tail at its own dispatch boundary. |
| Equal timestamps change hydrated order but carry the old terminal state | Open: S:420-422 sorts outcome evidence without recording the order used by `leadAfter`; S:431 can see identical evidence. | Closed: S:541 records hydrated order; S:545-553 rejects changed/incomplete carried evidence. |
| A partial anonymous queue drop erases already-running delegations | Open: S:47 clears every count, S:82 closes every window regardless of the dropped count. | Closed: S:33-106 matches drops/settlements only to preceding queues; S:128-133 conservatively closes report windows after anonymous drops. |
| An unresolved renamed delegate is masked as another run's implementer, or its card is assigned exclusively there | Open: S:328-333,341 matches only the bot's current name. | Closed: S:401,419-426 keeps unresolved work possible; S:432-453 prevents exclusive card claims from an uncertain name. |
| Reconnect replay/gaps, incomplete reads, or cursor advancement | Initial SSE reading, `resumed:false`, and incomplete-read refusal were already present at W:153-183,234-237,277-279. Unconfirmed complete reads could still advance a cursor at W:234-236. | Closed: W:346-361 advances only confirmed cursors; W:16-58 bounds parsing and distinguishes benign tails from unread evidence; W:414-424 cannot return stale terminal evidence. |
| Explicit send/answer fallback chooses the wrong run's active task | The delivery route was already confined to the selected run, with one switch/retry and no retarget of unowned threads at R:281-311. | Retained: R:281-329 allows only the selected thread and one known-owner switch/retry; direct operator sends do not rely on watch verdicts. |

The follow-up also reproduced these gaps in the intermediate repair:

| Additional path | Reproduction | Final guard |
| --- | --- | --- |
| A frame arrives after `finish` resolves but before stream teardown | Checkpoint microtask delivery returns stale needs-user; live context changes return stale done | W:388-392 and W:417-420 recheck synchronously after the final await |
| Optional checkpoint timer aborts before the outer clock reports expiry | Aborted callback still passes its write guard; optional timeout propagates as an error | W:280-291 checks the child signal and handles the exact deadline error |
| A discarded busy snapshot leaves an older quiet interval intact | Foreign ownership temporarily reveals our busy worker, then hides it before confirmation | W:332-336 resets quiet before discarding that read |
| Foreign specialist runtime or hidden-bot traffic exhausts the drain | A frame during every read produces unverified instead of done | W:182 and W:213 classify only actual dependencies |
| A stream flood consumes the checkpoint grace before observation finishes | Buffered decoding exceeds a 10 ms observation budget | W:16-58 uses the observation deadline; only W:278 extends it during an actual checkpoint |
| Empty/heartbeat-only buffer at deadline creates false uncertainty | Quiet-if-unchanged prints a timeout despite unchanged evidence | W:26-37,57 exempts only a bounded complete benign tail; partial/evidence tails invalidate |
| Another run's card owner is forgotten across invocations or mid-watch closure | Only A observes B's card; B's claim settles/closes; A then claims its bot | S:345-359,432-453 and W:328,360 retain accepted provenance, including closed owner ids |
| A remembered card predates the remaining open runs | Closing older B makes A's dispatch cutoff omit its pending card | S:374 reads remembered threads beyond the active dispatch cutoff |
| History-only thread deleted, or historical read fails | Exact 404 must retire old requests; 503 must remain incomplete | S:341,379 restricts the positive-absence exception to non-required threads |
| Older unremembered card is assigned to a newer run during historical over-read | Pending card at 2000, newer run dispatched at 3000 | S:437 excludes impossible originating runs |
| Old anonymous drop debt leaks into later queue batches | Queue W/O, drop 1, queue N, settle W must leave only N; repeating W must retain both possibilities | S:39-105 uses chronological matching and alternating reachability, bounded at 512 nodes |
| Fresh persisted receipt is overwritten or ignored at checkpoint | getRuns contains a receipt newer than DONE; REST no longer contains it | W:128-134,248,316-318 merges and guards this run's persisted outcomes; foreign outcomes do not invalidate it |


Three related repairs arrived from an independent writer in this checkout
while final verification was running. Their source changes were reviewed
and preserved; their new test files were not edited by this invocation.

| Additional path | Base/intermediate verdict | Final guard |
| --- | --- | --- |
| A discovered helper leaves the section while its old card remains pending | Base S:288-303 has no durable card-thread read; the intermediate follow-up still filtered remembered threads by current team membership | Closed: S:345-351 reads remembered locations independently of current membership; regression in `watch-membership.test.mjs:5` |
| A local send/watch saves newer progress before hydration or during checkpoint wait | Base W:129,205 retains the invocation's initial progress clock; a later saved timestamp could leave a stale stalled verdict | Closed: W:133,248,316-318 guards and refreshes the watched run's progress; regressions in `watch-local-progress.test.mjs:22,29` |
| A delivery child timeout fires before the outer clock reports expiry | Base R:281-306 lacks the shared deadline entirely; intermediate R:303 swallowed the child timer error | Closed: R:304-309 preserves the deadline error and prevents a detached switch/retry; regression in `watch-deadline.test.mjs:6` |

## Regression evidence

The fifteen earlier findings and third-round fixes remain mapped in
[the first audit](2026-09-16-watch-drain-rescue.md#earlier-findings-reverified).
Their original assertions are retained. The two original two-run watches
still execute the driver against the HTTP fake. Two fixtures now explicitly
record the completed sibling runtime history needed for exclusive ownership;
missing files no longer constitute that proof.

- Independently archived `3111bbc`: 269 passed, 0 failed, 0 skipped.
- First root draft against that archive: 21 regressions failed before fixes.
- Against merged `0492520`/`9b9fbe8`, the first follow-up focused run had
  39 passed and 21 failed. Later direct regressions reproduced three deadline/
  live-closure failures and two persisted-outcome failures before their fixes.
- Latest focused run: 67 passed, 0 failed, 0 skipped. It includes a fake-server
  watch → close → later watch → explicit answer lifecycle, and an independent
  exhaustive oracle for 7,776 short delegation histories.
- Final plain `npm test`: 340 passed, 0 failed, 0 skipped (75.045 s).
- Final `mkdir -p .superpowers/tmp && TMPDIR=$PWD/.superpowers/tmp npm test`:
  340 passed, 0 failed, 0 skipped (95.743 s).
- These workspace runs include four tests in the three independently authored
  files listed above. Those files are preserved but not staged by this
  invocation; the explicit-path repair commit contains 336 tests, 67 more
  than `3111bbc` (34 from `0492520`, 33 in this follow-up).
- One intervening TMPDIR full run had 339 passed and one failure: the
  existing two-second quiet-output watch reached its REST deadline and
  printed visible uncertainty. The unchanged rerun passed. Load sensitivity
  is an inference; the failure log is retained as
  `rescue-main-tmpdir-load-failure-845029.log`. No assertion was loosened.
- `git diff --check` passed. Production source was unchanged between the
  final plain and TMPDIR runs (combined diff SHA-256
  `c75ab6de75ac24366ac252773ae284f506a1236b6d1cb84fe8fc3f66d04ca7e4`).

The matching bound deliberately retains unknown/open work for pathological
unbroken histories exceeding 512 queue/removal nodes. Historical card reads
remain bounded by the existing snapshot deadline. Missing runtime proof
keeps a busy lead attributable to every run. No new real OpenMausBot run was
performed, so real two-run validation remains Phase 7 work. An HTTP mutation
already sent cannot be recalled when later server state changes.

Logs from this invocation remain in ignored `.superpowers/tmp/` under
`rescue-*-845029.log`. No push was made and no upstream source was changed.

Protocol deviation: earlier in this invocation, read-only Beads context
commands were run despite the rescue brief's prohibition. That was an
error. No `.beads/` path is staged in this follow-up. The earlier repair's
separate Beads activity is recorded in its own historical audit.

After final verification, the independent writer added
`tests/send-ownership.test.mjs` and further edited
`tests/delegation-drops.test.mjs` and `tests/watch-followups.test.mjs`.
These subsequent changes are preserved unstaged and are not covered by the
recorded 340-test runs. The results above describe this repair checkpoint
plus the four independent tests already present during those runs.
