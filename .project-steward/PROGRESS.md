# Progress log

Add new entries at the top when the project reaches a meaningful checkpoint.
Do not record every edit.

### 2026-09-19T00:33:54Z — cli
Distribution: dist build tooling with 8 tests, public repo WSH95/openmausbot-launcher pushed with v0.1.0, registry PR agent-skills#6 opened (not merged); 598 tests green; two local commits unpushed pending permission

### 2026-09-18T23:59:01Z — cli
Team package authoring: SKILL.md §3 interview with a confirmed summary, references/team-authoring.md with a tested skeleton, and the offline validate verb; real-server parity check recorded; two code reviews applied; 590 tests green; host acceptance is the user's step

### 2026-09-18T21:34:40Z — cli
oml-xml closed at 6d772d3: test ports moved outside the kernel's ephemeral range (portBand), suite 523/523; only oml-hou remains; nothing pushed

### 2026-09-18T20:25:55Z — cli
oml-c37 closed: explicit invocation on every host that reads the switch, in-skill README, invocation guard, DSH and OpenClaw phone checks recorded with 0 bot turns; main at e49db12, nothing pushed

### 2026-09-18 — oml-c37: Codex rescue after the second review
The invocation guard now requires host delivery for an explicit request or
Hermes's skill tool; a copy found on disk must run no verb. The size test
examines every top-level key and calls the whole frontmatter nonconforming
because of its one extension. Routing tests pin the task action and the
exclusive error branch; README tests pin all prerequisite facts. Saved DSH
probes replace the earlier credential failure as its result: no injection on
the ordinary message; injection and two read-only commands on the explicit
one. The before/after comparison names only the four hosts that ran it;
five hosts read the checkout, and OpenClaw remains unexercised.

Work is uncommitted on `main` at `e0d7735`, for the coordinator's Opus
completeness review. No host CLI or live server ran and no OMB bot turn was
spent. Three mutation/restore cycles caught the intended regressions and
restored to 520/520 each; the final working-tree suite passed 520/520 in
112.4 s. An unrelated lifecycle port collision is filed as `oml-xml`.
Validation is in `VERIFY.md` and the coordinator scratchpad's
`rescue-report.md`.

### 2026-09-18 — oml-c37: explicit invocation on every host that reads the switch, and a README in the skill
Hermes is implicit by design; the OpenClaw phone form was verified from the
user's phone later the same day.
`disable-model-invocation: true` in the SKILL.md frontmatter,
`allow_implicit_invocation: false` in `agents/openai.yaml`, a routing
paragraph in SKILL.md §1 for the request that arrives with the invocation,
and a new `skills/openmausbot-launcher/README.md` for the person installing
the directory. Four tests went red first — three new ones plus the credential
scan, once the README joined its file list — while the fourth new test, the
one that pins docs/design.md to the shipped frontmatter, passed before the
edit and caught the drift during it. The Claude Code, Codex, Grok Build and
Hermes checks ran the same ordinary-language prompt before and after the key
and read each host's own record: Claude Code 2.1.276, Codex 0.155.0 and Grok
1.0.34 no longer inject the skill and each explicit form still runs exactly one
`status` (exit 3, no team); Hermes v0.21.3 loads it either way, as intended.
DeepSeek Harness 0.1.5-rc.1 subsequently completed two after-edit probes:
no injection or driver command on the ordinary message; injection and two
read-only commands (`state --show`, then `status`) on the explicit form. Its
key was read by a wrapper from a 0600 file; the four earlier launches, before
the key file was found, failed before inference. Zero OpenMausBot bot turns,
isolation checked before and after. The OpenClaw phone form was verified from the user's phone afterwards (six
messages, six approval cards, 0 bot turns; `docs/evidence.md`). Two negatives (Codex, DSH) showed an uninvoked model
reading `SKILL.md` off disk, so §1 now refuses to run a verb without an
invocation marker. Original implementation checkpoint: `4d166ec`; 520/520.

### 2026-09-17 — oml-0vr: the receipt-change drain test ends on its condition
The one loaded failure the rescue saw in `tests/watch-drain.test.mjs:417` was
a test that gave the watch 80 ms for an `fs.watch` notification and a re-read.
The test now wraps the real watcher so the held read is released only after
the receipts callback ran, and ends with `until: change` at the receipt
re-read; suppressing the callback's `invalidate` makes it fail on the stale
terminal result, and removing the write fails its staging guard. One
gpt-6-astra plan review (which found that the fixture's first view is already
terminal, so a seeded signature alone could not wait), an Opus implementer,
one gpt-5.6-sol code review (one diagnostic fix). 20/20 loaded runs, 516/516.
`main` at `2c409af`. Only `oml-hou` remains open.

### 2026-09-17 — Several projects on one machine: bind, up and down guards
The user asked whether several projects can use the skill with the same team
package. The file is only read; a shared server was the risk, and three
unguarded paths were filed and fixed (`oml-jpu`, `oml-1gd`, `oml-6kr`):
`bind` and `facts` refuse a team configured for another project's folder
unless `--take-over` is passed; `up` names the other folders a shared server
carries, logs each attempt to its own file, and translates upstream's
data-directory lease refusal; `down` refuses under other work it can observe
unless `--stop-others` is passed, with a bounded read-only look at other
projects' state files. `main` fast-forwarded from `8fc6828` to `73c623c` (ten
commits); 516/516. The pipeline ran in full: two gpt-6-astra plan reviews,
Opus implementation, two gpt-5.6-sol code reviews, a gpt-6-astra rescue under
the two-rounds rule, an Opus completeness review (COMPLETE), and three small
hardenings from its observations. Record:
`docs/review/2026-09-17-multi-project-guards.md`. Filed and left open:
`oml-0vr` (a watch-drain test failed once in about fourteen loaded runs).
Nothing pushed, no bot turn.

### 2026-09-17 — Real-server confirmation of the watch and report output (2 bot turns)
The handoff's remaining next step was done at the user's request. Real
OpenMausBot 0.1.56 was started on the T14/T15 data directory, the team adopted
and bound, and two probe runs, V16 and V17, were opened at once with briefs
that asked the lead only to acknowledge: 2 bot turns, both Sudo's. Opening V17
stopped V16's stored verdict from carrying, and closing V16 did the same to
V17, which is the `oml-fg8` sequence. Each time `report` left the run open
with the settlement hint, a short watch (8 s, then the original 20 s) reported
the idle time it observed with the budget hint and `checkpointed: true`, an
adequate watch (40 s, then the documented 35 s) settled `done`, and the second
report closed the run. Server stopped, ports free, clone unchanged. Record:
`docs/evidence.md` and `docs/validation/2026-09-17-watch-budget-v16-v17.json`.
The stale `PLAN.md` "Later" section was corrected. An 11-hour-old hung
`npm test` under `codex-linux-sandbox`, left by an earlier session, was killed
at the user's request.

### 2026-09-17 — Follow-up: oml-47p and oml-507 closed
The user asked why the two beads filed during the repairs were left open, so
they were closed the same day. `main` fast-forwarded from `88a319e` to
`c769e53` (three commits from `fix/oml-47p-507`); the merged tree passed
466/466 in 80.1 s. Nothing was pushed and no bot turn was spent.

`oml-507` is a test-only repair: the cleanup test now waits for the child's
confirmed `chdir()` on a held clock instead of a 100 ms grace. `oml-47p`'s
second half is fixed: a startup whose readiness guard reaches the deadline a
millisecond early now ends as the normal unverified timeout instead of a
thrown error. Its first half is closed as an accepted limit: two designs for
the quiet- or poll-bound wake just before the deadline were blocked in
gpt-6-astra plan review, the present unverified timeout is accurate, and it is
documented in `references/limits-and-pitfalls.md` and `docs/design.md`. Only
`oml-hou` (macOS) remains open.

### 2026-09-17 — Watch budget, report attribution and timing repairs merged
The three non-macOS beads and one found on the way are closed: `oml-fg8`,
`oml-j4r`, `oml-2rc`, `oml-jc1`. `main` fast-forwarded from `2234084` to
`0278dfd` (eight commits from `fix/oml-fg8-j4r-2rc`); the merged tree passed
464/464 in 81.5 s. The worktree and both merged branches were removed. Nothing
was pushed, no OpenMausBot server was started and no bot turn was spent.

`oml-fg8` was not an attribution defect. After T14 closed, every
`watch --run t15` ran 8 to 20 s against the 30 s quiet window, so it returned
its first evaluation, `idle for 0 s`. A timeout now reports the idle time it
observed; `watch` adds a budget hint, and `report` a settlement hint, only
where the quiet window alone would settle the run (`quietSettles`). `oml-jc1`
made reaching the deadline in the idle wait an observation boundary, which
removed the unverified timeouts that about one in eight loaded watches hit.
`oml-j4r` rewrote task-log and merged-commit attribution so that nothing is
attributed by guess. `oml-2rc` replaced two timing guesses with conditions;
two of its four listed tests had already been repaired.

The user's pipeline ran in full: two gpt-6-astra plan reviews, an Opus 5
implementer, two gpt-5.6-sol code reviews, then the two-rounds rule (a
gpt-6-astra rescue and an Opus 5 completeness review, which found one last
gap in merge denial forms). The record is
`docs/review/2026-09-17-watch-budget-report-attribution.md`. Filed and left
open: `oml-507` (a 100 ms grace guess in `tests/repo.test.mjs`) and `oml-47p`
(two remaining near-deadline reads that return unverified).

### 2026-09-17 — OpenClaw Telegram rotation integrated into main
The user chose local integration. `main` fast-forwarded from `5940e89` to
`581188e`, including the security checkpoint. The merged tree passed all 404
tests under `omb-loopback-dev` in 88.498 s. The clean feature worktree was
removed, its fully merged branch was deleted with `git branch -d`, and nothing
was pushed. Bead `oml-8v0` remains closed.

The first pre-merge full run passed 403/404 and hit the existing timing-shaped
watch failure tracked by `oml-2rc`. The same test passed alone, the next
feature-branch full run passed 404/404, and the post-merge run above also passed
404/404. The recurrence was added to `oml-2rc`; this documentation-only branch
made no production or test code change.

### 2026-09-17 — OpenClaw Telegram bot rotation completed
The screenshot-exposed token was independently confirmed revoked before the user
created `OpenClaw Laptop` (`@WSHOpenClawLaptopBot`, id `8904072141`). Its privately
staged replacement passed a token-safe probe and atomically replaced the 0600 token
file; subsequent DM/channel checks passed. The gateway remains active with
pairing-only DMs and OpenClaw group processing disabled; the user kept BotFather
group joining enabled.
The prior validation bot was deleted after the DM gate. This was infrastructure
validation with zero OpenMausBot server starts and zero OMB bot turns. Bead
`oml-8v0` is closed; no secret is recorded and nothing was pushed.

### 2026-09-17 — Codex loopback profile integrated into main
The user chose local integration. `main` fast-forwarded from `c156e59` to
`20ac090`, including feature commit `06c28e6`. The merged tree passed all
404 tests under `omb-loopback-dev` in 104.512 s. The clean feature worktree
was removed, its fully merged branch was deleted with `git branch -d`, and
nothing was pushed. Bead `oml-9mc` remains closed.

### 2026-09-17 — portable Codex loopback profile (code and host probe, no bot turns)
The installed skill now includes an opt-in Codex permission profile that
extends `:workspace` and allows only `127.0.0.1` and `localhost`; it never
edits or selects user configuration. The repository has a separate,
non-default maintainer profile whose only extra host is `127.0.0.2` for the
fake proxy scenario. The HTTP client preserves the caller's two proxy-bypass
variables, deduplicates them case-insensitively, adds the two consumer hosts
only for loopback URLs, and leaves remote clients unchanged. Host instructions
cover install, selection, legacy sandbox precedence, smoke checks, rollback,
managed-policy failure, and scoped fallbacks.

Codex CLI 0.154.0 loaded the consumer template from a clean temporary home;
the real HTTP client listened and connected locally while an unlisted public
request remained blocked. The final profile-backed suite passed 404/404 in
90.591 s, the focused contracts passed 14/14, the diff check was clean, and
the skill remained 349 lines. Independent review's two findings (legacy
sandbox precedence and the `workspace_roots` contract) were fixed; re-review
reported no remaining findings and `Ready to merge: Yes`. Bead `oml-9mc`.
No OpenMausBot server, bot turn, user configuration mutation, or push.

### 2026-09-17 — v2 pass, phase 7: the real-server session (34 bot turns, 3 native sessions)
Real OpenMausBot 0.1.56 on the slugkit clone with the user's roster: the
three request kinds the driver can settle without Composio were exercised
on Nova (a routine confirmed, created and deleted; a learned skill allowed
against the hash the operator verified, installed and deleted; a credential
provided from a private file through stdin, saved, resumed and cleared, with
the value absent from every launcher surface). The lead created a second
implementer, Forge, which `import --adopt` and `bind` picked up before any
dispatch. T14 (Nova) and T15 (Forge) ran as two open runs: T15 was dispatched
while Nova worked, Forge's turn overlapped Quill's review of T14, lead turns
serialized; 17 of Quill's approval cards allowed once (19 user-approved
decisions with Nova's two, none "always"). T14 merged as `c7554a5`, T15 as
`11ff1e6` after a rebase Quill asked for; both beads closed by the lead. Both
reports read `incomplete` on the record step because the lead's Codex
harness refused the record commit (the operator committed the staged records
as `ddd4684`). OpenClaw and Hermes each ran a `watch` against the live run
and read it back. Inside Codex's workspace-write sandbox the watch cannot
connect at all (EPERM, no escalation requested), so long SSE there is a
documented restriction, not evidence. New defect from the run: the last open
run never settles after its sibling closes (`oml-fg8`, closed by abandon).
Evidence: `docs/evidence.md` "v2 validation" and
`docs/validation/2026-09-17-parallel-t14-t15.json`. Pass total: 39 of 50
bot turns. Beads `oml-no8`, `oml-170`, `oml-u1j` closed on this evidence;
`oml-hou` (macOS) stays open for the user's decision.

### 2026-09-17 — v2 pass, phase 6: `answer` settles skill, routine, secret and connector requests (code, no bot turns)
`answer` moved into its own module and now settles the four request kinds it
used to hand back at exit 5: routine proposals (`--confirm`/`--cancel`, a
revalidation refusal reported in the server's words), learned skills
(`--allow --reviewed <sha256>`/`--deny`, the hash checked against the card
before anything is posted), credentials (`--provide` from a user-owned file
through `--secret-stdin` or from `OMB_SECRET` exported in the user's own
shell, `PUT /api/config` and then the card's `provided` route; `--resume`
finishes a saved card without the value; `--dismiss`) and connections
(`--connect` returns the one-time link at exit 5, `--resume` refreshes only
authorized siblings, `--dismiss` wakes nobody). A provider key (`xaiApiKey`,
`opencodeGoApiKey`) is refused while any bot on the server is busy, because
saving it restarts every provider; a settled card whose wake failed keeps its
run at `needs-user` under `resumable`. Two Codex reviews (seven, then five
findings) and then, under the two-rounds rule, a Codex `gpt-6-astra` rescue
(18 commits, audit `docs/review/2026-09-16-answer-kinds-rescue.md`) and an
Opus completeness review (one verification gap, closed by `5217d71`).
Commits `c94b6ef`..`5217d71` (35 from `186baf2`); `npm test` 399/399;
DECISIONS 0015. Not yet a real run: Phase 7 exercises routine, skill and
secret on the real server; the connector kind stays fake-only unless
Composio is configured.

### 2026-09-16 — watch rescue follow-up after the first drain repair
The independent audit of `0492520` reproduced additional final-await,
checkpoint cancellation, quiet-reset, card-lifecycle, historical-read,
stream-budget and delegation-drop gaps. Failing-first regressions preceded
the fixes; the first focused run had 21 failures and its repaired successor
passed 60/60, followed by additional direct regressions. The final source
preserves the bounded drain and all original assertions, including both
actual two-run watches against the HTTP fake. Design and the final path
matrix are in `docs/design.md` and
`docs/review/2026-09-16-watch-drain-followups.md`; full verification is in
`VERIFY.md`. Three independently written regression files remain unstaged
by this invocation; their four tests are included in workspace counts.
No new bot turns or push. Phase 7 still owes real two-run validation.

### 2026-09-16 — v2 pass, phase 5: several runs per team (code, no bot turns)
The state document is version 2 and holds `runs`: each run owns its worktree
and branch from dispatch, claims an implementer the launcher bound, is
addressed with `--run`, is observed through a per-run view, and is reported
and closed on its own. One delivery path switches the lead's active task and
never retargets a message. The Codex review (thirteen findings, then two,
then three) hardened attribution, watch quiet scoping, report matching and
worktree ownership; under the new rule for tasks still open after two rounds,
Codex (`gpt-6-astra`) then rewrote the watch drain: frames are classified at
arrival, a changed attribution must be confirmed, and an exhausted drain
returns visible `running`/`unknown` instead of a verdict (commit `0492520`,
audit `docs/review/2026-09-16-watch-drain-rescue.md`). Commits
`4d853c8`..`0492520`; `npm test` 303/303. Not yet a real run: Phase 7 owes the
two-run validation. Flaky-test bead `oml-2rc` filed (one of the two flakes
fixed on the way).

### 2026-09-16 — v2 pass, phase 4: the `pair` verb and the Tailscale remote run (2 bot turns)
Seventeen verbs now: `pair` exchanges a pairing code into the 0600 token file
under a lock held across the exchange (Codex review finding), never prints the
token, and replays a lost response by `attemptId`. The doctor now names a
blocked socket (`oml-60s`). The real run over Tailscale (`serve --tailscale`,
`wsh.taila20f43.ts.net`) minted owner and client sessions, ran the remote verb
set with each, refused tokenless and client-scope requests with the server's
words, and exposed a binding rule that tied a state file to one URL
(`oml-9kp`, fixed: the environment id is the binding, the URL only in local
mode); afterwards a locally opened run was watched and interrupted through the
tunnel. Records: `docs/evidence.md` "v2 remote run",
`docs/validation/2026-09-16-remote-tailscale.json`. Commits `c0f325a`..`5b50770`;
`npm test` 221/221. Beads `oml-xnn`, `oml-60s`, `oml-9kp` closed. No push.

### 2026-09-16 — v2 pass, phases 1-3: OpenClaw, Hermes Agent and DeepSeek Harness verified (3 bot turns)
Installed OpenClaw 2026.9.4 (on a side-by-side Node 24.21.0), Hermes Agent
(pyproject 0.21.3) and dsh 0.1.5-rc.1; OpenClaw and Hermes run on the user's
Codex OAuth login, dsh on a DeepSeek key kept in a 0600 file. Each host found
the skill and ran doctor, server doctor, status and one acknowledged send
against real OpenMausBot 0.1.56 (one bot turn each). OpenClaw's Codex harness
refuses `tools.exec.mode=allowlist` and raises one approval card per command
(allow-once); the Telegram phone path and the `--announce` automation were
verified (an empty output is not delivered); Hermes needs
`skills.external_dirs` and its cron adapter runs through the Hermes gateway;
dsh's shell has its own PID namespace, so live verbs need `--remote`. Both
open questions answered; `oml-n2f` and `oml-5bw` closed; a new defect
`oml-60s` (doctor --server cannot name a blocked socket) filed. Records:
`docs/evidence.md` "v2 host verification",
`docs/validation/2026-09-16-hosts-v2.json` (commit `25fada3`). Phase 0's
"not bundled" note landed as `246ec66`. Tailscale is installed and logged in
with HTTPS certificates for the Phase 4 remote run. No push.

### 2026-09-08 — M1 fix pass complete: 26 findings fixed, T13 full-team run, epic closed
Fixed every finding of the M1 review (`oml-nqo`), test first and one commit
each (`ddcafb5`..`6f0cd58`); suite 197 passed (154 before). Closed the
evidence findings on the tier 2/3 records. Killed the stray
`codex-linux-sandbox` pid 426150 at the user's decision after re-verifying
its identity; recorded in `docs/evidence.md`. Ran the full-team validation
T13 (max_words) on the slugkit clone through the fixed driver with the
user's roster (Codex lead, Sonnet, Codex, Opus, Grok): run
`6b0b7b17800c3d64`, incomplete, 9 turns, 16 min 38 s, 7 Grok cards allowed
once, one operator `send` that unblocked the merge gate, `--check-042` 8/9
scored from the Codex lead's native log, reconcile clean, cleanup found no
orphan, `down` verified. Evidence in `docs/evidence.md` and
`docs/validation/2026-09-08-fix-pass-t13.json`; devpack `EVIDENCE.md`
pointer committed locally (`ab94d6d`) and `atw-07l.27` noted — the gate is
met. Documentation drift resolved (README, design, evidence corrections,
references, AGENTS.md, bead titles) with `tests/docs.test.mjs` as the guard.
`oml-nqo` closed. One further defect surfaced by the pass's own suite runs,
`oml-oqo`, was fixed on the user's instruction (`02e7945`): the budget guard
and the watch loop disagreed about a sub-millisecond remainder, so `watch`
could exit 1 instead of 4. Suite 198. No push.

### 2026-09-08 — M1 review complete: all four tiers, 26 findings, no repairs
Finished the independent review and test of M1 (`oml-nqo`). Tier 3 spent
**5 Sudo turns and 1 Sage turn** on run `d0a01943d403c7af` against real
OpenMausBot 0.1.56 and exercised the relay path end to end: an approval card
raised and denied (`rejected`), the `approvePeerComms` peer card
"@Sudo wants to contact @Sage" allowed once and answered with PONG by Sage, a
working bot interrupted (`interrupted: true`, idle in 1 s), a background
`watch --max-seconds 570` returning after 60 s at the next terminal state
concurrently with a foreground watch, and `report --md` closing the run
`passed` followed by `report --run last` in both modes. Only Sudo and Sage have
event files; no delegation occurred.

Records written: `docs/review/2026-09-08-m1-review.md` (verdict, per-tier
counts, the 26-finding table, what was verified for the first time on real OMB,
what is still unverified, and a fix order), two `docs/evidence.md` sections for
Tiers 2 and 3 with the `report --md` block, and
`docs/validation/2026-09-08-m1-review.json`.

Two documented claims did not survive the test: `up` does not name the sandbox
cause in its hint on a real sandboxed failure, and Codex cannot run `status`
from inside workspace-write. Both are filed. Findings 1-26 all stay open; the
tier tasks `oml-nqo.23` and `oml-nqo.24` are closed. Per the user's decision
this pass filed findings and fixed nothing, so the suite stays at 154 tests.
The devpack gate `atw-07l.27` (one more full-team run) remains unmet and no
file under that repository was touched.

### 2026-09-08 — M1 review Tier 2 done: real OpenMausBot, zero bot turns
Ran the Tier 2 sequence against real OpenMausBot 0.1.56 on port 8893 in a
fresh `/tmp/oml-review-t2-CGG7JR` fixture, spending **no bot turns**. `doctor`
5/5, `doctor --server` 10/10, `up --fresh`, `import` (release 0.4.2, lead Sudo
`414ffd78…`), `bind` with the five per-bot selections, `facts`, `status`, and
`import --adopt` into a second project — the first real-server run of
`--adopt`. Provider keys and `OMB_TOKEN` were proven absent from both server
processes, including a self-contained check that exported three decoy keys in
the launching shell.

Closed the design's host-check gaps: Grok Build and Codex CLI each started the
**real** server, which outlived the host process and was stopped by `down`
from this shell; Codex under `workspace-write` failed with `listen EPERM` as
designed; Codex `read-only` listed the skill; Codex `workspace-write` proved
the state file writable; and `claude -p "run T10 through the team"` loaded the
`openmausbot-launcher` skill as its first tool call. `${CLAUDE_SKILL_DIR}`
resolves by load-time text substitution, not an environment variable.

Five new findings came out of the tier and are filed as `oml-nqo.26`–`.30`:
the `bind` roster printing `(undefined)`, `up --port N` silently occupying
N+1, `logTail`'s 12-line window defeating the sandbox hint, `import --adopt`
omitting the git exclude entries (leaving the adopted project unreconciled),
and a blocked network reported as an identity failure. The last is the
artifact finding 5 asked for. No source, test or reference file was changed.

### 2026-09-08 — M1 review started; Tier 0 and Tier 1 done
Independent review and test of M1 at HEAD `b1a1f77`, under Beads epic
`oml-nqo` (plan `~/.claude/plans/based-on-the-development-lucky-shell.md`).
Twenty findings filed as `oml-nqo.1`–`.20` (finding N is `oml-nqo.N`) plus one
more, `oml-nqo.25`, discovered during the test run; the four tiers are
`oml-nqo.21`–`.24`. Per the user's decision, findings are filed and not fixed
in this pass. Tier 0 (suite and static checks) and Tier 1 (21 scripted steps
against the fake server, 211 assertions) both completed with no repository
change: 154/154 tests, every hash check verified, and 209 of 211 assertions
matching the plan. The two deviations are recorded in `VERIFY.md` with a
verdict each — one plan error (`watch --nudge` exits 6, not 4) and one low
driver defect (`status` drops its computed `carried` flag). Tiers 2 and 3,
which spend real OpenMausBot turns, remain open.

### 2026-09-08 — M1 host evidence complete
Claude Code 2.1.263, Codex CLI 0.153.4 and Grok Build 1.0.13 each executed
the specified doctor/server-doctor/status/send checks and observed a unique
Sudo acknowledgment on real OMB 0.1.56. The operator supplied the text;
native CLI shell tools executed the commands; OMB stored user-role messages.
This distinction was clarified after the user challenged the sender wording.
All five requested model bindings were read back; only Sudo ran (three OMB
turns). The other models and a new full-team workflow were not exercised.

Claude exposed status dropping the conversation when no launcher task was
open. Added a failing regression, returned the already-hydrated messages
and tail without a task verdict, then resumed Claude observation without
resending. Focused tests 5/5; full suite 154/154 in 52.225 s. Native CLI
restrictions and initial no-send invocation failures are recorded alongside
the successes in docs/evidence.md and its structured extraction. Final
cleanup found a clean fixture, one worktree and no orphan candidates; owned
PIDs are gone and health refuses connections. The external package hash and
T12 archive are unchanged. M1 and oml-axr.15 are complete; no pushes.

At the user's suggestion, read agent-team-devpack's setup guide and evidence
for engine probes, delegation and the T12 run. Those distinguish native
launcher command checks from bot model execution and the full team loop.
Retained those separate claims; did not substitute historical models for
validation of the new roster. No changes were made in that repository.

### 2026-09-08 — M1 host validation started
The user approved completing M1 and implementing the host validation plan.
Claimed `oml-axr.15`. Use the unchanged external dev-team test package in an
isolated temporary project with a fresh real OMB 0.1.56 server. The requested
bindings are Sudo: gpt-5.6-luna/high; Sage: claude-sonnet-5/high; Vale:
gpt-5.6-terra/high; Nova: claude-opus-5/high; Quill: grok-4.6/medium.
Each native host will run doctor/status/send and confirm a unique leader
acknowledgment. All five roles are configured; only the leader needs bot
turns for these checks. No package edits or pushes.

### 2026-09-08 — Team package scope corrected
The user clarified that `dev-team.openmaus.json` is an external test
configuration. Verified that import takes the supplied path and discovers
the roster and lead, and that `--check-042` is explicitly requested. Corrected
the design, README, charter, M1 scope and `oml-axr.15`: the remaining task is
host command evidence; package edits and a 9/9 package score are not launcher
acceptance requirements. Decision 0006 supersedes that part of the previous
checkpoint. T12's original result is preserved. The 50 existing import/report
tests passed in 7.119 s, with a clean diff check. Documentation and tracking
only; no new bot turns, package edits or pushes. Correction: `oml-qh7`.

### 2026-09-08 — Current state verified for the requested local commit
User requested a commit of the current state. Re-ran `npm test`: 153 passed,
0 failed, 0 skipped in 49.324 s; `git diff --check` passed. The checkpoint
includes the M1.1 repairs, tests, evidence, project records and corrected Git
policy. No push. M1's remaining task `oml-axr.15` still requires full host
command evidence and resolution of the 8/9 pack-validation residual; the
repair plan excluded new bot runs and dev-pack changes.

### 2026-09-08 — Git policy corrected at the user's request
Local Git operations and tested commits are permitted. Every `git push`
requires explicit user permission, including automated and force pushes.
Corrected AGENTS.md/CLAUDE.md and the Beads hook through its supported
project PRIME.md override; `no-git-ops` is false and automated pushes remain
disabled. The earlier blanket ban is superseded by Decision 0005. No
driver code or bot runs changed; policy verification is tracked in `oml-2d5`.

### 2026-09-08 — M1.1 repairs verified
Implemented the approved repair under `oml-t8u`. Final `npm test`: 153 passed,
0 failed, 0 skipped (49.038 s, Node 24.11.0). Independent reviews approved
state serialization, conservative monitoring, command safety, cleanup,
report evidence and operator documentation after regression fixes. Offline
T12 reanalysis attributes Vale's approval to 03:10:22.421Z and preserves the
ListAgents residual and original incomplete result. No new bot turns or
project Git operations. Formal M1 validation is reopened in `oml-axr`, with
remaining evidence in `oml-axr.15`; the repair completion is separate.

### 2026-09-08 — M1.1 repair review checkpoint
SQLite serialization and conservative monitoring passed their focused regressions and independent review (`oml-t8u.1`, `.3` closed). Command, report, and cleanup repairs are implemented; independent reviewers found remote receipt contamination, optional index writes during previews, and qualified-approval false positives. Regression tests reproduced each; fixes are in progress before the integrated suite. No new bot turns and no project Git operations.

### 2026-09-08 — M1.1 implementation started
User approved the revised review plan. Repairs are tracked in Beads epic `oml-t8u`. SQLite replaces the unsafe directory lock; dry-run, monitoring, card, identity, cleanup, and report regressions follow. No paid bot runs. The active session hook forbids Git operations, so changes remain uncommitted. A source baseline for independent comparison is `/tmp/oml-m1-baseline-tzs2tgl8`.

### 2026-09-08T03:31:16Z — cli (superseded: see the M1 review entries above)
M1 complete: driver with 14 verbs and 62 tests against a contract fake; SKILL.md, five references, host checks on Claude Code, Codex, Grok; first real run T12 through dev-team 0.4.2 in 23 min (8/9 0.4.2 checks; ListAgents residual is the pack's). Next: the v2 beads (OpenClaw, Hermes, DSH verification; pair; macOS; request types; parallel runs; long SSE inside Codex's sandbox).

### 2026-09-08T02:56:15Z — cli
Driver complete through report (steps 1-10, 61 tests green, commits a8e4728..2dded2e); host spikes recorded in docs/evidence.md; next: references (11), hosts.md and SKILL.md (12), installs and the 0.4.2 validation run (13), dev pack follow-ups (14).

### 2026-09-08T01:57:08Z — project-steward init
Set up Project Steward in this repository.
