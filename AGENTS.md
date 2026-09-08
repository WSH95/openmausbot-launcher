# openmausbot-launcher

`openmausbot-launcher`: an Agent Skill (agentskills.io `SKILL.md`) plus a
dependency-free Node driver that lets any AI agent host (Claude Code, Codex
CLI, Grok Build, OpenClaw, Hermes Agent, DeepSeek Harness) operate a
headless OpenMausBot 0.1.56 server as the user's launcher: start and stop
the server, import a team package, bind it to a project, brief the lead bot,
watch the delegation chain, relay questions and answers, reconcile the
repository, clean up, report. The design in `docs/design.md` is
authoritative; `docs/evidence.md` records real runs.

Stack: JavaScript (Node 24, ESM, no dependencies, `node:test`).

## Project facts

- Default branch: `main`.
- Test command: `npm test`.
- Setup command: none.
- Merge policy: auto. Local Git operations are permitted; every `git push` requires the user's explicit permission.

## Layout

- `skills/openmausbot-launcher/`: the installable unit. `SKILL.md` (the
  operator's instructions, under 500 lines), `scripts/omb.mjs` (the entry
  point, invoked by path), `scripts/lib/*.mjs` (one module per concern:
  `cli`, `config`, `git`, `http`, `proc`, `report`, `server`, `session`,
  `snapshot`, `state`, `team`, `watch`) and `scripts/lib/verbs/*.mjs` (the
  verb handlers: `lifecycle`, `repo`, `run`, `report`, `state`, `team`),
  `references/*.md` (loaded on demand), `agents/openai.yaml` (Codex
  metadata). Nothing outside this directory is installed on a host.
- `tests/*.test.mjs`: `node:test` with `node:assert/strict`;
  `tests/fixtures/fake-omb.mjs` is an in-memory OpenMausBot that encodes the
  0.1.56 HTTP contract (routes, 409 texts, SSE frames, receipts pruning) and
  a `POST /__fake` control route for scenarios.
- `docs/design.md`, `docs/evidence.md`.

## Conventions

- Test first: every behaviour change starts with a failing test in
  `tests/`; the test names the behaviour. Contract facts in the fake come
  from the pinned OpenMausBot source (`~/.cache/agent-team/openmausbot-src`,
  0.1.56) with a `file:line` comment; never from memory.
- Never fork or patch OpenMausBot; the driver uses only its HTTP API, CLI,
  and data-dir files. An upstream change is an issue in the dev pack's
  `~/Documents/agent-team-devpack/docs/upstream/` (this repository has no
  such directory).
- No dependencies: Node built-ins only. One executable entry point; small
  internal modules; no artificial length caps. Every sentence in
  `SKILL.md` and the references serves a purpose.
- Every real run (bot turns spent) is recorded in `docs/evidence.md` with
  the command, the OpenMausBot version, and the ids. Fake-server runs are
  not evidence.
- Tokens never appear in argv, stdout, state files, or transcripts.
- Bots run real CLIs on the user's subscriptions: keep real runs short and
  count them.

## Run

- The driver: `skills/openmausbot-launcher/scripts/omb.mjs <verb> [--project <dir>] …`
  (JSON on stdout; `--brief` for one line).
- The fake server for a dry run: `node tests/fixtures/fake-omb.mjs serve --port 8799 --data-dir /tmp/omb-fake`.

## Project context

- Read `.project-steward/HANDOFF.md` for the current state and next steps.
- Project goals and milestones live in `.project-steward/PROJECT.md` and
  `.project-steward/PLAN.md`.
- The other files in `.project-steward/` record progress, decisions,
  questions, risks, and verification.

<!-- PROJECT-STEWARD:BEGIN commands -->
## Commands

- Build: `none`
- Test: `npm test`
- Lint: `none`
<!-- PROJECT-STEWARD:END commands -->

<!-- PROJECT-STEWARD:BEGIN task-backend -->
## Task backend

beads owns the detailed task list. Keep only milestones and a pointer in `.project-steward/PLAN.md`; do not copy tasks between systems.
<!-- PROJECT-STEWARD:END task-backend -->

<!-- PROJECT-STEWARD:BEGIN agent-session-protocol -->
## Project Steward workflow

- Start by reading `.project-steward/HANDOFF.md`. Run `project-steward resume`
  when available, then recap the current task, next step, blockers, open
  questions, git state, and any crash signals.
- At meaningful checkpoints, write plain, factual updates to the relevant
  files in `.project-steward/` or run `project-steward checkpoint --note "..."`.
- Before pausing or switching agents, leave `HANDOFF.md` ready for someone
  without this chat. Run `project-steward wrap --summary "..."` when available.
- Create Conventional Commits at tested semantic checkpoints, including
  `.project-steward/`. Local Git work does not require separate permission.
  Every `git push`, including force-pushes and automated pushes, requires the
  user's explicit permission for that push.
- Treat `AGENTS.md` and `CLAUDE.md` as user-owned files. Change only
  `PROJECT-STEWARD` managed blocks, show the diff first, and record the
  approved change in `.project-steward/DECISIONS.md`.
<!-- PROJECT-STEWARD:END agent-session-protocol -->

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Repository Git policy

The user explicitly permits local Git operations as part of authorized work:
inspection, staging, commits, branches, worktrees, rebases, and local merges.
Create Conventional Commits at tested semantic checkpoints without asking
for separate commit permission.

Every `git push` requires the user's explicit permission for that push,
including pushes by agents, automation, helpers, and force-pushes. Permission
to implement, commit, or merge does not authorize a push. The absence of a
remote does not prohibit local Git work. This repository policy overrides
Beads' conservative/minimal Git defaults.

## Session Completion

1. Track remaining work in Beads.
2. Run relevant quality gates if code changed.
3. Close completed issues with `bd close` and update unfinished work.
4. Review local changes and commit a coherent, verified checkpoint.
5. Hand off the result and validation. Obtain explicit user permission
   before any `git push`; never push automatically during session close.

<!-- END BEADS INTEGRATION -->

<!-- BEGIN BEADS CODEX SETUP: generated by bd setup codex -->
## Beads Issue Tracker

Use Beads (`bd`) for durable task tracking in repositories that include it. Use the `beads` skill at `.agents/skills/beads/SKILL.md` (project install) or `~/.agents/skills/beads/SKILL.md` (global install) for Beads workflow guidance, then use the `bd` CLI for issue operations.

### Quick Reference

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work
bd close <id>           # Complete work
bd prime                # Refresh Beads context
```

### Rules

- Use `bd` for all task tracking; do not create markdown TODO lists.
- Run `bd prime` when Beads context is missing or stale. Codex 0.129.0+ can load Beads context automatically through native hooks; use `/hooks` to inspect or toggle them.
- Keep persistent project memory in Beads via `bd remember`; do not create ad hoc memory files.

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.
<!-- END BEADS CODEX SETUP -->
