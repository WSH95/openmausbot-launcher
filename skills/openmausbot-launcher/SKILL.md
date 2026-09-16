---
name: openmausbot-launcher
description: Operate a local OpenMausBot (OMB) multi-bot server as the user's launcher. Starts and stops the headless server, imports a team package (.openmaus.json), binds the team to a project with engines and effort, sends a task brief to the lead bot, watches progress, relays the lead's questions and approval cards to the user and the answers back, reconciles the repository between tasks, cleans up orphaned processes and worktrees, and reports with evidence. Use when the user mentions OpenMausBot, OMB, "the team", "the lead" or Sudo, a team package, running a task (T10, a bead, a TODO item) through the bots, or wants to drive the bots from a phone or Telegram. Drives scripts/omb.mjs over the local HTTP API; never modifies OpenMausBot.
license: MIT
compatibility: Node 24 and the openmausbot npm package 0.1.56 (headless server, not the desktop app) on this Linux machine, or a paired session token for status, watch, send, and answer only; git; the project must be a git repository with a test command.
metadata:
  version: "0.1.0"
  author: wsh
  omb-version: "0.1.56"
---

# OpenMausBot launcher

## 1. You are the operator

The bots in OpenMausBot run real coding CLIs on the user's subscriptions.
You drive them; you never do the task yourself, and every bot turn costs
money and minutes, so keep probes short and never re-send what the driver
already dedupes.

`omb` below means the driver next to this file: `<dir of this
SKILL.md>/scripts/omb.mjs`. Run it by path (Claude Code:
`${CLAUDE_SKILL_DIR}/scripts/omb.mjs`; Hermes: `${HERMES_SKILL_DIR}/…`;
other hosts: the directory this file was loaded from, which OpenClaw,
Hermes and DeepSeek Harness each resolve to the installed skill directory).
It needs no dependencies. Every verb prints one JSON object; `--brief`
prints one line for a phone. `--project <dir>` names the project (default: the git root of
the working directory); the driver keeps its state in
`<project>/.omb/state.json`, so later calls need only `--project`.
`omb state --show --project <dir>` prints that file as the driver reads it,
with no lock and no request, so a fresh session can see the recorded server,
team, and run before acting.
`--dry-run` previews actions without HTTP, process, Git, or state mutations;
it never runs the project's tests or creates a lock database.

Exit codes: 0 ok; 1 network or HTTP error (`cannot reach <url>: <cause>`
names the cause: `ECONNREFUSED` means nothing listens there, `EPERM` means
the shell's sandbox blocks outbound connections); 2 usage; 3 precondition
(server down or not owned, bot busy, repository not reconciled, state
missing or stale); 4 the time budget ran out while the run continues;
5 the user is needed; 6 stalled or failed. Read `error` and `hint` in the
JSON before deciding anything.

## 2. Setup once per project

Ask the user for what the driver cannot know: the project directory, the
team package path, the test command, the engine and effort for each role,
the merge policy (`auto` merges and cleans up by itself; `ask` reports and
waits), the task log path and tracker, and whether plan reviews run as
asks or delegations. OpenMausBot itself is not part of this skill: install
the `openmausbot` package separately and either put it on `PATH` or set
`OMB_BIN` to its `cli.js`; `doctor`'s `binary` check names the path and
version it resolved. Then:

```
omb doctor --project <dir>                       # node, binary, git, project, Stop hook
omb up --project <dir> --port 8899 --data-dir <data dir> [--fresh]
omb doctor --server --project <dir>              # health, scope, engines, no provider keys
omb import <package.json> --project <dir>        # or: omb import --adopt "<section>" for a team already on the server
omb bind --project <dir> --default claude/claude-sonnet-5 --reviewers codex/gpt-6-astra/xhigh [--model Nova=claude/claude-fable-5-1/max] [--approval auto] [--approval-for Sage=ask] [--peer-approval Sudo=on]
omb facts --project <dir> --test "npm test" --setup none --merge auto --task-log .project-steward/PROGRESS.md --tracker beads --plan-review ask
```

`up` starts the server detached, strips the provider API keys so bots use
subscriptions, proves the listener is its own child, and records it;
`down` stops only what `up` started. If the port already answers, `up`
attaches without owning. A server takes two consecutive ports (the API and
its webhook receiver), so `up` refuses a port whose neighbour is busy; space
servers two apart. A `doctor` failure named `stop-hook` means the
project's Project Steward Stop hook would replace a Claude bot's report:
set `auto_handoff_mode = "off"` in its `config.toml` and exclude
`.project-steward/runtime/` before any task. `bind` sets the working
folder, models, and approval level only where they differ, and refuses
while a bot works. Both `bind` and a local `import --adopt` add
`.worktrees/` and `.omb/` to the repository's git exclude file, in a linked
worktree too. `--approval-for <bot>=ask|auto` overrides `--approval` for one
bot; `--peer-approval <bot>=on|off` sets `approvePeerComms`, which makes that
bot raise a "@X wants to contact @Y" card before each `ask_bot`,
`delegate_bot`, or room post — answer it with `answer --allow --request <id>`.
`facts` rewrites the lead's Project facts block; the
dev-team pack's fields are in `references/dev-team.md`. The test and setup
commands come only from your flags (or `--text`); the lead's own block is
never executed, and the result's `provenance` says where each came from.

Use Node 24. Local task and report commands need the server's readable,
matching data directory. A restarted server needs a fresh import or adopt
binding. A live or unverified owned server must be resolved before selecting
another server; `up --fresh` reserves a unique directory.

## 3. Per task

One run per team at a time. Start it in the lead's own chat, never in a
room:

```
omb task --project <dir> --todo T10 --bead slg-a9x      # or: omb task --project <dir> "<free brief>"
```

`task` checks that the team is idle, nothing is queued, and the root is
reconciled; opens one fresh task thread per bot tagged with the run id;
sends the brief once, ending with the instruction to close with a line
containing only `DONE oml:<run id>`; and records the run. If it stops
half way, `omb task --resume` continues the same run; `omb task --abandon`
closes it. The driver has no force option.

Then loop on the watch until a terminal state:

```
omb watch --project <dir> --max-seconds 100 [--brief]
```

`watch` returns as soon as the run settles, the user is needed, or the
budget ends (exit 4, run still going: call it again; the state file
carries the cursor). Never declare a run finished from `status` alone: a
single snapshot cannot see the 30 s of quiet that settlement needs.
`status` and `report` say `carried: true` when their verdict is the last
watch's, not their own.
If `checkpointed:false`, the returned observation was not saved; call
`watch` again. Observation uses `--max-seconds`, followed by at most one
second waiting for a checkpoint lock. Quiet starts afresh each invocation.

## 4. Reading `watch`

| `state` | Meaning | What you do |
|---|---|---|
| `done` (0) | The lead's last text carries this run's marker line | Read the closing report to the user; then `report` (section 6). Done means the lead closed the run, not that everything passed |
| `needs-user` (5) | A card, connector, or credential request is pending, or a bot is waiting on you | Relay `pending[]` verbatim and answer with section 5 |
| `attention` (5) | Settled without the marker: the lead stopped early (Premise fails, BLOCKED, a plain question) | Read `lead.text` to the user; answer with `send` |
| `stalled` (6) | A teammate's outcome is newer than the lead's last text and the lead stays idle (a dropped wake), or no change for 40 min | `omb send "status?"` wakes the lead; if it stays silent, `interrupt`, then ask the user |
| `failed` (6) | The lead is dead or its turn failed to dispatch | Read the tail (`status --tail 10`), tell the user |
| `running` / `timeout` (4) | Working, or the budget ended | Relay new lead text if any, call `watch` again |
| `running` with `unknown: true` | A snapshot was incomplete (a read failed) | Check `incomplete[]`; run `doctor --server` if it repeats |

`changes[]` lists what moved since the last report; `brief` is the phone
line. Relay the lead's own words; do not paraphrase decisions.

## 5. Answering

- A plain-text question or decision: `omb send "no new dependency, use a
  table"`. It goes to the lead's run thread with a deduplicating send id.
  With no open run, it uses the lead's current thread; `omb status --tail 10`
  shows that conversation without declaring a task complete. The reply's
  `duplicate: true` means the server matched an earlier identical send in
  this run and stored nothing new; `omb send --again "…"` repeats it on
  purpose.
- An approval card (a bot wants to contact a peer): `omb answer --allow
  --request <id>` or `--deny`. A question card: `omb answer --message
  "…" --request <id>`. With one pending card `--request` may be omitted.
- The server answers `unavailable` when a card died with the bot's turn;
  a textual answer then falls back to chat automatically, an allow or deny
  does not: tell the bot in chat what you decided.
- Connector, credential, skill, and routine requests are reported as
  unsupported with the route they need; hand them to the user. Skill and
  routine cards never receive a response POST from this driver. Read
  `pending[].cardKind`, full `text`, `options`, and payload metadata;
  upstream options messages have no `card.kind`. The brief is a summary.
- `omb interrupt` stops the run's current turn; nothing else.
- Keep the user's words. Never answer on the user's behalf.

## 6. Finish and clean up

```
omb report --project <dir> --md [--check-042]   # forensics, record step, tests; closes the run
omb reconcile --project <dir>                   # root on the default branch, one worktree, clean
omb cleanup --project <dir> --kill              # sandbox processes left in deleted worktrees
omb down --project <dir>
```

`report` runs the project's test command itself, checks the root afterward,
verifies requested record evidence, and closes a settled run as passed,
incomplete, or failed; append its markdown to the evidence file. Missing or
skipped required evidence stays unknown and cannot pass; inspect `unknown`
and `failedChecks`. `--check-042` requires all nine pack checks.

`report --run last` reads archived run context without contacting the server.
It appends a reanalysis while preserving the original result. Add
`--dry-run` for a read-only reanalysis: no tests and no state writes. An
older run whose roster and environment cannot be corroborated is incomplete.
A stopped task keeps its worktree on purpose: remove it
only when the user says so, with `reconcile --remove <slug>`.

## 7. Guardrails

- Never fork or patch OpenMausBot; the driver uses its HTTP API and CLI
  only. Never bind the server to a public address.
- Never drive the lead from a room; only its own thread wakes it.
- Installed playbooks cannot be edited: a rule change is a re-import.
- Use ids with the server, not names: the driver resolves names for you, and a bot's own tools do not.
- `/api/decisions` is a log of every card ever shown, not a queue.
- Chains are one hop; the lead is woken at most three times in five
  minutes, and a fourth outcome is dropped: that is what `stalled` and
  `send "status?"` are for.
- Never retarget a message to a different thread on a 409; the driver
  reports the active thread and waits for an explicit `--thread`.
- Tokens live only in `OMB_TOKEN` or the 0600 token file, never in a
  command line or a message.
- Never delete or replace `.omb/lock.sqlite` to clear a busy writer. For
  the legacy `.omb/lock` upgrade refusal, stop every launcher command and
  automation, update every installed copy, then remove only the legacy
  path. See `references/limits-and-pitfalls.md` for recovery details.

## 8. Hosts and phone mode

Claude Code and Grok Build: `--max-seconds 100`, or 570 in a background
shell. Codex: `--max-seconds 100`; `up` needs an escalated command
because the sandbox denies listening sockets, and so does every live verb
when the sandbox blocks loopback (`cannot reach … EPERM`). OpenClaw:
`--max-seconds 1500` in the background, or an automation that announces to
Telegram (an automation that prints nothing sends nothing); its Codex
runtime asks for one approval per command, so answer each card with
allow-once, keep `tools.exec.mode` at `ask`, and put `env OMB_BIN=…` in
front of the command because the skill's env block does not reach it.
Hermes: `--max-seconds 240` from a cron adapter, and the skill is invisible
until `~/.hermes/config.yaml` lists `~/.agents/skills` in
`skills.external_dirs`. DeepSeek Harness: add `--remote --url
http://127.0.0.1:<port>` to every live verb, because its shell runs in its
own PID namespace and the local identity check cannot pass (`status` exits
3). Install paths, allowlists, and the recipes are in
`references/hosts.md`.

## 9. References

- `references/api.md`: the OpenMausBot 0.1.56 routes, shapes, 409 rules,
  SSE frames, and data-dir files the driver relies on.
- `references/limits-and-pitfalls.md`: budgets, dead cards, sandbox
  facts, and what was tried and rejected.
- `references/hosts.md`: per-host install, time budgets, phone recipes.
- `references/dev-team.md`: the dev-team pack's roster, Project facts,
  brief, closing report, record step, and the 0.4.2 checks.
- `references/evidence.md`: what a run record must contain.
