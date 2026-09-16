# Plan

Milestones only. Beads owns the task list (`bd ready`); M1.1 is epic `oml-t8u`.

## M1: driver, skill, and launcher validation

Complete (`oml-axr`, final evidence in `oml-axr.15`). Claude Code, Codex CLI,
and Grok Build each executed doctor/server-doctor/status/send and observed
the matching leader reply on real OMB 0.1.56. These were operator-authored
user-role sends through each native CLI. All five requested bindings were
configured; only Sudo ran, for three OMB turns. This was not a new full-team
task or execution of the other four models. The standalone-status defect
found during validation is fixed; the full suite passes (`VERIFY.md`). See `docs/evidence.md`
and its structured native command evidence. The server is stopped.

Team packages remain supplied inputs. `dev-team.openmaus.json` is the
unchanged external test configuration; T12's historical 8/9 package checks
remain separate from launcher acceptance (Decisions 0006 and 0007).

## M1.1: correctness review repairs

Complete: 153 tests pass and independent reviews approved; see `VERIFY.md`.
SQLite serialization, mutation-free previews, real card classification,
conservative monitoring, verified server identity, safe cleanup, and offline
historical report evidence. Completion requires focused regression checks,
independent review, integrated tests, archived T12 attribution reanalysis,
and current operator/design/handoff documents. Details and status are in
`oml-t8u`; this pass spends no new bot turns or host validation runs.

## M1 review and fix pass

Complete (`oml-nqo`, closed 2026-09-08): 26 findings filed by the independent
review of `b1a1f77` and fixed test-first in one pass; real OpenMausBot 0.1.56
exercised in three tiers plus the full-team run T13 through the fixed driver
(`docs/review/2026-09-08-m1-review.md`, "Resolution"; `VERIFY.md`, "M1 fix
pass"). The devpack gate `atw-07l.27` is met.

## v2 pass (2026-09-16, in progress)

Seven beads in one pass, hosts first: OpenClaw, Hermes Agent and DeepSeek
Harness verified (`oml-n2f`, `oml-5bw` closed); the `pair` verb and a
Tailscale remote run (`oml-xnn`); more than one run per team (`oml-no8`);
`answer` for skill, routine, secret and connector requests (`oml-170`); long
SSE inside Codex's sandbox (`oml-u1j`); macOS lifecycle only if a Mac turns
up (`oml-hou`). Defect found on the way: `oml-60s`. The plan and its Codex
review live in the session plan file; progress in `PROGRESS.md`.

Phase 5 (several runs per team, `oml-no8`) is merged on `main` at `0492520`;
the final follow-up audit is
`docs/review/2026-09-16-watch-drain-followups.md`, which supersedes the first
rescue audit. The repair checkpoint adds fake-server and boundary
regressions; the bead stays open until the real two-run exercise (Phase 7).
Its backend task record was not updated in this follow-up; this task
prohibits Beads commands. The existing task remains the reconciliation point.

## Later

OpenClaw, Hermes and DSH are verified as of 2026-09-16 (see the v2 pass).
The remaining v2 beads cover pairing, macOS lifecycle, unsupported request
types, and parallel runs. Any proposed package changes belong to that
package's project and are not prerequisites for launcher validation.
