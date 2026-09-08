# Plan

Milestones only. Beads owns the task list (`bd ready`); M1.1 is epic `oml-t8u`.

## M1: driver, skill, and launcher validation

Complete (`oml-axr`, final evidence in `oml-axr.15`). Claude Code, Codex CLI,
and Grok Build each executed doctor/server-doctor/status/send and observed
the matching leader reply on real OMB 0.1.56. These were operator-authored
user-role sends through each native CLI. All five requested bindings were
configured; only Sudo ran, for three OMB turns. This was not a new full-team
task or execution of the other four models. The standalone-status defect
found during validation is fixed; all 154 tests pass. See `docs/evidence.md`
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

## Later

OpenClaw, Hermes, and DSH installation and phone recipes remain unverified.
The existing v2 beads cover pairing, macOS lifecycle, unsupported request
types, and parallel runs. Any proposed package changes belong to that
package's project and are not prerequisites for launcher validation.
