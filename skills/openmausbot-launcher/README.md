# openmausbot-launcher

An Agent Skill ([SKILL.md](SKILL.md)) plus a dependency-free Node driver,
`scripts/omb.mjs`, that lets your agent host run an OpenMausBot bot team for
you: load a team package, bind engines, brief the lead bot, watch the chain,
relay its questions and your answers, clean up, report. It drives a
separately installed headless OpenMausBot server over its HTTP API and never
modifies it. The bots run real coding CLIs on your own subscriptions, so
every bot turn costs money and minutes.

## Prerequisites

- Node 24 or later; git; a project that is a git repository with a test command.
- The `openmausbot` npm package 0.1.56 (the headless server, not the desktop
  app) on `PATH`, or `OMB_BIN` set to the path of its `cli.js`.
- The engine CLIs your team will use (Claude Code, Codex, Grok…), installed
  and logged in.
- A team package (`.openmaus.json`), or none yet: see the next section.
- Linux for `up`, `down` and `cleanup --kill`, which read `/proc`. Elsewhere
  start the server yourself and attach to it (`references/hosts.md`).

## Install

```
npx skills add WSH95/agent-skills@openmausbot-launcher   # from the registry
```

Or link this directory into your host's skills folder:
`~/.claude/skills/` for Claude Code and Grok Build, `~/.agents/skills/` for
Codex, DeepSeek Harness, OpenClaw and Hermes Agent (Hermes also needs that
folder in `skills.external_dirs`). Per-host details: `references/hosts.md`.

## Load your team package

A team package is a JSON file with `format: "openmaus.package"`: the bots,
their titles and instructions, the chief of staff you talk to, rooms and
playbooks. It carries no engines, models or approval levels; those are set
after the import. Get one in any of three ways:

- you already have one (exported from an OpenMausBot team, or written by
  hand following `references/team-authoring.md`);
- ask the skill to write one with you:
  `/openmausbot-launcher write a team package for <what the team does>`;
- check any file before loading it: `node scripts/omb.mjs validate <file>`
  reports the errors the server would report, offline.

Then load it. The easiest way is to let the skill do it: on the first task
in a project it asks for the package path, the engines and the test command
and runs these steps for you. By hand, with `omb` standing for
`node scripts/omb.mjs`:

```
omb doctor --project ~/proj                              # Node, binary, git, project
omb up --project ~/proj --port 8899 --fresh              # start a server for this project
omb import ~/teams/my-team.openmaus.json --project ~/proj
omb bind --project ~/proj --default claude/claude-sonnet-5 --reviewers codex/gpt-6-astra/xhigh --approval auto
omb facts --project ~/proj --test "npm test" --merge auto
omb task --project ~/proj "Sudo, do T10 from TODO.md"   # then: omb watch --project ~/proj
```

`import` creates the bots on the server and records them in
`<project>/.omb/state.json`; a second import of the same file makes a
second, numbered team, so import once per project.

## Invoke

The skill runs only when you ask for it by name: `/openmausbot-launcher
<request>` in Claude Code, Grok Build and DeepSeek Harness,
`$openmausbot-launcher <request>` in Codex, `/openmausbot_launcher <request>`
in an OpenClaw chat. Hermes Agent picks it up from its description. For
example, `/openmausbot-launcher do T10 in ~/proj` or
`/openmausbot-launcher status --project ~/proj`. The operator's own
instructions are `SKILL.md`; the per-host notes and the phone recipe are in
`references/hosts.md`.
