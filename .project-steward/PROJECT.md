# openmausbot-launcher project charter

An Agent Skill plus a dependency-free Node driver that lets any AI agent host
(Claude Code, Codex CLI, Grok Build, OpenClaw, Hermes Agent, DeepSeek
Harness) operate a headless OpenMausBot 0.1.56 server as the user's
launcher: start and stop the server, import a team package, bind it to a
project, brief the lead bot, watch the delegation chain, relay questions and
answers, reconcile the repository, clean up, report. With OpenClaw on the
workstation the same skill works from a phone over Telegram.

- Created: 2026-09-08 (Project Steward 0.3.4)
- Stack: JavaScript, Node 24, ESM, no dependencies, `node:test`
- Design authority: `docs/design.md` (the approved plan of 2026-09-08, two
  Codex gpt-6-astra review rounds folded in); real runs: `docs/evidence.md`
- Origin: the launcher role played by hand in `~/Documents/agent-team-devpack`
  during its M6/M7 runs (its `docs/setup-guide.md` and `scripts/omb-*.sh`
  are the seeds); Decision 0009 there keeps that repository the pack's home
- License: MIT

## Goals

- One skill directory that loads unchanged in all six hosts, with a driver
  invoked by path so exec allowlists can name one file.
- Correct completion detection: settled means quiet for 30 s across two
  complete snapshots inside one invocation; done means the lead emitted the
  run's marker line; everything else is `attention`, `stalled`, or
  `needs-user`, never a silent false done.
- Safe state: atomic per-project JSON under a persistent SQLite mutex,
  with run and revision checks so automations and interactive agents can
  share it. Decision 0003 supersedes the original directory lock.
- Safe lifecycle: `up` proves ownership by process ancestry before recording
  it; `down` and `cleanup --kill` never signal a process they cannot verify.
- Accept compatible team packages supplied by the operator; discover their
  roster and lead from the import, with bindings supplied by the caller.
  `dev-team.openmaus.json` is an external test configuration. The first real
  run also collected its 0.4.2 diagnostics; those checks are separate from
  launcher acceptance (Decision 0006).

## Non-goals

- Modifying OpenMausBot (no fork, no patch); the desktop build (headless
  only); remote pairing in the driver (`pair` deferred); room sending;
  macOS lifecycle; connector, credential, skill, and routine request types
  in `answer`; more than one run per team at a time (all v2 candidates).

## Users and maintainers

- One human operator on Ubuntu with Claude Code, Codex, and Grok Build
  installed; OpenClaw, Hermes, and DSH documented from their docs only.
- The operator's own CLI sessions maintain the repository through Beads and
  Project Steward.

## Constraints

- OpenMausBot requires Node 24; the driver runs where OMB runs.
- Lifecycle management needs `/proc` (Linux). Windows unsupported.
- Bots run real CLIs on the user's subscriptions: real runs are counted and
  recorded.
- Local Git operations are permitted. Create Conventional Commits at tested
  checkpoints and include `.project-steward/`. Every `git push` requires
  explicit user permission for that push (Decision 0005).
