# openmausbot-launcher

An Agent Skill that turns any AI agent host into the operator of a headless
[OpenMausBot](https://github.com/milind-soni/OpenMausBot) server: start and
stop the server, import a team package, bind the team to a project, brief
the lead bot, watch the delegation chain, relay the lead's questions and the
user's answers, reconcile the repository between tasks, clean up, and report.
The skill includes install guidance for Claude Code, Codex CLI, Grok Build,
OpenClaw, Hermes Agent, and DeepSeek Harness. The OpenClaw phone recipe
uses a workstation gateway and Telegram; it is documented but unverified.

Supply a compatible team package with `omb import <package.json>`. The
launcher reads its roster and lead from that input; `dev-team.openmaus.json`
is an external test configuration, with no required package path or roster.

Status: 0.1.0. The driver's fourteen verbs are implemented and tested
against a contract fake; one real task ran through the dev-team pack 0.4.2
on OpenMausBot 0.1.56 ([evidence](docs/evidence.md)), with 8/9 pack checks.
M1.1 repairs dry runs, serialization, monitoring, identity, cleanup, and
report attribution. Full host validation remains open. The pack's ListAgents
result is recorded separately; its optional `--check-042` diagnostics do not
define launcher acceptance. The design is [docs/design.md](docs/design.md).

## Layout

- `skills/openmausbot-launcher/`: the installable unit (`SKILL.md`,
  `scripts/omb.mjs` and its `lib/`, `references/`, `agents/openai.yaml`).
- `tests/`: `node:test` suites against `tests/fixtures/fake-omb.mjs`, an
  in-memory OpenMausBot that encodes the 0.1.56 HTTP contract.

## Run the tests

```
npm test
```

No dependencies; Node 24 or later.

## Install the skill

```
ln -s "$PWD/skills/openmausbot-launcher" ~/.claude/skills/openmausbot-launcher   # Claude Code, Grok Build
ln -s "$PWD/skills/openmausbot-launcher" ~/.agents/skills/openmausbot-launcher   # Codex, DSH, OpenClaw, Hermes (external_dirs)
```

`skills/openmausbot-launcher/references/hosts.md` has the per-host notes.
