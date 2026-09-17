# Hosts: install, run, time budgets, phone mode

The skill directory is the same for every host. What differs is where the
host looks for skills, how it runs a bundled script, and how long one shell
call may take. Verified rows come from `docs/evidence.md`; the rest are from
the hosts' own documentation and are marked so.

## Install and run

| Host | Install | How the agent runs the driver | Status |
|---|---|---|---|
| Claude Code 2.1.263 | `ln -s <repo>/skills/openmausbot-launcher ~/.claude/skills/openmausbot-launcher` (or `.claude/skills/` in a project) | Bash: `${CLAUDE_SKILL_DIR}/scripts/omb.mjs <verb> …` — the host substitutes the path into the skill text at load time and the shell variable itself is unset, so use the path as it appears in the loaded skill; a permission prompt shows the script path | doctor, server doctor, status, send and reply verified 2026-09-08; trigger phrase "run T10 through the team", the substituted skill path, and the 100 s foreground plus 570 s background watches verified 2026-09-08 (M1 review) |
| Grok Build 1.0.13 | none: it reads `~/.claude/skills` and `.claude/skills` | bash tool, same path | doctor, server doctor, status, send and reply verified 2026-09-08; started the real server detached and it outlived the Grok process (survival spike, M1 review) |
| Codex CLI 0.154.0 | `ln -s <repo>/skills/openmausbot-launcher ~/.agents/skills/openmausbot-launcher` (also read: `~/.codex/skills`, a project's `.agents/skills`); `agents/openai.yaml` makes it `$openmausbot-launcher`; install the opt-in profile below for loopback | shell; start Codex with `--profile omb-loopback`; default `workspace-write` still needs escalation for every loopback call and for `up` | the least-privilege profile loaded and allowed a local listener/client while blocking a public request on 2026-09-17; doctor, server doctor, status, send and reply were previously verified against real OMB with escalation |
| DeepSeek Harness (dsh) 0.1.5-rc.1 | `~/.agents/skills/openmausbot-launcher`; discovery is not recursive (the tier numbers third-party posts quote are unverified) | shell, the script path directly; **add `--remote --url http://127.0.0.1:<port>` to every live verb** | doctor, server doctor, send and reply verified 2026-09-16; dsh runs its shell in its own PID namespace, so local identity checks fail and `status` exits 3 until `--remote` |
| OpenClaw 2026.9.4 | `~/.agents/skills/openmausbot-launcher` (read in the default state) or `openclaw skills install <repo>/skills/openmausbot-launcher`; keep `tools.exec.mode` at `ask` or `auto`, never `allowlist`; the token for a chat channel goes in a 0600 file named by `channels.telegram.tokenFile` | the agent's shell under the bundled Codex harness; **every command raises one approval card**, resolved with `openclaw approvals resolve <id> allow-once` | doctor, server doctor, status, send and reply verified 2026-09-16 through that escalation; the Telegram phone path and automations verified the same day |
| Hermes Agent (`pyproject` 0.21.3) | add `~/.agents/skills` to `skills.external_dirs` in `~/.hermes/config.yaml` (the documented default scan did not find the skill), or copy into `~/.hermes/skills/openmausbot-launcher`; project installs need `hermes skills trust` | terminal tool, the script path directly; no sandbox | doctor, server doctor, status, send and reply verified 2026-09-16; the cron adapter verified the same day |

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
| Codex CLI | the exec timeout of the sandbox | `--max-seconds 100` under the `omb-loopback` profile or an approved escalation; default `workspace-write` cannot open the connection (2026-09-17) |
| OpenClaw | `exec` yields after 10 s and keeps the process running in the background; the process timeout still applies | `--max-seconds 1500` in the background, read the result through the process tool; or automations. On 2026-09-17 an OpenClaw agent ran `watch --run t14 --max-seconds 40 --brief` against a live run and read the approval line back (run `614776d8-418a-457e-9b62-55b128102520`, 45.3 s, one approval card resolved `allow-once`); the 10 s yield itself is still unobserved |
| Hermes | cron jobs run a script to completion (verified 2026-09-16); the terminal tool takes a per-call timeout, over `terminal.timeout` (180 s) and `terminal.lifetime_seconds` (300 s) in `config.yaml` | `--max-seconds 240` from the cron adapter; raise the two config values before a longer watch. On 2026-09-17 `hermes -z` ran `watch --run t14 --max-seconds 40 --brief` against a live run through the terminal tool and read the approval line back (session `20260917_013542_298e4e`, 34 s, its tool recorded the driver's exit 5) |
| DSH | not measured | `--max-seconds 100` |

## Codex sandbox and the loopback profile

Inside the default `--sandbox workspace-write` (Codex CLI 0.153.4, and
0.154.0 on 2026-09-17):

- Listening sockets are denied: `up` exits 1 with `the server exited during
  startup`, the log shows `listen EPERM: operation not permitted`, and the
  hint names the sandbox (M1 review, tier 2, artifact `codex-up-ww.jsonl`).
- Loopback HTTP is blocked: `status` exits 1 with a network error naming
  `http://127.0.0.1:<port>` against a healthy server (it exited 3 with a
  misleading "identity could not be verified" before finding 26 was fixed;
  artifact `codex-ww-state.jsonl`). Treat exit 1 from a sandboxed Codex as
  the sandbox, not the server.
- `--sandbox read-only` lists `$openmausbot-launcher` among the skills, and
  `workspace-write` can write `<project>/.omb/state.json`.
- A long `watch` is not slow there, it is impossible: against a live run on
  2026-09-17 (`watch --run t15 --max-seconds 570 --verbose`, session
  `01a0ade0-3bad-7f63-8530-cf3e076a800d`) the driver exited after 47 ms with
  `cannot reach http://127.0.0.1:8899: EPERM` and its sandbox hint, and the
  model stopped without requesting an escalation. `--approve-for-me` is not a
  way around it: it routes approvals through automatic review **using the
  workspace-write sandbox**, so it cannot be combined with `--sandbox`
  ("the argument '--sandbox <SANDBOX_MODE>' cannot be used with
  '--approve-for-me'") and it leaves the same sandbox in place.

### Preferred least-privilege profile

The installable skill includes
`assets/codex/omb-loopback.config.toml`. It extends Codex's `:workspace`
profile, enables the network proxy, and allowlists only the exact literals
`127.0.0.1` and `localhost`. It does not set `allow_local_binding`, allow a
wildcard, or allow any public host. These choices follow Codex's
[permission-profile guidance](https://learn.chatgpt.com/docs/permissions).
The skill cannot grant this permission to itself and never edits
`$CODEX_HOME`.

For Codex CLI, copy the profile once on each machine and select it for the
session:

```sh
mkdir -p "${CODEX_HOME:-$HOME/.codex}"
cp <skill-dir>/assets/codex/omb-loopback.config.toml \
  "${CODEX_HOME:-$HOME/.codex}/omb-loopback.config.toml"
codex --profile omb-loopback -C <project>
```

Codex loads a separate `$CODEX_HOME/<name>.config.toml` only when the CLI is
started with `--profile <name>`; this is the documented
[separate-profile mechanism](https://learn.chatgpt.com/docs/config-file/config-sample).
Permission profiles do not compose with legacy sandbox settings. If any
loaded config layer contains `sandbox_mode`, contains
`[sandbox_workspace_write]`, or the command passes `--sandbox`, Codex ignores
`default_permissions` and uses the legacy sandbox instead. Check the user,
project, selected-profile, and managed configuration on each machine. Remove
or migrate legacy keys only from configuration you control; if policy owns
them, use the scoped escalation or remote fallback. Managed
`allowed_permission_profiles` is the documented exception that selects the
profile system, although administrators are still told to remove legacy
settings. This precedence is part of the same official permission-profile
guidance linked above.

For Codex Desktop, merge the template's `[features]` and
`[permissions.omb-loopback]` tables into the active
`$CODEX_HOME/config.toml` without replacing unrelated settings. Then select
`omb-loopback` in the permissions control if the installed build exposes it;
otherwise add `default_permissions = "omb-loopback"` before starting the
task. Keep a copy of the prior setting so it can be restored.

Codex's proxy sets Node's environment-proxy mode and can replace an inherited
proxy bypass list. Before its first local request, this driver merges
`127.0.0.1` and `localhost` with the existing `NO_PROXY` and `no_proxy`
entries, writes the same deduplicated list to both names, and leaves remote
URLs on the proxy. No command prefix is required.

Use Codex's own sandbox runner for a profile-only smoke check. The first
command must print `200`; the second must print `blocked`:

```sh
codex sandbox --profile omb-loopback --permission-profile omb-loopback -- \
  node -e 'const h=require("node:http");const s=h.createServer((q,r)=>r.end("ok"));s.listen(0,"127.0.0.1",()=>h.get("http://127.0.0.1:"+s.address().port,r=>{console.log(r.statusCode);r.resume();r.on("end",()=>s.close())}))'
codex sandbox --profile omb-loopback --permission-profile omb-loopback -- \
  node -e 'fetch("https://example.com").then(()=>process.exit(1),()=>console.log("blocked"))'
```

Then run `up` and `doctor --server` from a Codex session started with the
profile. An `EPERM` means the session did not load the profile, the installed
Codex version does not support it, legacy sandbox settings overrode it, or
managed policy refused it. Organization requirements can restrict which
permission profiles are selectable.

To roll back a CLI-only installation, stop using `--profile omb-loopback` and
remove only `$CODEX_HOME/omb-loopback.config.toml`. For a Desktop merge,
restore the previous `default_permissions` and remove only the
`permissions.omb-loopback` tables and the `network_proxy` value if nothing
else uses it.

When the profile is unavailable, run live launcher commands (`up`, `doctor
--server`, `status`, `send`, `watch`, and the rest) through the host's scoped
escalation path. The detached-survival spike against real OpenMausBot passed
under `danger-full-access`, and the native M1 command sequence passed through
the same escalation. Starting the server in a terminal or user service avoids
the listening restriction but not the client's blocked connection; the
client still needs the profile, escalation, or a reachable remote endpoint
from an environment whose network policy allows it.

Repository maintainers have a separate `omb-loopback-dev` profile in the
root `.codex/config.toml`. Its extra `127.0.0.2` rule exists only for the fake
proxy-host scenario in `tests/pair.test.mjs`; that profile and address are not
part of the installable skill.

All three native hosts executed the formal doctor/status/send sequence in
a fresh temporary project on real OpenMausBot 0.1.56. The operator supplied
each acknowledgment message; the host's shell tool invoked the driver,
and OpenMausBot stored the send as `role: user`. This verifies host command
execution, not a distinct OMB sender identity or bot-to-bot communication.
Only Sudo ran; the other four requested model bindings were read back but
not exercised. No task was opened. See `docs/evidence.md` for command and
session records, retries, and the standalone-status fix.

Claude's default permission mode with explicit command allowlists accepted
direct JSON stdout; an initial attempt to redirect results to files was
blocked before any send. Codex used workspace-write with approval review;
Grok used its auto permission mode. These are the tested configurations.
The M1 review's tier 2 (2026-09-08, `docs/evidence.md`) added the
real-server survival spike from Grok and Codex, the Codex skill listing and
state-file writability checks, and the Claude trigger phrase; its tier 3
ran the 100 s foreground and 570 s background watches. Long Codex SSE watches
under the default profile are not unverified any more: they are blocked before
the first frame (2026-09-17, above), so they need the `omb-loopback` profile,
the escalation path, or a reachable remote endpoint.

## OpenClaw, Hermes and dsh (verified 2026-09-16 against real OpenMausBot 0.1.56)

The three remaining hosts ran the same doctor/server-doctor/status/send
sequence in a fresh temporary project, one send each, three Sudo turns in
total. `docs/evidence.md` ("v2 host verification") and
`docs/validation/2026-09-16-hosts-v2.json` hold the ids and outputs. The
driver ran on Node 24.11.0 in all three; OpenClaw itself needs Node 24.16
or later, which can live in its own prefix. Each host has one thing to get
right:

- **dsh**: its shell subprocesses run in their own PID namespace, so the
  driver cannot see the server process. `doctor --server` still passes
  (`provider-keys` reads `unknown: the server's environment is not
  readable`, `identity` reads false), but `status` exits 3 with "the live
  server process identity could not be verified". Pass `--remote --url
  http://127.0.0.1:<port>`: `send` and `status` were verified that way, and
  the rest of the HTTP-only verb set is in "Remote variant" below.
- **OpenClaw**: `tools.exec.mode=allowlist` refuses every turn before any
  command runs ("Codex app-server local execution is unavailable because
  effective tools.exec.mode=allowlist"). Keep `ask`. Under `ask` the Codex
  harness raises one "Codex app-server command approval" card per command,
  with a 120 s window; `openclaw approvals resolve <id> allow-once` clears
  it, and an unanswered card simply expires and the command stays
  sandboxed. Two more facts: the exec allowlist matches command paths, so
  an agent that types `node <script> …` does not match an entry for
  `<script>`; and `skills.entries.<name>.env` is not applied to
  Codex-harness commands, so put `env OMB_BIN=… OMB_TOKEN= ` in front of
  the command itself.
- **Hermes**: `hermes skills list` found nothing until
  `skills.external_dirs: [~/.agents/skills]` was in `~/.hermes/config.yaml`.
  Its terminal backend is `local` with no sandbox, so the driver behaves as
  it does in a plain shell; export `OMB_BIN` in the launching shell.

Inside the OpenClaw sandbox the driver names a blocked socket for what it
is: `status` exits 1 with `cannot reach http://127.0.0.1:<port>: EPERM` and
names the sandbox, and since 2026-09-16 `doctor --server` says the same in
its `health` check and carries the same hint. Only `ECONNREFUSED` reads as
`nothing answers at <url> (ECONNREFUSED)`, which is a server that is not
running.

## Phone mode with OpenClaw on the same machine (verified 2026-09-16)

Telegram → OpenClaw gateway → the agent's shell → loopback OpenMausBot. The
state file under the project keeps every call independent, so a fresh
session or an automation can continue a run. A DM asking for the status
line was answered in the same chat after one approval tap; the record is in
`docs/evidence.md`.

1. Install the skill (table above) and pair the chat: the first DM produces
   a pairing code, `openclaw pairing approve telegram <code>` approves it
   and makes that user the command owner. Put the bot token in a 0600 file
   and name it with `channels.telegram.tokenFile`; never on a command line.
2. Expect one approval card per command. Under `tools.exec.mode=ask` the
   Codex harness asks before each command, the card reaches the same chat,
   and Allow Once runs it. Use allow-once, not allow-always: the card names
   one command, and the allowlist entry that would replace it does not
   match every form the agent types. A card expires after 120 s and the
   command then stays inside the sandbox, where loopback is blocked.
3. Session flow. "start the team on ~/proj and do T10 (bead slg-a9x)" →
   `doctor --project ~/proj`, `up --fresh`, `doctor --server`, then
   `import`, `bind`, and `facts` for that fresh server, then
   `task --todo T10 --bead slg-a9x`, and reply with the `--brief` line.
   When attaching to the same verified server, reuse its binding. After a
   restart, re-import or adopt to establish the new identity before a task;
   the presence of old team state alone is insufficient.
4. Progress reaches the phone either way:
   - An automation, removed after the run is done:
     `openclaw automations create "*/5 * * * *" --command "<abs>/scripts/omb.mjs watch --brief --max-seconds 240 --until change --quiet-if-unchanged --nudge" --command-cwd /home/you/proj --command-env OMB_BIN=<cli.js> --command-env OMB_TOKEN= --announce --channel telegram --to <chat id>`.
     `--command-env` is how the job gets `OMB_BIN`; the skill's own env
     block does not reach it. A run that prints nothing is **not**
     announced: the run records `delivered: false`, `deliveryStatus:
     not-delivered`, `deliverySuppressionReason: "empty"`, so
     `--quiet-if-unchanged` costs no empty messages. A run that prints one
     line delivers it as the run summary. The 2026-09-16 check fired both
     jobs by hand (their run ids begin `manual:`); the cron expression
     itself is still from OpenClaw's own documentation.
   - Interactive: the agent runs `watch --max-seconds 1500 --until change`
     in the background, relays each result, and loops. That background
     path is still unverified.
5. Answers from the phone: "tell Sudo: no new dependency, use a table" →
   `send "no new dependency, use a table"`; "approve" → `answer --allow
   --request <id>`; "what's happening" → `status --brief`.

Automations are admin-authored commands, separate from the agent's exec
allowlist; keep the command line exact.

## Hermes cron adapter (verified 2026-09-16)

Hermes cron `--script` takes a file name under `~/.hermes/scripts/`, not an
absolute path, and treats a non-zero exit as an error alert. A four-line
adapter keeps the expected watch outcomes quiet, exports `OMB_BIN` for the
job's own environment, and lets real failures through:

```sh
#!/bin/sh
# ~/.hermes/scripts/omb-watch.sh
export OMB_BIN=/abs/path/to/openmausbot/cli.js OMB_TOKEN=
/abs/path/skills/openmausbot-launcher/scripts/omb.mjs watch --project /home/you/proj --brief --max-seconds 240 --until change --quiet-if-unchanged
c=$?; case $c in 0|4|5) exit 0;; *) exit $c;; esac
```

`hermes cron create "every 5m" --name omb-watch --no-agent --script
omb-watch.sh --deliver telegram` creates the job. `--deliver` accepts
`origin`, `local`, `telegram`, `discord`, `signal` and `platform:<chat id>`.

Jobs only fire while the Hermes gateway runs: `hermes gateway install`
installs the `hermes-gateway.service` user unit and enables lingering.
`hermes cron run <job id>` fires one immediately and answers "Ran now:
succeeded"; the run writes
`~/.hermes/cron/output/<job id>/<timestamp>.md` with a "Mode: no_agent
(script)" header and the script's output as the body, and the execution row
lands in `~/.hermes/cron/executions.db`. Removing the job removes its
output directory, so copy anything worth keeping first.

The 2026-09-16 run used the `status --brief` form of the adapter because no
run was open; a cron `watch` against a live run is still unverified.

## Remote variant

Verified 2026-09-16 against real OpenMausBot 0.1.56 behind a Tailscale HTTPS
tunnel (`docs/evidence.md`, "v2 remote run", and
`docs/validation/2026-09-16-remote-tailscale.json`). The driver ran on the
server's own machine through the tailnet address, so the tunnel, the token and
the scope rules are evidenced; a genuinely separate machine is not.

A remote driver can only `import --adopt`, `status`, `watch`, `send`, `answer`,
and `interrupt`. Everything else needs the project checkout or the data dir:
`task` refuses with "task needs the project checkout on the server's machine".

**On the OpenMausBot machine.** Publish the loopback port on the tailnet and
mint one code per device:

```sh
openmausbot serve --port 8899 --data-dir <dir> --tailscale --no-pair
openmausbot pair --port 8899 --label launcher           # owner: admin,client
openmausbot pair --port 8899 --label phone --client     # client scope only
```

`--tailscale` logs `tailscale: serving https://<name> → http://127.0.0.1:8899
(only your tailnet can reach it)`; `--tunnel` after `openmausbot login` is the
other transport and is unverified. Start that server by hand — `up` spawns
`serve … --no-pair` without `--tailscale` — and let `up` attach to it
(`owned: false`). Give it a sanitized environment, since the CLI forwards its
own: `env -i PATH=… HOME=… OMB_ASK_BOT_TIMEOUT_MS=600000`, no provider keys, no
`OMB_TOKEN`. Tailscale itself needs the user: install and `tailscale up`, HTTPS
certificates enabled in the admin console, and `sudo tailscale set
--operator=$USER` so serving needs no sudo. `pair` mints on the port it serves,
8799 unless `--port` says otherwise; a code is single use and lives five
minutes.

Pairing is not optional. Loopback trust does not survive the proxy hop — a
tunnelled request without a token is refused with `forbidden: this request came
through a proxy (pair this device to use the server remotely)` (403).

**On the device that will drive it.** Exchange the code once:

```sh
<skill>/scripts/omb.mjs pair --code XXXX-XXXX-XXXX --label launcher \
  --url https://<name>
```

That writes `~/.config/openmausbot-launcher/tokens.json` (mode 0600, in a 0700
directory) keyed by the origin and prints the session's id, label, scopes and
expiry — thirty days — but never the token. `OMB_TOKEN_FILE` names another
file, which is how an owner and a client session live side by side on one
machine. If the answer is lost in transit the verb retries once with the same
attempt id, which the server replays rather than spending a second code. A code
already spent is refused by the server itself: `pairing code is wrong or has
expired; create a new one on the server` (401, exit 3), logged on the server
with the caller's tailnet address. Pass `--replace` to overwrite an origin
already in the table, after revoking the old session. `OMB_TOKEN` still works
for one call; never put a token on a command line.

**Keep the shared state bound to loopback.** The binding is the server's
environment id, not one URL: share the project's state file (or a copy) and add
`--remote --url https://<name>` to each verb. A run opened locally on
`http://127.0.0.1:8899` is then watchable and interruptible through the tunnel —
verified for an owner-scope and a client-scope session, `interrupt` included.
Do **not** run `import --adopt` to change the URL of a state that is already
bound: that rebinds the team to the tunnel and breaks the local verbs (`task`
then reports "needs the project checkout on the server's machine", and putting
the loopback URL back reports a data-dir or an identity failure instead).
`--adopt` is for a state with no team yet.

**Scope.** A client-scope session (`openmausbot pair --client`) can send,
answer, watch, interrupt, and open tasks, but not import, bind, or change
models. The admin route behind `doctor --server` refuses it with `GET
/api/instances -> 403: forbidden: this session lacks the admin scope`, while its
`status`, `watch` and `interrupt` all work. A bearer token beats loopback trust,
so `doctor` warns when `OMB_TOKEN` is set on a loopback URL.

**A revoked token reads as an identity failure**, not as a dead credential: an
unauthenticated `/api/health` through the tunnel answers 200 without a pid, so
the driver cannot tell a rejected bearer from a different server. A *missing*
token is named for what it is — `no token for <origin>: pair this device first`
— so an identity failure with a token in the table means that token no longer
works. Check the token file before doubting the URL. `doctor --remote` still
passes 4/4 without any token, since it only checks what it can reach.

**Revoke the device when you are done** rather than leaving a thirty-day session
alive:

```sh
openmausbot sessions --port 8899             # id, device, scope, last seen, expiry
openmausbot sessions revoke <session id>     # "that device is signed out and its stream is closed"
```

Prefer running the driver on the OpenMausBot machine through an OpenClaw node,
or an SSH tunnel to loopback, which needs no token; pass `--remote` when the
driver runs on another machine through that tunnel. Never bind the server
publicly: loopback is owner trust, not isolation.
