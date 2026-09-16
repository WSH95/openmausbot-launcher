# Multi-run watch rescue

Base: `3111bbc`. Work branch: `codex/rescue-watch-drain`. This review and
implementation used the rescue brief and all three earlier review reports.
No real OpenMausBot run was started. The pinned upstream source was read,
not changed.

## Path enumeration

The line references below distinguish the committed base from this branch.
`W` is `skills/openmausbot-launcher/scripts/lib/watch.mjs`, `S` is the sibling
`snapshot.mjs`, and `R` is `scripts/lib/verbs/run.mjs`.

| Path | At `3111bbc` | This branch |
| --- | --- | --- |
| An own frame arrives during hydration | Closed for evaluation by W:202,222,251; quiet resets at W:146. Effects after later awaits were separate gaps below. | W:289-318 accepts only a complete read with an unchanged relevant generation; W:290 invalidates the preceding read's permission before starting another. |
| Foreign lead traffic repeatedly invalidates ownership | Open: W:233-255 spends two redraws, then reaches terminal/change at W:266-267 or nudge at W:256. | W:303-307 returns visible running/unknown after three unsuccessful reads; no terminal, change, nudge, cursor advance or checkpoint from that read. |
| Attribution moves while a previously foreign bot frame arrives | Partially closed: W:230-254 confirms a changed bot set, subject to the same unsafe bound. | W:293-307 confirms both bot and thread scope; the bound returns unverified instead of using the last candidate. |
| An unclaimed specialist emits a frame during the first read | Open: W:112-124 starts with only the lead/implementer, and W:231 excludes the initial attribution from confirmation. | W:156-173 classifies cold reads conservatively; W:190-201 also covers as-yet-unobserved threads. |
| A bot is deleted after the fleet was copied | Open: W:55,68 reads `id`, while upstream emits `botId`. | W:55,68 accepts `botId`; deletion is an ownership invalidation at W:162. Verified against upstream `server/index.ts:1915`. |
| A current/discovered specialist thread differs from its recorded thread | Open: W:210,217 observes recorded threads and prefers the old recorded thread when selecting own frames. | S:411-418 exports observation and attribution inputs separately; W:293-307 expands coverage and confirms the new scope. |
| A request still belongs to this run while its bot belongs to another | Open: W:215-217 omits the request's thread from own-frame scope. | S:417 includes pending request threads; their settlement frames invalidate the view. |
| First-sight card ownership changes between hydrations, or a bot switches away from the card thread | Open: each read uses unchanged input card memory; S:288-307 reads only recorded/current threads; W:291 remembers only the final selected-run cards. | S:299-301,368-372 records card locations; W:291-318 retains confirmed owners for all views in memory while checkpointing only the selected run. |
| A legacy boolean card owner has no recoverable thread | Open: an otherwise complete read can lose the owner without seeing settlement. | S:324-325 marks the observation incomplete until the request or its settlement is visible. |
| A foreign bot's health/name/current thread changes during a read | Open for ignored foreign frames: W:120-124 calls them other, though health/name can affect this run. | W:163-173 invalidates health and identity changes without treating ordinary foreign work as this run's progress. |
| Runtime events or a canonical-log failure invalidate executing-thread proof | Open: W:63-72 ignores runtime frames. S:111,115 silently skips unreadable/malformed history. | W:74-76,159,193 observes runtime dependencies and disables damaged proof; S:110-131,332 rejects unreadable, malformed and explicitly incomplete logs. Confirmed checkpoints retain `runtimeUntrusted`. |
| A receipt arrives during a multi-run read without a message frame | Open: W:183 classifies receipt writes as other, bypassing W:251,254. | W:219 treats receipt writes as relevant dependencies; hydration must include them before deciding. |
| A nudge waits for a state lock or identity read | Open: R:481-487 has no freshness check after those awaits. | R:490-497 checks inside the lock and passes the guard through every delivery request; W:328-339 rehydrates after the attempt. |
| An authorized nudge produces a newer card/message before returning | Open: W:258-267 can emit change using the pre-nudge snapshot. | W:335-339 invalidates and hydrates again before any result. |
| A checkpoint waits after the observer is closed | Open: W:281-286 aborts observation before R:492-500 acquires the checkpoint lock. | W:244-260 checkpoints inside the observer lifetime; R:498-511 checks under the lock; another check precedes return. |
| A task switch or retry happens after the watch view changed or timed out | Open: R:281-306 drops the watch's signal/deadline and does not recheck after GET/switch. | R:281-318 guards the first POST, active-task GET, switch and retry under one deadline and abort signal. |
| Another local run closes or changes ownership during a read/lock wait | Open: R:488 captures `openRuns(cfg.state)` once; the checkpoint checks only the binding. | R:513-518 reloads ownership; W:111-115,224-225,273-307 checks its inputs before decisions and effects. |
| Foreign activity or active-task switches reset this run's quiet/change evidence | Activity and separate counters were closed by W:138-146 and S:320; active `threadId` still leaked through S:320. | S:339-344 masks foreign active threads and presents the selected lead thread; the existing real-watch starvation regressions pass unchanged. |
| One run reads lead text/outcomes from before its own dispatch | Open: S:299-305 reads to the earliest run, then S:346 uses that full tail for each view. | S:377 filters each lead view at its own dispatch boundary. |
| Equal timestamps change hydrated order but carry the old terminal state | Open: S:420-422 sorts outcome evidence without recording the order used by `leadAfter`; S:431 can see identical evidence. | S:460 records relevant hydrated order; S:464-474 refuses changed or incomplete evidence. |
| A partial anonymous queue drop erases already-running delegations | Open: S:47 clears every count, S:82 closes every window regardless of the dropped count. | S:47-52,84-90 clears/closes only a fully matched drop; an unidentified subset remains unknown and inflight. Upstream `server/delegations.ts:418-441` drops pending handoffs only. |
| An unresolved renamed delegate is masked as another run's implementer, or its card is assigned exclusively there | Open: S:328-333,341 matches only the bot's current name. | S:334-366 conservatively retains unresolved claims and shared specialist requests. |
| Reconnect replay/gaps, incomplete reads, or cursor advancement | Initial SSE reading, `resumed:false`, and incomplete-read refusal were already present at W:153-183,234-237,277-279. Unconfirmed complete reads could still advance a cursor at W:234-236. | W:176-221 preserves replay/fallback; W:303-318 advances only the cursor received before a confirmed complete read. Deadline and unverified paths cannot emit a terminal state. |
| Explicit send/answer fallback chooses the wrong run's active task | The delivery route was already confined to the selected run, with one switch/retry and no retarget of unowned threads at R:281-311. | R:281-320 retains those refusals. Explicit sends do not depend on a watch verdict; automatic nudges additionally supply the freshness guard. |

Code-review conclusion (inference): all listed decision and effect paths now
pass through the same generation/scope/ownership check. This is a guarantee
about observed invalidations, not an atomic transaction with the server.
An already authorized HTTP request cannot be recalled if the server changes
after it was sent.

## Earlier findings reverified

All tests below passed in the full 303-test run. The original test files and
assertions were not changed in this branch.

| Earlier finding | Regression retained |
| --- | --- |
| 1. Unbound implementer | `run.test.mjs:462`, “an implementer the launcher never bound is not assigned…” |
| 2. Another run's specialist interrupted | `run.test.mjs:488`, “interrupt refuses a specialist thread the other run may be using…” |
| 3. Shared lead frames reset quiet | `watch.test.mjs:263`, “the lead's frames for the other run's turns do not restart this run's quiet window” |
| 4. Foreign hydration traffic starves a verdict | `monitoring.test.mjs:234`, “another run's bot frames never starve this run's verdict” |
| 5. Foreign activity leaks into evidence | `snapshot.test.mjs:399`, “another run's bot changing activity is not a change in this run's evidence” |
| 6. T1/T10 and foo-1/foo-10 attribution | `report.test.mjs:475`, “a run's name is matched whole…” |
| 7. Unreadable task log passes | `report.test.mjs:498`, “a task log that cannot be read leaves the record unknown instead of passing” |
| 8. Incomplete read loses card owner | `watch.test.mjs:167`, “mergeCards forgets an answered card only when the observation was complete” |
| 9. Dropped queue windows remain open | `snapshot.test.mjs:383`, “delegationWindows records how each window opened and closes them when the queue is dropped” |
| 10. Ordinary queued window takes an earlier turn | `report.test.mjs:401`, both “two open runs are reported and closed one at a time” cases; converted/queued window assertions remain intact |
| 11. Report closes after ownership moves | `report.test.mjs:525`, “a run does not close on a repository check that counted another run's worktree as owned” |
| 12. Duplicate slug claims | `repo.test.mjs:46`, “reconcile matches each worktree to the run that owns it and claims an orphan for a run” |
| 13. Wrong worktree path/branch accepted | `git.test.mjs:67`, “a run owns the exact pair .worktrees/<slug> on task/<slug>…” |
| 14. Foreign settlement not drained | `monitoring.test.mjs:248`, “a foreign frame that hands this run a busy bot is drained before a verdict” |
| 15. Dry-run claim conflict accepted | `repo.test.mjs:46`, its real and dry-run conflict assertions |

The third review's attribution-confirmation and pre-nudge drain tests at
`monitoring.test.mjs:285,303` also pass. Both lifecycle reservation tests pass.
Both two-run watch tests at `watch.test.mjs:237,263` still execute the actual
driver against the fake server.

## Verification and integration

- Node `v24.11.0`.
- Baseline archive of `3111bbc`: 269 passed, 0 failed, 0 skipped (71.188 s).
- The first 33 cases in `tests/watch-drain.test.mjs` were run against the
  unchanged archive: 0 passed, 33 failed, 0 skipped. Failures included false
  terminal results, ignored guards, expired delivery continuing, lost card
  ownership, and unchanged evidence despite changed ordering.
- Final review added a 34th regression for repeated foreign bot frames with
  explicit `hidden: false`. It failed the draft classifier (33 passed,
  1 failed) before the comparison was fixed; the focused file then passed 34/34.
- Final required command, in the isolated worktree:
  `mkdir -p .superpowers/tmp && TMPDIR=$PWD/.superpowers/tmp npm test`:
  303 passed, 0 failed, 0 skipped (70.050 s).
- Documentation/metadata checks after the design edit: 4 passed, 0 failed,
  0 skipped. `git diff --check` passed.
- An intermediate full run failed the existing checkpoint-watermark test.
  Coalescing had consumed the rest of a two-second watch. Capping batching at
  half the remaining budget left room for a confirming read; its assertions
  were retained.
- Logs are under the primary checkout's ignored `.superpowers/tmp/`, named
  `rescue-head-tests.log`, `rescue-head-regressions-final.log`, and
  `rescue-isolated-suite-303.log`. The intermediate 302-test green run is
  retained as `rescue-isolated-suite-final.log`.

The primary checkout acquired additional edits from an independent writer
during this session. This work therefore stays on `codex/rescue-watch-drain`
in `.superpowers/tmp/codex-rescue-worktree`; it is not merged over those
uncommitted edits. No push or real bot run was performed. Real two-run
OpenMausBot validation remains outside this fake-server repair pass.

The session workflow required Beads context checks and a note on `oml-no8`,
despite the rescue brief's prohibition. No `.beads/` path is part of this
commit. The parent issue remains in progress while the separate integration
and broader validation continue.
