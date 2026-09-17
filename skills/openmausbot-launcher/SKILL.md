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

Start it in the lead's own chat, never in a room:

```
omb task --project <dir> --todo T10 --bead slg-a9x      # or: omb task --project <dir> "<free brief>"
```

`task` checks the root is reconciled; picks the run's own worktree
`.worktrees/<slug>` on `task/<slug>` and refuses a name that already exists;
claims an idle Implementer the team has and names both in the brief; opens
the lead's fresh task thread tagged with the run id; sends the brief once,
ending with the instruction to close with a line containing only
`DONE oml:<run id>`; and records the run. If it stops half way,
`omb task --resume` continues the same run; `omb task --abandon` closes it.
The driver has no force option.

**A second run** is allowed while the first is open, when the user asks for
parallel work: the lead must be idle at that moment, the new run needs its
own name, and it needs an implementer no open run has claimed. When they are
all taken, ask the lead to create one ("Sudo, create a second implementer")
**before** you open the first run, and then adopt and bind it:

```
omb import --adopt <section> --project <dir>   # records the new bot
omb bind --project <dir> --default <eng/model> # gives it this project
```

A bot the launcher never bound is not this team's: it has no working folder
here, `--bot <name>` cannot reach it, and `task` refuses to claim it. Neither
adopt nor bind is allowed while a run is open, so this happens first.
The lead still runs one turn at a time, so "parallel" means two open tasks
whose implementers work at once, not two lead turns. Later runs keep the
specialists' existing threads: only the lead gets a thread per run.

From then on every run-scoped verb takes `--run <ref>` — a slug, a title, a
tag, or a run id — and with two runs open it refuses to guess: `send`,
`answer`, `interrupt`, `watch`, `report`, `task --resume`, `task --abandon`.
`status` reports all of them in `runs[]`. A closed run is read with
`report --run <ref>`; nothing speaks to it any more. While two are open, every
command the driver prints for you to run already carries its `--run`.

Then loop on the watch until a terminal state:

```
omb watch --project <dir> [--run t10] --max-seconds 100 [--brief]
```

`watch` returns as soon as the run settles, the user is needed, or the
budget ends (exit 4, run still going: call it again; the state file
carries the cursor). Never declare a run finished from `status` alone: a
single snapshot cannot see the 30 s of quiet that settlement needs.
`status` and `report` say `carried: true` when their verdict is the last
watch's, not their own. A run settles on its own evidence: the other run's
bots working, or its threads moving, neither delay it nor settle it.
If `checkpointed:false`, the returned observation was not saved; call
`watch` again. Observation uses `--max-seconds`, followed by at most one
second waiting for a checkpoint lock. Quiet starts afresh each invocation, so
a budget that ends inside the window returns `state: "timeout"` with the idle
time it observed, and a `hint` naming the budget to use when that window alone
would settle the run; `report` gives such a run the same advice while it leaves
it open, and `--close` only records a run as it is. A run whose lead owes a wake
or an answer gets no such hint: it needs the lead, not a longer watch.

`outcome: "unverified"` means repeated relevant changes prevented a confirmed
view: `state: "running"`, exit 4, `complete: false`, `checkpointed: false`.
Call `watch` again; `--quiet-if-unchanged` never hides this result. The watch
checks for late events and locally saved progress through its final return.
Even a discarded read restarts quiet if it sees busy or changed evidence.
It retains observed outcomes through pruning and uses newer saved progress
for the stall clock. Ordinary foreign bot/runtime traffic does not reset
this run's quiet; a busy lead stays shared unless readable runtime history
proves which run it is executing.

Stream parsing and automatic nudge requests share the observation deadline.
A nudge cannot switch or retry after its request times out. A canceled
optional checkpoint cannot write later; `checkpointed:false` also covers
that timeout even when the returned verdict remains verified.

## 4. Reading `watch`

| `state` | Meaning | What you do |
|---|---|---|
| `done` (0) | The lead's last text carries this run's marker line | Read the closing report to the user; then `report` (section 6). Done means the lead closed the run, not that everything passed |
| `needs-user` (5) | A card, connection, or credential request is pending, a settled one never woke its bot (`resumable[]`), or a bot is waiting on you | Relay `pending[]` and `resumable[]` verbatim and answer with section 5; `handle` is what `--request` takes, and a `resumable` entry takes `--resume` |
| `attention` (5) | Settled without the marker: the lead stopped early (Premise fails, BLOCKED, a plain question) | Read `lead.text` to the user; answer with `send` |
| `stalled` (6) | A teammate's outcome is newer than the lead's last text and the lead stays idle (a dropped wake), or no change for 40 min | `omb send "status?"` wakes the lead; if it stays silent, `interrupt`, then ask the user |
| `failed` (6) | The lead is dead or its turn failed to dispatch | Read the tail (`status --tail 10`), tell the user |
| `running` / `timeout` (4) | Working, or the budget ended | Relay new lead text if any, call `watch` again |
| `running` / `timeout` with `complete: false` | The observation could not be verified | Check `incomplete[]`; call `watch` again, then `doctor --server` if reads keep failing |

`changes[]` lists what moved since the last report; `brief` is the phone
line. Relay the lead's own words; do not paraphrase decisions.

## 5. Answering

- A plain-text question or decision: `omb send "no new dependency, use a
  table"`. It goes to that run's lead thread with a deduplicating send id.
  A message reaches only the bot's active task, so when the lead is sitting
  on the other run's task the driver makes this run's task active again and
  posts once more (`switched: true`). It cannot do that while the lead is
  working: exit 3, "the lead is working on <run>; retry when it is idle".
  With no open run, it uses the lead's current thread; `omb status --tail 10`
  shows that conversation without declaring a task complete. The reply's
  `duplicate: true` means the server matched an earlier identical send in
  this run and stored nothing new; `omb send --again "…"` repeats it on
  purpose.
- `send --bot <specialist> --run <ref>` refuses a thread another open run
  records unless a complete observation attributes that bot only to this
  run. Missing or ambiguous ownership also refuses the dry-run preview.
  Send to the run's lead, or name `--thread <id>` to address the shared
  destination explicitly; an explicit thread is never switched for you.
- An approval card (a bot wants to contact a peer): `omb answer --allow
  --request <id>` or `--deny`. A question card: `omb answer --message
  "…" --request <id>`. With one pending card `--request` may be omitted —
  unless no open run owns it, which is the driver saying it cannot tell whose
  it is; name it with `--request` then.
  A card keeps its first observed owner after that run closes or its bot
  switches tasks or leaves the team. Closed owners' cards remain shared and
  require `--request`. An old card with no recoverable thread keeps the
  snapshot incomplete; closing its owner does not prove it was answered.
  Remembered card threads are read even before the remaining runs' dispatch
  times. Only the server's confirmed deletion of a historical-only thread
  retires its requests; other read failures leave the observation incomplete.
- The server answers `unavailable` when a card died with the bot's turn;
  a textual answer then falls back to chat automatically, an allow or deny
  does not: tell the bot in chat what you decided.
- A routine proposal: read `pending[].title` and `subtitle` to the user, then
  `omb answer --confirm --request <id>` or `--cancel`. A refusal is the
  server's own words. Revalidation failures leave `held` text on the card;
  ownership or payload-id refusals need not. Read `held` if present, then
  cancel and ask for a fresh proposal when the refusal requires it.
- A learned skill: read `pending[].skillRequest.preview` to the user — that is
  the whole skill — then `omb answer --allow --reviewed <sha256> --request
  <id>`, with the `sha256` from the same card. Anything else denies it, so
  there is no way to comment: `--message` is refused.
- A credential: **never handle the value yourself.** Do not ask the user to
  paste it to you, do not put it in a command you run, and do not repeat it
  back — anything you compose is kept in this session's transcript. Give the
  user one of these two, and run nothing until they say it is done:
  - they write the value into a user-owned file with mode 0600, and you run
    `omb answer --provide --secret-stdin --request <messageId> < ~/.omb-secret`
    — the command names the path, never the value — then they delete the file;
  - or they run the command in their own shell after
    `read -rs OMB_SECRET && export OMB_SECRET`, which reads it without echoing
    it; the driver inherits it without the value appearing in the command.

  The driver puts it into the server's settings and tells the card; it appears
  in no output, no state file, and no preview. If the save lands but the card
  does not, `omb answer --resume --request <messageId>` finishes it — that
  route carries no value. Settled cards in `resumable[]` accept only
  `--resume`; pending cards can also be dismissed. After an ambiguous save,
  only a not-configured to configured transition verifies the write. If a
  value was already configured, `saveOutcome: "unknown"` at exit 3 leaves
  the choice to the user: resume on whatever is stored, or provide again.
  `boxToken` is refused here: provide it in the app. The `xAI` and `OpenCode`
  keys are refused while any bot is busy or any team-map work is queued or
  running anywhere on the server, because saving one restarts every provider.
  The driver checks before reading the value and immediately before the PUT;
  the server cannot make that check atomic. Wait for the fleet to settle.
- A connected app: `omb answer --connect --request <messageId>` returns a link
  once, for the user to open (exit 5). When they are done,
  `omb answer --resume --request <messageId>`; one request can ask for several
  apps and they resume together, so a resume refuses until every one of them
  is connected — and refuses before asking the provider anything while any of
  them is `required` or `failed`, naming the `--connect` command for each.
  A dismissed sibling prevents that family from resuming. Status reads can
  wake the bot themselves; the driver re-reads the family before deciding
  whether to post resume. `--dismiss` does **not** wake the bot; tell it with
  `send`. Carry `--run <ref>` into these commands when two runs are open.
- Read `pending[].cardKind`, full `text`, `options`, and payload metadata;
  upstream options messages have no `card.kind`. The brief is a summary and
  names the command for that kind.
- `omb interrupt [--run <ref>]` stops that run's current turn; nothing else.
  A turn the lead is running on another run's thread cannot be reached from
  here at all ("the bot switched tasks before it could be interrupted"): wait
  for the lead to go idle, then `task --abandon --run <ref>`. With two runs
  open the specialists share one thread each, so `--bot <name>` is refused
  unless this run is the only one that claims that bot — naming a run is not
  proof that the turn running there is its own.
- Keep the user's words. Never answer on the user's behalf.

## 6. Finish and clean up

An anonymous partial queue drop leaves possible surviving delegations
in flight. Reports stop attributing later shared-thread turns through the
dropped batch's windows, so those turns and tokens remain `shared`. A very
large ambiguous history stays conservatively open instead of inventing
completion; inspect its delegation evidence before declaring the run done.

```
omb report --project <dir> --md [--check-042]   # forensics, record step, tests; closes the run
omb reconcile --project <dir>                   # root on the default branch, one worktree, clean
omb cleanup --project <dir> --kill              # sandbox processes left in deleted worktrees
omb down --project <dir>
```

`report --run <ref>` reports one run: it runs the project's test command
itself, checks the root afterward — another open run's worktree is that run's,
not a leftover — verifies the record evidence that names this run, and closes
it as passed, incomplete, or failed, leaving any other open run alone; append its markdown to the evidence file. Missing or
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
  command line or a message. For a remote server, `pair --code XXXX-XXXX-XXXX
  --url https://host` mints that file entry from a code the owner made with
  `openmausbot pair`; the file is 0600 and the token is never printed.
- Never delete or replace `.omb/lock.sqlite` to clear a busy writer. For
  the legacy `.omb/lock` upgrade refusal, stop every launcher command and
  automation, update every installed copy, then remove only the legacy
  path. See `references/limits-and-pitfalls.md` for recovery details.

## 8. Hosts and phone mode

Claude Code and Grok Build: `--max-seconds 100`, or 570 in a background
shell. Codex: `--max-seconds 100`; default `workspace-write` denies local
listening and loopback HTTP. Before the first live command, read the Codex
section of `references/hosts.md` and explicitly install and select the bundled
`assets/codex/omb-loopback.config.toml` profile. It retains workspace write
access and allows only `127.0.0.1` and `localhost`; use scoped escalation or a
reachable remote server when custom profiles are unavailable. OpenClaw:
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
