# Hosts: install, run, time budgets, phone mode

The skill directory is the same for every host. What differs is where the
host looks for skills, how it runs a bundled script, and how long one shell
call may take. Verified rows come from `docs/evidence.md`; the rest are from
the hosts' own documentation and are marked so.

## Install and run

| Host | Install | How the agent runs the driver | Status |
|---|---|---|---|
| Claude Code 2.1.x | `ln -s <repo>/skills/openmausbot-launcher ~/.claude/skills/openmausbot-launcher` (or `.claude/skills/` in a project) | Bash: `${CLAUDE_SKILL_DIR}/scripts/omb.mjs <verb> …`; a permission prompt shows the script path | verified 2026-09-08 |
| Grok Build 1.0.x | none: it reads `~/.claude/skills` and `.claude/skills` | bash tool, same path | verified 2026-09-08 |
| Codex CLI 0.153.x | `ln -s <repo>/skills/openmausbot-launcher ~/.agents/skills/openmausbot-launcher` (also read: `~/.codex/skills`, a project's `.agents/skills`); `agents/openai.yaml` makes it `$openmausbot-launcher` | shell inside the workspace-write sandbox | verified 2026-09-08 for reads; see "Codex sandbox" |
| DeepSeek Harness (dsh) | `~/.agents/skills/openmausbot-launcher` (tier 500; a project's `.agents/skills` is tier 200; discovery is not recursive) | shell | documented only |
| OpenClaw | `~/.agents/skills/openmausbot-launcher` (read in the default state) or `openclaw skills install <repo>/skills/openmausbot-launcher`; then allow the script: `openclaw approvals allowlist add --agent "<agent>" <abs>/scripts/omb.mjs` | `exec` with `host: gateway` and an explicit `timeoutSeconds` | documented only |
| Hermes Agent | copy into `~/.hermes/skills/openmausbot-launcher`, or add `~/.agents/skills` to `skills.external_dirs` in `~/.hermes/config.yaml`; project installs need `hermes skills trust` | terminal: `${HERMES_SKILL_DIR}/scripts/omb.mjs …` | documented only |

`npx skills add ~/Documents/openmausbot-launcher -g` creates the symlinks for
the hosts it knows; check discovery on each host afterwards (`/skills`,
`$openmausbot-launcher`, `hermes skills list`) rather than assuming it.

The driver supports Node 24, including remote writers that use its built-in
SQLite mutex (OpenMausBot itself also requires Node 24). `up`, `down`, and `cleanup --kill` read `/proc`, so
they are Linux-only; on macOS use `up` to attach to a server you started
yourself.

## Time budgets per shell call

`watch` observes for at most `--max-seconds` (default 100), followed by up
to one second waiting for its checkpoint lock. If `checkpointed:false`, the
returned cursor was not saved; call again to reload state. Each call observes its own 30 s
quiet window before it can declare a run settled, so never go below
`--max-seconds 35`.

| Host | Shell limit | Recommended `watch` |
|---|---|---|
| Claude Code | Bash 120 s by default, up to 600 s with `timeout`; `run_in_background` for longer | `--max-seconds 100`, or `--max-seconds 570` in the background with a 600 s timeout |
| Grok Build | similar to Claude Code | `--max-seconds 100` |
| Codex CLI | the exec timeout of the sandbox | `--max-seconds 100` |
| OpenClaw | `exec` yields after 10 s and keeps the process running in the background; the process timeout still applies | `--max-seconds 1500` in the background, read the result through the process tool; or automations |
| Hermes | cron jobs run a script to completion | `--max-seconds 240` from the cron adapter |
| DSH | unverified | `--max-seconds 100` |

## Codex sandbox (verified 2026-09-08)

Codex's workspace-write sandbox denies listening sockets: `up` fails with
`the server exited during startup` and the log shows
`listen EPERM: operation not permitted`. Two ways out:

1. Run `up` as an escalated command (Codex asks for approval to run outside
   the sandbox). Later commands still follow that host's filesystem and
   process permissions; only the recorded reads below are verified.
2. Start the server elsewhere (a terminal, a `systemd --user` unit) and run
   `up` to attach; `down` then refuses, stop it where you started it.

Codex and Grok discovery/status reads were recorded after the spike. Long
Codex SSE watches and the formal doctor/status/send sequence on all three
hosts remain unverified. OpenClaw, Hermes, and DSH are documentation only;
no additional host verification was performed during M1.1.

## Phone mode with OpenClaw on the same machine (documented only)

Telegram → OpenClaw gateway → `exec <abs>/scripts/omb.mjs` → loopback
OpenMausBot. The state file under the project keeps every call
independent, so a fresh session or an automation can continue a run.

1. Install the skill and allow the script path for the agent (table above).
2. Session flow. "start the team on ~/proj and do T10 (bead slg-a9x)" →
   `doctor --project ~/proj`, `up --fresh`, `doctor --server`, then
   `import`, `bind`, and `facts` for that fresh server, then
   `task --todo T10 --bead slg-a9x`, and reply with the `--brief` line.
   When attaching to the same verified server, reuse its binding. After a
   restart, re-import or adopt to establish the new identity before a task;
   the presence of old team state alone is insufficient.
3. Progress reaches the phone either way:
   - An automation, disabled after the run is done:
     `openclaw automations create "*/5 * * * *" --command "<abs>/scripts/omb.mjs watch --brief --max-seconds 240 --until change --quiet-if-unchanged --nudge" --command-cwd /home/you/proj --announce --channel telegram --to <chat id>`.
     It prints one line only when something is new; whether an empty
     output is announced as an empty message is unverified.
   - Interactive: the agent runs `watch --max-seconds 1500 --until change`
     in the background, relays each result, and loops.
4. Answers from the phone: "tell Sudo: no new dependency, use a table" →
   `send "no new dependency, use a table"`; "approve" → `answer --allow
   --request <id>`; "what's happening" → `status --brief`.

Automations are admin-authored commands, separate from the agent's exec
allowlist; keep the command line exact.

## Hermes cron adapter (documented only)

Hermes cron `--script` takes a file name under `~/.hermes/scripts/`, not an
absolute path, and treats a non-zero exit as an error alert. A three-line
adapter keeps the expected watch outcomes quiet and lets real failures
through:

```sh
#!/bin/sh
# ~/.hermes/scripts/omb-watch.sh
/abs/path/skills/openmausbot-launcher/scripts/omb.mjs watch --project /home/you/proj --brief --max-seconds 240 --until change --quiet-if-unchanged
c=$?; case $c in 0|4|5) exit 0;; *) exit $c;; esac
```

`hermes cron create "every 5m" --no-agent --script omb-watch.sh` with
`deliver: telegram` sends the line to the chat.

## Remote variant (documented only)

The driver on another machine can only `import --adopt`, `status`, `watch`,
`send`, `answer`, and `interrupt`; everything else needs the project
checkout or the data dir. On the OpenMausBot machine:
`openmausbot serve --tailscale` (or `--tunnel` after `openmausbot login`),
then `openmausbot pair --label openclaw` and exchange the code once:

```sh
curl -s -X POST https://<host>/api/auth/pair -H 'content-type: application/json' \
  -d '{"code":"XXXX-XXXX-XXXX","label":"openclaw"}'
```

Put the returned token into `~/.config/openmausbot-launcher/tokens.json`
(mode 0600) as `{"https://<host>": "omb_sess_…"}`, or export `OMB_TOKEN`
for one call; never put it on a command line. A client-scope session
(`pair --client`) can send, answer, watch, and open tasks but not import,
bind, or change models. A bearer token also wins over loopback trust, so
`doctor` warns when `OMB_TOKEN` is set on a loopback URL. Prefer running
the driver on the OpenMausBot machine through an OpenClaw node, or an SSH
tunnel to loopback, which needs no token; pass `--remote` when the driver
runs on another machine through that tunnel. Never bind the server publicly:
loopback is owner trust, not isolation.
