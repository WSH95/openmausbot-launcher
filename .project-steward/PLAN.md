# Plan

Milestones only; the task list lives in beads (`bd ready`, epic `M1` and its
fourteen step tasks, one per implementation step in `docs/design.md`).

## M1: driver, skill, and the 0.4.2 validation run

The fourteen implementation steps of `docs/design.md`, one commit each:
scaffold; contract fake and harness; state store; HTTP and lifecycle with
the detached-survival spike; git helpers; import, bind, facts; snapshot and
evaluation; task, send, answer, interrupt; watch; report with `--check-042`;
references; hosts and the final SKILL.md; installs, host checks, and the
0.4.2 validation run; dev pack follow-ups.

Exit criteria: `npm test` green on the fake; `doctor`, `status`, and one
`send` verified from Claude Code, Codex, and Grok Build; one real task run
recorded in `docs/evidence.md` with `report --check-042` passed; the dev
pack's `docs/setup-guide.md` points at the skill.

## Later

- OpenClaw, Hermes, and DSH verified (install, phone recipes, `--announce`
  on empty output).
- `pair`, macOS lifecycle, the unsupported request types in `answer`,
  parallel runs per team.
