# openmausbot-launcher

An Agent Skill that turns any AI agent host into the operator of a headless
[OpenMausBot](https://github.com/milind-soni/OpenMausBot) server: start and
stop the server, import a team package, bind the team to a project, brief
the lead bot, watch the delegation chain, relay the lead's questions and the
user's answers, reconcile the repository between tasks, clean up, and report.
The skill includes install guidance for Claude Code, Codex CLI, Grok Build,
OpenClaw, Hermes Agent, and DeepSeek Harness. The OpenClaw phone recipe
uses a workstation gateway and Telegram; it was verified end to end on
2026-09-16, from a Telegram message to the answer in the same chat, with
the skill still implicitly invocable. Since 2026-09-18 invocation is
explicit, and the phone recipe's slash-command form was verified from the
user's phone the same day (`docs/evidence.md`).

This repository does not contain OpenMausBot. It is a launcher: a `SKILL.md`
and a dependency-free Node driver (eighteen verbs, about 2,500 lines under
`skills/openmausbot-launcher/scripts/`) that drives a separately installed
[OpenMausBot](https://github.com/milind-soni/OpenMausBot) 0.1.56 server over
its HTTP API, CLI, and data-dir files. Install that package yourself, then
either put `openmausbot` on `PATH` or point `OMB_BIN` at its `cli.js`;
`omb doctor` reports which one it found and the version.

Supply a compatible team package with `omb import <package.json>`. The
launcher reads its roster and lead from that input; `dev-team.openmaus.json`
is an external test configuration, with no required package path or roster.

Status: 0.1.0, M1 complete and reviewed. The driver has eighteen verbs and
the full `node:test` suite passes (`npm test`). The independent M1 review of
2026-09-08 ([docs/review/2026-09-08-m1-review.md](docs/review/2026-09-08-m1-review.md))
filed 26 findings, all fixed in the same pass, and ran real OpenMausBot
0.1.56 three ways: the setup path and every design host check with zero
bot turns, a lead-only transport check (approval cards, interrupt, both
report modes), and a full-team task, T13 on the slugkit clone (incomplete,
8/9 pack checks), through the fixed driver with a Codex lead and Claude,
Codex and Grok specialists. Claude Code, Codex CLI, and Grok Build each
executed the real `doctor`/`status`/`send` checks; the earlier full-team T12
task retains its 8/9 optional package checks. See the
[evidence and coverage limits](docs/evidence.md). Package diagnostics do not
define launcher acceptance. The design is [docs/design.md](docs/design.md).

## Layout

- `skills/openmausbot-launcher/`: the installable unit (`SKILL.md`,
  `scripts/omb.mjs` and its `lib/`, `references/`, `assets/`,
  `agents/openai.yaml`).
- `tests/`: `node:test` suites against `tests/fixtures/fake-omb.mjs`, an
  in-memory OpenMausBot that encodes the 0.1.56 HTTP contract.

## Build and publish

The canonical source is `skills/openmausbot-launcher/`; the payload that
ships is a generated copy. `node tools/build-dist.mjs` copies it into
`dist/openmausbot-launcher/` (gitignored), prunes runtime junk, checks the
required files and fails loudly when one is missing; `tests/dist.test.mjs`
pins that the payload equals the tracked skill tree byte for byte.
`agent-artifacts.json` names the destination,
[WSH95/agent-skills](https://github.com/WSH95/agent-skills) at
`skills/openmausbot-launcher`, and the registry README entry kept in
`docs/registry/openmausbot-launcher.md`. The version is `package.json`'s and
the SKILL.md metadata mirrors it.

```
node tools/build-dist.mjs                               # skills/ -> dist/
python3 tools/publish_agent_artifact_pr.py --dry-run    # build and print the plan, no network
python3 tools/publish_agent_artifact_pr.py              # opens the PR with gh; never merges
```

The repository itself lives at
[github.com/WSH95/openmausbot-launcher](https://github.com/WSH95/openmausbot-launcher).

## Run the tests

```
npm test
```

No dependencies; Node 24 or later.

Inside Codex, the repository's `.codex/config.toml` defines the maintainer-only
`omb-loopback-dev` permission profile. It includes `127.0.0.2` solely because
`tests/pair.test.mjs` uses that address to model a proxied caller; the profile
shipped to Skill users does not. Run the suite directly under that profile
with the proxy bypass set inside the sandboxed command:

```sh
codex sandbox -C "$PWD" --permission-profile omb-loopback-dev -- \
  env NO_PROXY=127.0.0.1,localhost,127.0.0.2 \
      no_proxy=127.0.0.1,localhost,127.0.0.2 npm test
```

## Install the skill

From the registry, once the publish PR is merged:

```
npx skills add WSH95/agent-skills@openmausbot-launcher
```

From this checkout:

```
ln -s "$PWD/skills/openmausbot-launcher" ~/.claude/skills/openmausbot-launcher   # Claude Code, Grok Build
ln -s "$PWD/skills/openmausbot-launcher" ~/.agents/skills/openmausbot-launcher   # Codex, DSH, OpenClaw, Hermes (external_dirs)
```

Every host that reads the switch stops handing the skill to the model on an
ordinary message, so ask for it by name: `/openmausbot-launcher <request>`
(Claude Code, Grok Build, DeepSeek Harness), `$openmausbot-launcher
<request>` (Codex), or `/openmausbot_launcher <request>` in an OpenClaw
channel; Hermes Agent does not read the switch and still triggers on the
description. The switch is a host policy, not a filesystem boundary, so the
skill itself also refuses to run a verb when it arrives uninvoked.
`skills/openmausbot-launcher/README.md` is the entry point for the person
who receives the skill directory, and
`skills/openmausbot-launcher/references/hosts.md` has the per-host notes.
Codex users can opt into the bundled least-privilege loopback profile at
`skills/openmausbot-launcher/assets/codex/omb-loopback.config.toml`; the host
notes explain how to install, select, verify, and remove it. The skill never
changes a user's Codex configuration itself.
