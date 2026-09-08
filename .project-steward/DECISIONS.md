# Decisions

Record decisions in order. Include the reason, the choice, and its practical
effect.

## 0001 — 2026-09-08T01:57:08Z — Adopt Project Steward

Context: Project work needs to survive changes of agent, tool, or device.

Decision: Keep project state in `.project-steward/`. Use `AGENTS.md` for
shared instructions and `CLAUDE.md` as a small Claude Code adapter.

Consequences: Git carries the files needed to resume the work elsewhere.

## 0002 — 2026-09-08 — Standalone repository, scope, and the design's hard rules

Context: the launcher role for OpenMausBot lived only in a Claude Code
session's memory and scratch scripts in `~/Documents/agent-team-devpack`.
The user chose a new repository (that repository stays the pack's home,
its Decision 0009; `agent-team-cli` excludes any OpenMausBot dependency),
documentation-only coverage for OpenClaw, Hermes, and DSH this round, and
the same-machine topology.

Decision: build `openmausbot-launcher` as one skill directory with a
dependency-free Node driver, as specified in `docs/design.md`. Hard rules
carried from two Codex review rounds: settled-then-classify completion with
a run-specific marker instead of receipt counting; a rename-reclaimed lock
directory and run ids for the state file; ownership proven by process
ancestry before `up` records it; SSE frames as invalidations over REST
truth; exact 409 semantics in the contract fake; one run per team; Linux
lifecycle only; tokens never in argv or transcripts.

Consequences: the driver is larger than a single script (an entry point
plus `lib/` modules); the first real run is the dev pack's 0.4.2
validation; `pair`, room sending, macOS lifecycle, and the special request
types wait for v2.
