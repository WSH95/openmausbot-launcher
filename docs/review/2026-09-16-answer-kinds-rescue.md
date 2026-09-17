# Phase 6 answer kinds rescue

Audited `186baf2..aba96d0` and the rescue commits on `main` against the original
`task-answer-brief.md`, both Codex review reports, the implementer's report,
`docs/design.md`, and the pinned OpenMausBot 0.1.56 source. The rescue started
at `aba96d0` (376 tests). This report closes the implementation findings;
upstream limitations are recorded below rather than represented as guarantees.

Source citations such as `index.ts:12197` refer to
`~/.cache/agent-team/openmausbot-src/server/`; `shared/credential-request.ts`
is relative to that checkout's root. Line numbers were checked against that
checkout, not copied from the brief. The fake uses `// S:` comments for these
facts. No OpenMausBot source was changed and no real bot turns were spent.

Test abbreviations below are files under `tests/`: **answer** =
`answer.test.mjs`, **contract** = `answer-contract.test.mjs`, **fake** =
`fake-omb.test.mjs`, **monitoring** = `monitoring.test.mjs`, **http** =
`http.test.mjs`, **docs** = `docs.test.mjs`. Descriptions identify the named
test or assertions in that file. “Done” means retained and audited from the
input range; “fixed in” identifies the relevant change, including earlier
review fixes. Source-only checks are explicitly distinguished from fake tests.

## Original brief: requirements and disposition

| ID | Requirement | Status and implementation evidence | Verification |
| --- | --- | --- | --- |
| B01 | Node 24, ESM, built-ins only; never patch OpenMausBot | Done. No dependency or upstream change. | Full `npm test` on Node v24.11.0; range diff and `package.json` inspection. |
| B02 | Test first, green suite with no skips, clean diff; retain the Phase 5 multi-run contract | Done. Each rescue behavior change followed a failing regression; focused tests then the full suite. Production Phase 5 changes are limited to Phase 6 resumable attribution and exporting its existing thread reader. | Full suite, `git diff --check`; **monitoring** foreign/ambiguous ownership, **answer** two-run cases, existing run/watch/report tests. The unrelated deadline fixture correction is explained under A11. |
| B03 | No secret in argv, output, state, transcript, previews or logs | Fixed in `e33cec7`, `0ecec91`, `f8e9d2c`, `7bf8ca7`. User-owned 0600 file through stdin, or a variable exported by the user in their own shell; no agent-composed value assignment. Config response errors redact submitted values before creating printable error objects. Removed an old negative test that passed its dummy credential in argv. | **answer** “the value reaches the server … appears nowhere else”, provider error text with verbose stderr, half-finished save, ambiguous replacement; **http** redacted config PUT; **docs** recursive instruction scan. Dummy driver inputs use only child stdin/environment. |
| B04 | Preserve v2 runs, `--run`, request ownership and explicit shared selection | Fixed in `4b2932a`, `512b8b6`, `7bf8ca7`; existing state version is unchanged. Foreign resumables remain explicitly selectable but do not alter another run's verdict/evidence. | **answer** “with two runs open …”, **monitoring** foreign open/closed owners, ambiguous owners, checkpoint ownership; existing `run.test.mjs`. |
| B05 | Extract and register `verbs/answer.mjs`; preserve bare-text send and ordinary question/approval behavior | Done in `c94b6ef`; entry point and CLI test import it. | `cli.test.mjs`, **docs** registered verbs, **answer** approval/question/dead/multiple/bare-text cases; original multi-run answer tests retained in `run.test.mjs`. |
| B06 | Exactly one mode, validate kind before POST; exits 0/2/3/5 | Done; credential-only flag validation strengthened in `d0574c6`. Confirm/cancel are allow/deny aliases. | **answer** wrong mode, mutually exclusive modes, unsupported kind, `--message` on skill/routine, `--reviewed` on another kind, `--secret-stdin` on dismiss; request listeners assert no mutation. |
| B07 | `--request` uses request ID for cards, message ID for secret/connector; expose `handle` and connector description | Done in `c94b6ef`. | **answer** “a connection and a credential card are named by the message”, **monitoring** every pending kind; `snapshot.test.mjs` required-state vocabulary. |
| B08 | HTTP PUT, refusal mapping, redacted config dry run | Done in `c94b6ef`; hardened in `f8e9d2c`. 400/404/409/422/429 become exit 3 with status; matching scope/app-only 403 becomes exit 5. | **http** PUT preview and refusal mapping; **answer** client-scope connector/credential cases and verbose provider errors. Non-secret server error text is preserved. |
| B09 | Correct tool and message kinds | Done in `c94b6ef`. `skill_manage` produces `stage_skill`; `propose_routine` / `propose_routine_action` produce `schedule_routine` / `manage_routine`. `request_credential` produces `kind: secret`; the Composio bridge produces `kind: connector`, without a bot tool. | Source: `drivers/agents-proxy.ts:329,386,404,434,718,753,773,872`; `connector-proxy.ts:156,201`; `index.ts:6383,8237,8336`; `routine-requests.ts:534,581`; `store.ts:69-99`. **fake** typed-card tests. |
| B10 | Skill title/options and full versioned payload, preview SHA-256, stale-preview fixture | Done. Payload carries request/bot/thread/staged IDs, action, name, gist, source, preview, hash, warnings, creation time. | Source: `index.ts:6372-6431`, `skills.ts:1250`. **fake** learned-skill payload/hash test; **answer** stale preview. |
| B11 | Skill allow requires 64 hex reviewed hash equal to the card before posting; deny; never send textual answer | Done in `33e2999`. No mutation on absent, malformed or wrong-card hash. Returned fields include kind, name, action, behavior and outcome. | **answer** reviewed-hash test asserts exact result and only one POST; deny/text-mode assertions. **fake** non-allow (including raw textual answer) rejects. Source: `index.ts:6470-6504,6513-6519`. |
| B12 | Also hash the preview locally and return exit 2 on mismatch | Not applicable under the accepted design/DECISIONS 0015 ruling. This conflicts with the same brief's requirement that a stale preview reach the server's 422 and exit 3. The server rehashes before applying; that established ruling is preserved. | **answer** stale preview returns exact 422 text, no installation, recreate hint. Source: `index.ts:6520-6523`. This is an explicit deviation, not an omitted hash gate. |
| B13 | Skill settled replay, older-build/hash/preview/staged refusals, ownership, verification and cleanup | Done; fake mismatches fixed in `ca662dc`, `6444977`; missing staged-content coverage added in `4f1b147`. Independent staged metadata now detects changed card fields. | **fake** settled replay/409/hash; **answer** older-build 409, stale-preview/staged-gone 422; **contract** trusted owner, staged request/thread/name/source/action mismatch, GET `{text}`, DELETE success/missing. Source: `index.ts:6438-6597,10557-10574`; `skills.ts:742-746`. Concurrent card disappearance and real disk apply failures are source-audited, not disk simulations. |
| B14 | Skill feature gate, 8 open cards/thread, 20 staged skills/bot | Done in docs; these are upstream creation limits, not launcher-created limits. | Source: `config.ts:419-421`, `index.ts:6303-6339,7711-7714`, `skills.ts:68,1239-1240`. API/limits docs record them. Fake control ops inject already-created cards; they do not simulate bot staging or enforce those creation caps. HTTP 429 mapping is tested in **http**. |
| B15 | Routine title/options/subtitle, versioned operation, past-once fixture | Done in `c94b6ef`. | **fake** typed routine and revalidation tests; **answer** title and past schedule. Source: `routine-requests.ts:119-157,515-583`. Fixture schedule rendering is stable rather than server-localized, as its source comment states. |
| B16 | Routine confirm/cancel aliases, no textual answer, result action/ID, settled replay | Done in `9782aab`; fake decision/id behavior corrected in `ca662dc`. `run_now` returns a run ID rather than routine ID. | **answer** confirm applies/list verifies, cancel does not apply, conflicting modes/text are rejected; **fake** settled replay; **contract** `run_now`, decision rows once. Source: `index.ts:4802-4854`, `routine-requests.ts:981-1041`. |
| B17 | Routine stale/missing/past refusals with exact text and `held`; mismatch/owner validation; safe cancel | Fixed in `ca662dc`, `a6060c7`. Revalidation failures set `held`; payload ID/owner refusals do not necessarily do so. The unconditional “now carries held” hint was inaccurate. | **answer** 404/409 revalidation and 400 ownership-payload hint; **contract** request-ID 400, bot/thread 403, deny escape, changed routine 409, recorded `held`. Source: `routine-requests.ts:642-688,812-855,896-908,919-927`. |
| B18 | Routine 8-card cap; GET verify, DELETE cleanup with client scope | Done; verification/cleanup contract strengthened in `ca662dc`. | Source: `index.ts:6303-6321,8438-8464`; `request-auth.ts:241`. **answer** list result; **contract** client DELETE and missing-routine 404. Creation cap is source/documentation coverage, as for B14. |
| B19 | Credential tool, five exact IDs, real message fields/handoff, already-configured creation, unsupported ID | Done; defensive own-property allowlist fixed in `d0574c6`. Launcher consumes cards rather than calling the internal creation route. | Source: `shared/credential-request.ts:6-38`, `index.ts:6742-6744,8237-8277`. **fake** credential card fields; **answer** unknown/prototype-like targets refuse before mutation. Internal creation responses are source-audited. |
| B20 | Headless value path is config PUT then `provided`, never phone `provide`; exact credential patches; config admin scope | Done in `808f8ca`; contract fixed in `ca662dc`, `ed21622`. `provided` is also admin, correcting the original assumption; only resume/dismiss are client routes. | **answer** all four writable targets and client refusal; **fake** five sections/config and phone 403; **contract** empty strings, wrong types, optional empty sections, feature Boolean. Source: `shared/credential-request.ts:52-65`, `config.ts:234-267,395-400`, `schema.ts:14-18`, `index.ts:11675-12059,12156-12229`, `request-auth.ts:218`. |
| B21 | Exactly one nonempty environment/stdin source; strip one trailing newline; delete environment variable after read; dry run never reads | Done; expanded tests in `d0574c6`, `4f1b147`. Read path deletes the environment entry immediately after copying it. | **answer** environment/stdin/both/empty/no source; every target retains one of two newlines; dry run with a never-released stdin completes without reading. Source inspection verifies deletion immediately after read. |
| B22 | No value source exits 5 and asks by label, with safe handoff instructions | Fixed in `e33cec7`, reinforced in `0ecec91`. Early fleet precondition still applies to provider targets. | **answer** no value, no save, handoff hint, no unsafe assignment; **docs** all docs and shipped references. |
| B23 | Box token exits 3 because config PUT inventories cloud computers | Done in `808f8ca`. No override. | **answer** Box target remains unconfigured; source `index.ts:11752-11790`. App provision is the supported path. |
| B24 | Save success/card failure reported separately; dismiss wakes; failed wakes remain recoverable without the value | Done in `c9d05f9`, `c0c33cd`; settled recovery hints fixed in `5c0031b`. | **answer** phone-saving conflict after successful PUT, value-free resume, failed provide wake, failed decline wake, settled-card transient error and cleared-config recovery; **monitoring** provided/dismissed resumables. Source: `index.ts:6767-6781,6838-6853,12190-12229`. |
| B25 | Ambiguous save must not claim failure or success without evidence; config remains durable before reload | Fixed in `9795727`, `dee213d`, `7c2a569`; expanded in `4f1b147`. 60-second PUT; before/after configured checks; only explicit false-to-true verifies. Existing value, unreadable readback and native voice readiness stay unknown at exit 3, with no automatic wake. | **answer** lost response, failure before save, 4xx refusal, existing-key replacement across lost/error replies, unreadable readback, native voice. Source: `index.ts:7125-7157,11962-11968,12003-12042`; `tts/index.ts:28-36,57-63`. |
| B26 | Strip credential variable from launched server; doctor reports only stripped names | Done in `808f8ca`; documented in API/limits. | **answer** `STRIPPED_ENV` membership; existing lifecycle/proc environment tests and source inspection of server spawn/doctor's filtered name list. No credential value is included in the doctor output path. |
| B27 | Connector prerequisite, real payload/status vocabulary, shared resume key and alias | Done in `c94b6ef`. Cards originate in the Composio MCP bridge only when enabled. | Source: `connector-proxy.ts:201`, `composio.ts:254-262`, `index.ts:8336-8399`, `store.ts:69-82`. **fake** real kinds/family, account status only observable after GET; `snapshot.test.mjs`. Internal MCP creation is source-audited, not invoked by this driver. |
| B28 | Connect returns one-time URL, exit 5, family fields; owner-only route | Done in `f964a93`; authorize failure text/status fixed in `ca662dc`, hint corrected in `df7e2f1`. | **answer** URL/result/status, no URL in transcript, scope 403 -> 5; **fake** scope table; **contract** existing-account alias refusal is 400 and leaves `failed`. Source: `index.ts:12231-12250`, `composio.ts:348-350,924-935`. The brief incorrectly called missing alias a 409. |
| B29 | Resume reads status for every sibling, then POSTs only if still unresumed; connected cards selectable; dry run skips mutating GET | Fixed in `d399c6e`, `df7e2f1`. Read the whole thread family, including dismissed/resumed/foreign siblings. Refuse before any status GET if a sibling is required/failed or dismissed. Poll every authorizing/connected sibling, re-read family after polling, skip POST if GET already resumed it. | **answer** multi-app flow, required/failed/dismissed no-GET cases, no redundant resume POST, dry run, status-error after an earlier GET woke the bot; **monitoring** connected-unresumed selection. Source: `index.ts:6618-6622,6687-6697,12255-12283`. |
| B30 | Connector dismissal never wakes; direct continuation hint; status/resume/dismiss client scope | Done; missing selected-run suffix fixed in `7bf8ca7`. | **answer** dismissal/wake count and two-run send hint; **fake** client routes. Source: `index.ts:12284-12287`, `request-auth.ts:219-220`. |
| B31 | Kind-specific status/watch briefs, no skill preview/value in brief | Done in `c94b6ef`, `42c2394`; secret handoff fixed in `e33cec7`; settled credential form fixed in `3389ab0`. Required/failed connectors say connect; authorizing/connected say resume. Pending credentials retain provide/stdin or dismiss; settled ones show only a complete resume command. | **monitoring** every kind, all connector states, provided/dismissed secret with two runs; **answer** two-run command carry-through. The brief's unsafe credential assignment form is superseded by review rulings. |
| B32 | Resumables exposed in status/watch, evaluation/evidence/ownership and durable checkpoint | Fixed in `209049a`, `aba96d0`, `512b8b6`. Evidence version 3 invalidates older carry proofs conservatively. | **answer** “a wake that never fired …” checks exit 5 after DONE marker, public status, checkpoint owner, later successful resume/done; **monitoring** stuck/foreign/ambiguous evidence, signature and carried verdict. |
| B33 | Fake respond semantics, real 4xx words, decision rows, routine list, skill store | Done, corrected in `ca662dc`, `6444977`. Implemented Phase 6 routes checked against source, with `// S:` comments. | **fake** skill/routine/card/credential/connector/scope tests; **contract** ownership, metadata, replay, cleanup, result IDs and config types. Race-only and provider/disk cases are separated in the limitations below. |
| B34 | Fake connector account control and four routes; fake secret/config fields private | Done, corrected in `ca662dc`, `ed21622`. Config stores configured booleans and excludes them from `/__fake/state`; no stored credential strings. | **fake** account status changes only on GET; secret four-route behavior/config state exclusion; **answer** success/failure leak assertions; **contract** parse/refusal cases. Phone-only encrypted submission is deliberately not simulated. |
| B35 | New answer tests, helper stdin support, old single-run test replacement, existing multi-run tests retained | Done in `c94b6ef`; delayed stdin support added in `0e946b0`, dedicated contract tests in `ca662dc`. | Full suite; helpers used by the late-start guard and held-stdin dry-run regressions. |
| B36 | Update SKILL section 5, API rows, design answer/deferred/snapshot text, pitfalls and decision 0015 | Done in `f407866` and rescue docs. This audit consolidates safe entry, guard limits, unknown writes, settled recovery, complete connector families and held semantics. | **docs** registered verbs and recursive credential-instruction guard; source review of each named document. SKILL remains below 500 lines. Only entry 0015 in `.project-steward/` was modified during rescue. |
| B37 | Original prep -> routine -> skill -> secret -> connector -> docs commit order/report/trailer | Done historically in `c94b6ef`, `9782aab`, `33e2999`, `808f8ca`, `f964a93`, `f407866`. The original report is preserved as an input. The original requested author trailer is not applicable to this rescue: the current instruction requires the Codex gpt-6-astra trailer on each new commit. Historical commits were not rewritten. | Git history; each rescue commit is Conventional Commit form on `main` with the required trailer. Rescue report and CLI output file replace the original turn's delivery instruction. No push, Beads command, or steward checkpoint/wrap. |

## Both reviews

| Review finding | Status | Verification and scope |
| --- | --- | --- |
| R1-F1 / P1: keep secrets out of agent-executed shell commands | Fixed in `e33cec7`; remaining design hole fixed in `0ecec91`; response-error leakage fixed in `f8e9d2c`. | B03/B22; **docs** scans all `docs/**/*.md` plus installable instructions; **answer** output and error leak tests. |
| R1-F2 / P1: guard provider writes against active turns | Fixed in `bff3a2d`, strengthened in `0e946b0`. | Early and final whole-fleet + queued/running team-map checks. **answer** busy other bot/team, idle queued/running maps, work beginning while stdin blocks, TTS no fleet reload. |
| R1-F3 / P1: surface resumable wake failures to monitoring | Fixed in `209049a`, checkpoint test `aba96d0`; foreign-run scope fixed in `512b8b6`. | B32; error resumables prevent done/failed/stalled attribution for their owner, not known other runs. |
| R1-F4 / P1: authorize every connector before status polling | Fixed in `d399c6e`; complete family lookup fixed in `df7e2f1`. | B29; zero status reads when any required/failed sibling exists; dismissed siblings also refuse. |
| R1-F5 / P2: treat lost config responses as ambiguous | Fixed in `9795727`, corrected in `dee213d`, `7c2a569`; added unreadable-readback coverage `4f1b147`. | B25; no configured-only proof of replacement; unknown output has both choices and the selected run. |
| R1-F6 / P2: failed credential dismissals remain resumable | Fixed in `c0c33cd`; actionable recovery strengthened in `5c0031b`, `3389ab0`. | **answer** decline -> failed wake -> resume; **monitoring** dismissed-unresumed visibility and only-resume brief. |
| R1-F7 / P2: preserve `--run` in generated follow-ups | Fixed in `4b2932a`; missed connector dismissal follow-up fixed in `7bf8ca7`. | **answer** two-run brief/connect/resume/provide/dismiss/send flow; **monitoring** settled secret commands; unknown replacement choices both include run. |
| R2-F1 / P1: enforce busy guard at config write | Fixed in `0e946b0`. Applied the user's ruling: recheck after reading value and pre-config status, immediately before PUT; both busy bots and queued/running work refuse. Early check remains, no force. | **answer** held stdin then late work; queued/running with idle bots. Residual non-atomic window documented in design, limits, decision 0015 and below. |
| R2-F2 / P1: do not infer credential write from an existing Boolean | Fixed in `dee213d`. GET before PUT; only false -> true can produce `verified` after an ambiguous failure. An already configured target stays unknown at exit 3 with no wake. | **answer** old value + failure before save, lost response and 503; both recovery choices; 4xx remains not saved. Native voice exception in `7c2a569`. |
| R2-F3 / P2: scope resumable blockers to owning run | Fixed in `512b8b6`. A known foreign owner is marked independently from ambiguous `shared`; foreign cards are omitted from stuck set, evidence and signature. | **monitoring** other open and closed owners leave done/evidence/carry unchanged; ambiguous ownership still blocks. |
| R2-F4 / P2: settled credential cards emit only resume | Fixed in `3389ab0`. Pending form remains provide/stdin or dismiss. | **monitoring** provided and dismissed resumables, exact complete resume command including run, no provide/dismiss. |
| R2-F5 / P2: credential-doc guard covers authoritative design | Fixed in `0ecec91`. Recursive docs scan; design describes user-owned 0600 file or the user's hidden shell read/export. | **docs** credential instruction regression failed on the old design and passes with all docs, including this report. |

## Additional audit findings and implementer concerns

| ID | Finding | Status | Verification |
| --- | --- | --- | --- |
| A01 | The connector dismissal's `send` hint still omitted run | Fixed in `7bf8ca7`. | **answer** two-run dismissal hint. |
| A02 | Provider validation can echo a submitted credential into HTTP error/verbose stack | Fixed in `f8e9d2c`. Redact exact submitted and trimmed values before constructing errors, including network text and parsed server replies. | **answer** injected 400/503 provider echo with whitespace, stdout/stderr/state/thread/fake leak checks. Source: `tts/elevenlabs.ts:42-55,66-75`, `index.ts:11899-11903`. |
| A03 | Fake accepted only nonempty credential strings and misrepresented ownership/cleanup/decision/result/alias cases | Fixed in `ca662dc`; optional section/type validation completed in `ed21622`. | **contract** all five config fields including clear and wrong type, empty sections and feature types, trusted skill owner/GET/DELETE, routine cancel/replay/run ID/client DELETE, missing alias exact 400 and failed status. |
| A04 | Pending/resumable-only connector family omitted dismissed/resumed/foreign siblings; stale family caused redundant resume POST | Fixed in `df7e2f1`. Read complete family from paginated thread, re-read after status GETs. Error hints acknowledge GET may already have woken the bot. | **answer** dismissed sibling, failed sibling, successful multi-app with no redundant POST, injected error after auto-wake. Source: `index.ts:6618-6622,12255-12276`. |
| A05 | Failed resume of a settled credential suggested provide/dismiss commands that cannot select it | Fixed in `5c0031b`. Retry resume, or restore a cleared credential in app then resume. | **answer** settled transient conflict/cleared config test. |
| A06 | `--secret-stdin` could be silently ignored with another mode; object prototype keys bypassed patch lookup | Fixed in `d0574c6`. Mode check and own-property allowlist before any mutation. | **answer** wrong-mode flag, unknown/constructor/toString targets. |
| A07 | System voice `tts.configured` is engine availability, not proof an ElevenLabs key exists | Fixed in `7c2a569`. Ambiguous write remains unknown; explicit resume uses server's credential check. | **answer** native voice unavailable + lost PUT response. Source: `tts/index.ts:28-36,57-63`, `shared/credential-request.ts:68-80`. |
| A08 | Missing edge coverage: stagedGone, four writable target patches, one-newline stripping, unreadable save readback | Fixed in `4f1b147` (empty inputs/dry-run blocking check in `d0574c6`). | **answer** target mapping and malformed-source tests, staged-gone 422, unknown readback/no wake. |
| A09 | Routine hint/docs claimed every refusal wrote `held` | Fixed in `a6060c7`. Only revalidation failures guarantee it. | **answer** mismatched payload ID 400 with absent `held`; **contract** bot/thread owner cases; API/design/SKILL corrected. |
| A10 | Fake staged-skill matching trusted fields mutated on the card rather than an independent staged record | Fixed in `6444977`. Stage metadata stored separately; mismatched fields refuse 422. | **contract** changed requestId/threadId/name/source/action; source `index.ts:6532-6542,6561-6570`. |
| A11 | Existing remote-identity watch test asserted checkpoint success after intentionally reaching an unverified deadline | Fixed in `b8aa65d`, test fixture only. Give lead a DONE reply and allow quiet confirmation; require a done verdict before asserting checkpoint. | Reproduced in full suite and isolated test, then targeted pass and full pass. No Phase 5 deadline/drain production changes. Existing unverified-deadline tests remain. |
| A12 | Implementer left status-unaware CONNECT brief and value-requiring credential recovery as follow-ups | Done before rescue in `42c2394`, `c9d05f9`; additional recovery/monitoring fixes above. | **monitoring** all connector states; **answer** saved credential resume without value and client scope behavior. |
| A13 | Implementer noted `stagedGone` untested and `status` omitting resumable | Fixed by `4f1b147` and earlier `209049a`/`aba96d0` plus `512b8b6`. | B13/B32. |
| A14 | Implementer reported skill local-hash deviation and no real-run evidence | Accepted design deviation preserved (B12); real-run evidence not applicable to this fake/source rescue. | No real turns, no `docs/evidence.md` change. Beads and orchestrator-owned state intentionally untouched. |

## Source contract boundaries and known limitations

- **Provider guard race:** `xai` and `opencodeGo` trigger fleet reload
  (`index.ts:12003-12042`), whose disposal interrupts active turns
  (`index.ts:7175-7207`). The server exposes no idle-conditional write.
  Whole-fleet and team-map checks immediately before PUT greatly narrow the
  race, but new work may start in the remaining millisecond read/write window.
  No force flag bypasses the guard. TTS/image credential sections do not reload
  the fleet; Box credentials remain app-only for their separate cloud effects.
- **No per-write credential receipt:** config status is configured state,
  not a value, fingerprint or write version (`index.ts:7125-7157`). The user's
  false-before/true-after rule is implemented. A concurrent external writer
  can still produce that transition; this is an inference from the Boolean
  API, not proof that our specific bytes were stored. Existing-key replacement
  and native voice readiness cannot verify an ambiguous write. Unknown exits
  3 and explicitly offers resume on whatever is stored or provide again.
- **Wake acceptance is asynchronous:** server code marks a card resumed
  before dispatching its continuation and can later attach an error
  (`index.ts:6624-6631,6767-6773,6838-6853`). Success acknowledges that path,
  not a completed bot turn. Monitoring exposes a failed wake and its owning
  run remains needs-user. A connector status GET can itself wake the bot;
  errors after earlier GETs cannot promise that no action happened.
- **Fake scope:** routes used by Phase 6 settlement and their implemented
  4xx texts were compared with the pinned source. The fake injects cards and
  account states rather than running skill staging, scheduler execution,
  provider reload processes, Composio's account catalog, or phone encryption.
  It does not simulate real skill disk commit/apply failures, races where a
  card disappears between server reads, every routine proposal validation,
  the 8/20 creation limits, or the internal bot/MCP creation routes. Those
  branches/limits are source-audited and documented; they are not asserted
  as integration-tested against a live 0.1.56 server. Fault control operations
  model lost responses and failed wakes and are explicitly test-only.
- **Credential storage:** the real server persists the submitted credential
  in its own config file (`config.ts:570-633`). The launcher's state, output
  and transcript do not store it. The fake holds configured booleans only.
  Redaction covers submitted values in error replies; no test uses a real
  credential or spends a subscription turn.
- **Scope of completion:** no new upstream behavior or Phase 5 watch redesign
  was introduced. No push was made. Beads status and steward handoff/progress/
  verification files are intentionally left for the orchestrator, as directed.

## Validation record

Rescue regressions were observed failing before their corresponding behavior
fixes. Focused node:test runs verified each concern. Full suites were serialized:
before each, `pgrep -f "node --test"` results were inspected; the ancestor Codex
process whose prompt contains that text is not another running test suite.

| Check | Result |
| --- | --- |
| Input baseline | `aba96d0`, reported 376 tests green; reviewed existing assertions and historical range. |
| First rescue full run | 378 tests, 377 pass, 1 fail, 0 skip. Failure was the remote checkpoint fixture (A11); also reproduced in isolation and corrected rather than hidden. |
| Subsequent full run | 395 tests, 395 pass, 0 fail, 0 skip; 85.606 seconds. |
| Final expanded full run | `npm test`: **398 tests, 398 pass, 0 fail, 0 cancelled, 0 skip, 0 todo**; exit 0; 86.954 seconds. Includes this report and the final operator/API/design guidance. |
| Whitespace and scope | `git diff --check` checked at each concern; final whole-range check and clean `main` checked at delivery. Only allowed decision 0015 changed under `.project-steward/`; `.beads/` untouched. |
| Processes and real evidence | No background service or real bot run was started for this rescue. Test-owned fake servers are closed by test cleanup; final process inspection checks for leftovers. |

No implementation finding is intentionally deferred. The limitations above
are constraints of the pinned server and the explicitly bounded fake/source
validation, not additional launcher work hidden behind a passing suite.

## Rescue commits

| Commit | Concern |
| --- | --- |
| `0e946b0` | Recheck fleet and queued/running work at credential write. |
| `dee213d` | Keep ambiguous existing-key replacement unknown. |
| `512b8b6` | Exclude foreign resumables from another run's verdict/evidence. |
| `3389ab0` | Settled credential briefs offer only resume. |
| `0ecec91` | Scan all design/review docs for unsafe credential instructions. |
| `7bf8ca7` | Preserve run in connector dismissal continuation. |
| `f8e9d2c` | Redact submitted credentials from config error output. |
| `ca662dc` | Align settlement fake ownership, scopes, results and 4xx contracts. |
| `df7e2f1` | Refresh complete connector families and avoid redundant resumes. |
| `5c0031b` | Keep settled credential recovery commands actionable. |
| `d0574c6` | Validate credential flags and exact target allowlist. |
| `7c2a569` | Separate native voice readiness from credential presence. |
| `4f1b147` | Cover remaining save and staged-skill edge cases. |
| `b8aa65d` | Make the existing remote checkpoint fixture reach a verdict. |
| `a6060c7` | Qualify routine held hints for ownership/payload refusals. |
| `ed21622` | Match optional config-field validation in the fake. |
| `6444977` | Bind fake skill approval to independent staged metadata. |
| This audit commit | Consolidate operator/API/design guidance and this requirement/review matrix. |

Every new commit ends with
`Co-Authored-By: Codex gpt-6-astra <noreply@openai.com>`.
