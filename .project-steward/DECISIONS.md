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

## 0003 — 2026-09-08 — M1.1 correctness repair contract

Context: re-review demonstrated overlapping writers in the directory-lock
protocol, incomplete monitoring evidence, mutating previews, unsafe identity
assumptions, and report approval attributed to the lead's paraphrase.

Decision: use a persistent SQLite mutex with immediate attempts and bounded
asynchronous retries, keeping atomic state JSON version 1. Stop all old
launchers and update every installed copy before removing a legacy lock.
Conservative snapshots, one observation deadline, verified bindings, and
attributable report evidence are specified in `docs/design.md`. Beads epic
`oml-t8u` owns the repairs. No new bot turns or dev-pack edits in this pass.

Consequences: Node 24 is the supported runtime; SQLite may warn on stderr.
Skipped required checks yield incomplete. Historical reanalysis preserves
original evidence. The earlier lock choice in Decision 0002 is superseded.
M1's all-host gate and T12's 8/9 result remain separate from repair completion.

## 0004 — 2026-09-08 — Commit authority during M1.1

Historical restriction, superseded by Decision 0005 below.

The active Beads session hook states `Git authority: no git operations in
this context`. The user authorized implementation after that restriction
was explained, without lifting it. Work is reviewed against a source copy
and remains uncommitted. Intended checkpoint once authorized: one tested
Conventional Commit for the integrated repair, including steward records;
never push. Automatic per-task commits from the re-review were not adopted.

## 0005 — 2026-09-08 — Permit Git work; require permission for pushes

The user clarified: "I don't want to prohibit Git operations; I just want
to make it a rule that no one can perform a `git push` without my permission."

Local Git inspection, staging, commits, branches, worktrees, rebases and
local merges are authorized as part of the requested work. Commit coherent,
tested checkpoints without a separate permission question. Every push,
including automated or force pushes, requires explicit user permission for
that push. Implementation, commit and merge approval do not authorize a push.

Corrected AGENTS.md and CLAUDE.md under that explicit instruction; their
policy diff was shown before applying it. Beads still emitted its blanket
restriction with `no-git-ops: false` in this repository without a remote.
The supported `.beads/PRIME.md` override now carries the project policy into
both hosts' existing hooks. Automated push settings remain disabled;
Project Steward keeps automatic local commits enabled. Decision 0004 is
historical and no longer defines the repository's policy.
