# openmausbot-launcher

An Agent Skill and a dependency-free Node driver that let any AI agent host
(Claude Code, Codex CLI, Grok Build, OpenClaw, Hermes Agent, DeepSeek
Harness) run an [OpenMausBot](https://github.com/milind-soni/OpenMausBot)
bot team for you: load a team package, bind engines, brief the lead bot,
watch the delegation chain, relay its questions and your answers, reconcile
the repository, clean up, report. The driver talks to a separately installed
headless OpenMausBot 0.1.56 server over its HTTP API and never modifies it.
The bots run real coding CLIs on your own subscriptions.

## Install

```
npx skills add WSH95/agent-skills@openmausbot-launcher
```

Or link `skills/openmausbot-launcher` into `~/.claude/skills/` (Claude Code,
Grok Build) or `~/.agents/skills/` (Codex, DeepSeek Harness, OpenClaw,
Hermes Agent). You also need Node 24, git, the `openmausbot` 0.1.56 package
on `PATH` or named by `OMB_BIN`, and the engine CLIs your team will use.

## Load your team package

A team package is a JSON file with `format: "openmaus.package"`: the bots,
their titles and instructions, the chief of staff you talk to, rooms and
playbooks. Engines, models and approval levels are not in it; `bind` sets
them after the import. Get one by exporting an existing OpenMausBot team, by
writing one by hand (the format is in
`skills/openmausbot-launcher/references/team-authoring.md`), or by asking
the skill to write one with you:

```
/openmausbot-launcher write a team package for reviewing pull requests
```

Loading it is a one-time setup per project. The skill runs it for you on the
first task, asking for the package path, the engines and the test command;
by hand, with `omb` standing for `node skills/openmausbot-launcher/scripts/omb.mjs`:

```
omb validate ~/teams/my-team.openmaus.json                 # the server's own errors, offline
omb doctor --project ~/proj
omb up --project ~/proj --port 8899 --fresh                # a server for this project
omb import ~/teams/my-team.openmaus.json --project ~/proj  # creates the bots, records them in .omb/state.json
omb bind --project ~/proj --default claude/claude-sonnet-5 --reviewers codex/gpt-6-astra/xhigh --approval auto
omb facts --project ~/proj --test "npm test" --merge auto
```

Then run tasks: `/openmausbot-launcher do T10 in ~/proj`, or
`omb task --project ~/proj "<brief>"` followed by `omb watch`. Import once per
project: a second import of the same file creates a second, numbered team.

## Invoke

The skill runs only when asked for by name: `/openmausbot-launcher <request>`
(Claude Code, Grok Build, DeepSeek Harness), `$openmausbot-launcher <request>`
(Codex), `/openmausbot_launcher <request>` (OpenClaw, including from a phone
over Telegram). Hermes Agent triggers on the description. The operator's
instructions are `skills/openmausbot-launcher/SKILL.md`; per-host install
and the phone recipe are in `skills/openmausbot-launcher/references/hosts.md`.

## Repository

- `skills/openmausbot-launcher/`: the installable unit (`SKILL.md`,
  `scripts/omb.mjs` and its `lib/`, `references/`, `assets/`,
  `agents/openai.yaml`). The driver has eighteen verbs.
- `tests/`: `node:test` suites against an in-memory OpenMausBot that encodes
  the 0.1.56 HTTP contract. Run them with `npm test` (no dependencies).
- `docs/design.md` is the authoritative design; `docs/evidence.md` records
  every real run, with the bot turns each one cost.
- `tools/build-dist.mjs` builds the registry payload into `dist/`
  (gitignored) and `tools/publish_agent_artifact_pr.py` opens the publish PR
  into [WSH95/agent-skills](https://github.com/WSH95/agent-skills) from
  `agent-artifacts.json`; `--dry-run` previews it without network.

Inside Codex, the repository's `.codex/config.toml` defines the maintainer
profile `omb-loopback-dev` for the test suite; the skill ships its own
consumer profile at
`skills/openmausbot-launcher/assets/codex/omb-loopback.config.toml`.
