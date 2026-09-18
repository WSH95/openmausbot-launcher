# openmausbot-launcher

An Agent Skill ([SKILL.md](SKILL.md)) plus a dependency-free Node driver at
`scripts/omb.mjs` that lets your agent host operate a separately installed
headless OpenMausBot server as your launcher: start it, import and bind a
team, brief the lead bot, watch the chain, relay the bots' questions and
your answers, reconcile the repository, clean up, report. It never modifies
OpenMausBot; it uses only the server's HTTP API, CLI and data-dir files.
`omb` in `SKILL.md` is shorthand for `scripts/omb.mjs` in this directory.
The bots run real coding CLIs on your own subscriptions, so every bot turn
costs money and minutes.

## Prerequisites

- Node 24 or later; git; a project that is a git repository with a test command.
- The `openmausbot` npm package 0.1.56 — the headless server, not the
  desktop app — on `PATH` or named by `OMB_BIN`, the path to its `cli.js`.
- A team package (`.openmaus.json`) — or none yet: the skill writes one with
  you — and the engine CLIs its roster binds, installed and logged in.
- Linux for `up`, `down` and `cleanup --kill`, which read `/proc`; elsewhere
  start the server yourself and attach to it. The other host limits and the
  remote variant are in [references/hosts.md](references/hosts.md).

## Install

Put this directory where your host looks for skills, for example
`mkdir -p ~/.claude/skills && ln -s "$PWD" ~/.claude/skills/openmausbot-launcher`
for Claude Code and Grok Build, or the same under `~/.agents/skills` for
Codex, DeepSeek Harness, OpenClaw and Hermes Agent, which also needs that
directory in `skills.external_dirs`. The per-host table, the config lines
and the opt-in Codex permission profile are in `references/hosts.md`.

## Invoke

Ask for the skill by name: `/openmausbot-launcher <request>` in Claude Code,
Grok Build and DeepSeek Harness, `$openmausbot-launcher <request>` in Codex,
`/openmausbot_launcher <request>` in an OpenClaw chat channel. Those hosts do
not hand the skill to the model on an ordinary message, and the skill itself
refuses to run a verb when it arrives without one of those markers. Hermes
Agent does not read that switch and picks the skill up from its description,
so there an ordinary message can still start it. For example,
`/openmausbot-launcher status --project ~/proj`. Setting a project up
starts with `doctor`; the operator's own instructions are `SKILL.md`. With
no team package yet, the skill writes one with you — `/openmausbot-launcher
write a team package for <what the team does>` asks one question at a time,
confirms what it understood, and writes the file only after you say yes.
