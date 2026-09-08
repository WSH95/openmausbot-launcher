# Plan

Milestones only. Beads owns the task list (`bd ready`); M1.1 is epic `oml-t8u`.

## M1: driver, skill, and launcher validation

Implementation exists. The specified `doctor`/`status`/`send` sequence is
not fully verified on Claude Code, Codex, and Grok; remaining gate:
`oml-axr.15`. Team packages are supplied inputs. `dev-team.openmaus.json`
is the external test configuration used for T12; its 8/9 package checks
remain in `docs/evidence.md` and do not block launcher acceptance
(Decision 0006).

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
