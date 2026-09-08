# Plan

Milestones only. Beads owns the task list (`bd ready`); M1.1 is epic `oml-t8u`.

## M1: driver, skill, and the 0.4.2 validation run

Implementation exists. Formal validation remains incomplete: T12 recorded
8/9 pack checks, with a ListAgents residual, and the specified
`doctor`/`status`/`send` sequence is not fully verified on Claude Code,
Codex, and Grok. Evidence: `docs/evidence.md`; remaining gate: `oml-axr.15`.

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
types, and parallel runs. Pack fixes remain in the dev-pack repository.
