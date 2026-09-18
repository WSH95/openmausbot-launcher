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
explicit, and the phone recipe's slash-command form is pending a run from
the user's phone.

This repository does not contain OpenMausBot. It is a launcher: a `SKILL.md`
and a dependency-free Node driver (seventeen verbs, about 2,500 lines under
`skills/openmausbot-launcher/scripts/`) that drives a separately installed
[OpenMausBot](https://github.com/milind-soni/OpenMausBot) 0.1.56 server over
its HTTP API, CLI, and data-dir files. Install that package yourself, then
either put `openmausbot` on `PATH` or point `OMB_BIN` at its `cli.js`;
`omb doctor` reports which one it found and the version.

Supply a compatible team package with `omb import <package.json>`. The
launcher reads its roster and lead from that input; `dev-team.openmaus.json`
is an external test configuration, with no required package path or roster.

Status: 0.1.0, M1 complete and reviewed. The driver has seventeen verbs and
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

```
ln -s "$PWD/skills/openmausbot-launcher" ~/.claude/skills/openmausbot-launcher   # Claude Code, Grok Build
ln -s "$PWD/skills/openmausbot-launcher" ~/.agents/skills/openmausbot-launcher   # Codex, DSH, OpenClaw, Hermes (external_dirs)
```

Invocation is explicit on every host that reads the switch: type
`/openmausbot-launcher <request>` (Claude Code, Grok Build, DeepSeek
Harness), `$openmausbot-launcher <request>` (Codex), or
`/openmausbot_launcher <request>` in an OpenClaw channel; Hermes Agent does
not read the switch and still triggers on the description.
`skills/openmausbot-launcher/references/hosts.md` has the per-host notes.
Codex users can opt into the bundled least-privilege loopback profile at
`skills/openmausbot-launcher/assets/codex/omb-loopback.config.toml`; the host
notes explain how to install, select, verify, and remove it. The skill never
changes a user's Codex configuration itself.
