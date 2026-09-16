# Progress log

Add new entries at the top when the project reaches a meaningful checkpoint.
Do not record every edit.

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
