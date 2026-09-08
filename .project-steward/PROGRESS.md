# Progress log

Add new entries at the top when the project reaches a meaningful checkpoint.
Do not record every edit.

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

### 2026-09-08T03:31:16Z — cli
M1 complete: driver with 14 verbs and 62 tests against a contract fake; SKILL.md, five references, host checks on Claude Code, Codex, Grok; first real run T12 through dev-team 0.4.2 in 23 min (8/9 0.4.2 checks; ListAgents residual is the pack's). Next: the v2 beads (OpenClaw, Hermes, DSH verification; pair; macOS; request types; parallel runs; long SSE inside Codex's sandbox).

### 2026-09-08T02:56:15Z — cli
Driver complete through report (steps 1-10, 61 tests green, commits a8e4728..2dded2e); host spikes recorded in docs/evidence.md; next: references (11), hosts.md and SKILL.md (12), installs and the 0.4.2 validation run (13), dev pack follow-ups (14).

### 2026-09-08T01:57:08Z — project-steward init
Set up Project Steward in this repository.
