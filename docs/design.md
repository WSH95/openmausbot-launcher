# openmausbot-launcher design

Approved design of 2026-09-08, including the M1.1 correctness review. This file is the design authority; Beads owns implementation tracking (`oml-t8u` for M1.1).


## Context

Over the M6/M7 runs, a Claude Code session acted as the user's launcher for
OpenMausBot (OMB): it started the headless server, imported the dev-team
package, bound the team to a project, briefed the lead, watched the chain,
relayed questions and answers, reconciled the repository between tasks, and
cleaned up. That role is owned by no code today: the rules live in
`docs/setup-guide.md`, the session's memory, and 279 lines of scratch bash
(`scripts/omb-watch.sh`, `omb-chain-status.sh`, `bind-team.sh`,
`omb-chain-report.sh`).

The user wants that role as a generic Agent Skill so any host (Claude Code,
Codex, Grok Build, OpenClaw, Hermes, DeepSeek Harness) can drive OMB, and so
OpenClaw on the workstation can drive it from a phone over Telegram.

Feasibility, confirmed by the surveys of 2026-09-07/08 and two Codex
(gpt-6-astra, xhigh) review rounds whose source-level claims were verified
against the 0.1.56 source and folded in below:

- Every named host loads agentskills.io `SKILL.md` directories with bundled
  `scripts/`. Codex, OpenClaw, Hermes, and DSH share `~/.agents/skills`; Grok
  reads `~/.claude/skills`; Claude Code reads only its own roots (a symlink is
  its documented install).
- OMB 0.1.56 headless: a non-proxied loopback caller has full admin over plain
  HTTP JSON; `GET /api/events` (SSE) pushes `bot`, `message`, and `notify`
  frames; `GET /api/team-map` shows queued and running delegations; a bearer
  session token works on every route including the event stream
  (`server/request-auth.ts:326-334`), so no stream tickets are needed.
- OpenClaw automations run a command on a schedule and announce its output to
  a Telegram chat; Hermes cron has `--no-agent --script` with
  `deliver: telegram`.

## Decisions (user, 2026-09-08)

1. **Home: a new standalone repository** `~/Documents/openmausbot-launcher`
   with its own Project Steward and beads. Decision 0009 keeps
   agent-team-devpack the pack's home; agent-team-cli has "no OMB dependency".
2. **Phone path: documentation only** this round. Real verification on the
   three installed hosts (Claude Code 2.1.263, Codex 0.153.4, Grok Build
   1.0.13). OpenClaw, Hermes, DSH get install and phone recipes from their
   docs, marked unverified, with a follow-up bead.
3. **Topology: same machine.** OpenClaw gateway and OMB on the workstation:
   loopback, no pairing. Remote is a token in the environment or a 0600
   file, tested against the fake server only; the `pair` verb is deferred.
4. **Team packages are supplied inputs.** `dev-team.openmaus.json` is an
   external test configuration. The launcher has no required package path,
   release, roster, or bot names. Import reads the chosen package, selects
   its chief of staff or the explicit `--lead`, and records the returned
   identities; model bindings come from the caller. Package behavior checks
   are optional diagnostics and do not define launcher acceptance
   (Decision 0006).

Calls made by the agent: generic OMB operator core with the dev-team pack
conventions in a reference file; driver = dependency-free Node ESM `.mjs`
(one entry point plus small internal modules, no artificial line cap; Node 24
where OMB runs, since OMB itself requires it); headless-only (the desktop
build refuses outside writes, `docs/upstream/0004`); config by env and
flags; a locked per-project state file so fresh sessions resume; **one task
at a time per team in v1**; **server lifecycle management (`up`, `down`,
`cleanup --kill`) is Linux-only in v1** (macOS gets `attached` and reports);
the skill lives under `skills/` in the repo like `agent-team-cli` and the
devpack, so the installed unit carries no steward or beads files.

## Repository layout

```
openmausbot-launcher/
├── skills/openmausbot-launcher/         # the installable unit (npx skills add discovers skills/)
│   ├── SKILL.md                         # ~220 lines: operator model, loop, rules, verbs, hosts
│   ├── scripts/omb.mjs                  # entry point, #!/usr/bin/env node, chmod +x
│   ├── scripts/lib/{http,state,server,snapshot,watch,git,report}.mjs
│   ├── agents/openai.yaml               # Codex interface metadata ($openmausbot-launcher)
│   └── references/
│       ├── api.md                       # routes, shapes, 409 texts, SSE frames (0.1.56, source lines)
│       ├── limits-and-pitfalls.md       # budgets, dead cards, tried-and-rejected
│       ├── hosts.md                     # per-host install, allowlists, time budgets, phone recipes
│       ├── dev-team.md                  # roster advice, Project facts block, brief template with the run marker, record step
│       └── evidence.md                  # evidence section template (what `report --md` emits)
├── tests/*.test.mjs                     # node:test; explicit discovery: node --test 'tests/**/*.test.mjs'
├── tests/fixtures/fake-omb.mjs          # contract fake; `serve` spawns a child that answers health with its own pid
├── docs/design.md (authoritative, as in agent-team-cli), docs/evidence.md
├── AGENTS.md, CLAUDE.md (adapter), README.md, LICENSE (MIT), package.json, .gitignore
├── .project-steward/ (auto_handoff_mode = "off", commit_policy = "auto", never_push = true)
├── .beads/ (prefix oml), .claude/settings.json (bd prime hook), .codex/, .agents/skills/beads/
```

## Driver: `scripts/omb.mjs`

Invoked by path (`<skill>/scripts/omb.mjs <verb> …`) so exec allowlists can
name one file. Stdout is one JSON object (`{ok, verb, …}` or
`{ok:false, error, status?, hint?}`), or one line with `--brief`. Every HTTP
request carries cancellation and a timeout capped at 15 s or the remaining
observation budget; the event stream uses a
resettable idle watchdog (45 s without a frame aborts and reconnects).

**Configuration** (first wins): URL `--url` > state `server.url` > `OMB_URL`
> `http://127.0.0.1:8799`; token `OMB_TOKEN` >
`~/.config/openmausbot-launcher/tokens.json[url]` (0600; no `--token` flag,
so no credential lands in argv or a transcript); data dir `--data-dir` >
state > `OMB_DATA_DIR` > `~/.openmausbot`; binary `OMB_BIN` (path to
`cli.js` or `openmausbot`) > `openmausbot` on PATH; project `--project` >
`OMB_PROJECT` > nearest git root above cwd; state `--state` > `OMB_STATE` >
`<project>/.omb/state.json`. Non-loopback URLs must be `https` unless
`--allow-insecure-http`. Global flags: `--brief`, `--dry-run`, `--verbose`.

**Modes.** `--remote` or a non-loopback URL selects remote operation;
loopback defaults to local. Missing data does not change modes: `doctor`
and `up` must be able to bootstrap a new directory. Local `import <pkg>`,
`bind`, `facts`, `task`, and live `report` require a readable directory whose
`environment-id` matches the server. HTTP-only remote operations are
`import --adopt`, `status`, `watch`, `send`, `answer`, and `interrupt`, plus
read-only `state` and diagnostic `doctor`. Remote observations ignore local
receipts. An SSH tunnel to another machine must use `--remote`.
Session scope is checked separately from location: client-scope sessions can
send, answer, watch, and open tasks but not import, bind, or change models
(`request-auth.ts:185-250`); a bearer token beats loopback trust
(`request-auth.ts:326`), so `doctor` warns when `OMB_TOKEN` is set on a
loopback URL. Supported runtime: Node 24.

**Dry runs.** All verbs preview without HTTP mutations, signals, test
execution, state writes, or lock creation. Git reads disable optional index
locking; `reconcile --remove --dry-run` preserves both worktree and branch.
Dry runs may still make HTTP reads and report failed preconditions.

**Exit codes**: 0 ok or condition reached; 1 HTTP/network error; 2 usage;
3 precondition failed (server down or not owned, bot busy, repo not
reconciled, state missing, stale or ambiguous, server identity changed,
description over 4000); 4 time budget exhausted while running; 5 the user
is needed; 6 stalled or failed.

| Verb | Arguments | Does | OMB surface |
|---|---|---|---|
| `doctor` | `[--server]` | bootstrap: Node ≥ 24 (supported runtime), binary and version, git, project is a git repo, Stop-hook check only when `.project-steward/` exists (parse `[session] auto_handoff_mode`; must be `off`; runtime dir excluded), state summary, `OMB_TOKEN` on loopback warning; `--server` adds readiness: health, session scope, engines and effort levels, provider key variables absent from `/proc/<pid>/environ` (`unknown` when unreadable) | `/api/health`, `/api/auth/session`, `/api/instances` |
| `up` | `[--port] [--data-dir] [--fresh] [--label] [--ask-timeout-ms 600000] [--timeout 60]` | if the recorded owned instance is alive and verified: `owned`, no change; if an unrecorded server answers: `attached` (`--fresh` exits 3 instead of adopting); else spawns `<bin> serve --port --data-dir --no-pair` detached (setsid, unref, stdio to `<dataDir>/serve.log`) with `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`XAI_API_KEY`/`OMB_TOKEN` removed (the CLI forwards its whole environment, `cli.ts:434`) and `OMB_ASK_BOT_TIMEOUT_MS` set; waits for health; **proves ownership before recording it**: the health pid's parent (`/proc/<pid>/status` PPid) is the supervisor it spawned (`cli.ts:455`), then records supervisor pid and start time, health pid and start time (`/proc/<pid>/stat` field 22), url, data dir, and the persistent `environmentId` (`environment.ts:58`, written once per data dir); refuses a port whose neighbour `port + 1` is taken, since the server binds it for its webhook receiver (`index.ts:319-320`, `cli.ts:438`), reports a URL that answers as that receiver with its API port, and lists `ports: [N, N+1]` in its dry-run and started results | CLI, `/api/health`, well-known |
| `down` | `[--timeout 15]` | refuses unless owned and verified: loopback URL, both pids alive with the recorded start times, health pid's parent is the supervisor, health answers with the recorded pid, environment id matches; then SIGTERM the supervisor (it stops its child, `cli.ts:462-473`), wait, verify exit; read-only orphan scan | `/api/health`, `/proc` |
| `import` | `<package.json> [--lead NAME]` or `--adopt <section-or-lead>` | `POST /api/teams/import?mode=add`; keeps the returned ids; maps package keys to returned bots by input order and name with numbered-suffix tolerance ("Sudo 2"); lead = the returned bot with `chiefOfStaff: true`, else `--lead` required; zero or many rooms; `--adopt` is the read-only attach for an existing team (also remote); records the server `environmentId`; a local `--adopt` in a git checkout also adds `.worktrees/` and `.omb/` to the repository's `info/exclude` and reports `exclude` | `/api/teams/import`, `/api/bots` |
| `bind` | `[--default eng/model[/effort]] [--reviewers eng/model/effort] [--model "<bot>=…"]… [--approval auto\|ask] [--approval-for "<bot>=ask\|auto"]… [--peer-approval "<bot>=on\|off"]… [--no-room]` | launcher-level idle check first; room `cwd` only when it differs (a pinned room rejects even an equal `cwd`, `index.ts:9566`); bot `cwd`; model only when it differs (equal selections pass while busy, `index.ts:1050-1057`, but a pending approval grant rejects any model PATCH, `index.ts:9930`); approval mode, team-wide from `--approval` or per bot from `--approval-for` (a grok bot under `auto` is skipped with a note and set to `ask` when its field is absent, `store.ts:1303-1335`); `--peer-approval` PATCHes `approvePeerComms` only when it differs (boolean only, `index.ts:10212-10217`), the gate behind the `@X wants to contact @Y` card on `ask_bot`, `post_to_room` and `delegate_bot` (`index.ts:7842`, `8113`; `delegations.ts:514`; `peer-approval.ts:95-119`); `.worktrees/` and `.omb/` into `.git/info/exclude`; re-reads the roster; reports partial results per bot; exit 3 on any 409 | `PATCH /api/groups/:id`, `/api/bots/:id` (`cwd`, `approvalMode`, `approvePeerComms`), `/api/bots/:id/model` |
| `facts` | `--default-branch --test --setup --merge --task-log --tracker --plan-review` or `--text` | replaces the lead description from the exact marker `Project facts` to the end (error when absent unless `--append`), asserts `< 4000`, infers the default branch from git | `PATCH /api/bots/:id {description}` |
| `task` | `"<brief>"` or `--todo T10 [--bead ID]`, `[--title] [--resume] [--abandon]` | see "Task lifecycle" | `POST /api/bots/:id/tasks`, `/api/bots/:id/messages`, `/api/team-map` |
| `send` | `"<text>" [--bot] [--thread]` | message to the lead's run thread with a deterministic `sendId`; a retry resends the identical thread, text, and `sendId`; a 409 "the bot switched tasks" is reported with the active thread in the hint and **never retargeted** (`index.ts:10751-10798`); a late-steer 409 after settlement is reported as undelivered; a 202 `queued` or `steered` receipt is recorded | `POST /api/bots/:id/messages` |
| `answer` | `--allow\|--deny\|--message "<text>" [--request ID]` or `"<text>"` | typed requests: ordinary question and approval cards (`card.requestId`, unanswered, undismissed) are answered on the owning thread with outcomes `allowed-once\|rejected\|answered\|unavailable` reported as is; an `unavailable` **textual** answer on the lead's run thread falls back to `send`; an unavailable allow or deny is never turned into chat; `--request` required when more than one card is pending; connector, credential, skill (reviewed-hash) and routine requests are **reported with their type and route, exit 5, unsupported in v1**; bare text = `send` | `POST /api/threads/:id/respond` |
| `status` | `[--bots] [--tail N]` | one snapshot plus the evaluation; without an open task, returns `run: null`, roster, latest leader/user messages and the requested tail without a task verdict; never blocks | snapshot routes |
| `watch` | `--max-seconds N` (default 100) `--until settled\|change\|question` `[--poll 30] [--stall-minutes 40] [--nudge] [--quiet-if-unchanged]` | see below | `/api/events`, snapshot routes, receipts file |
| `interrupt` | `[--bot]` | stops the run's turn only: always sends `{threadId: <run thread>}`; a 409 (the bot is busy in a room or routine, `index.ts:11044`) is reported, never overridden; takes no state lock, since it writes nothing | `POST /api/bots/:id/interrupt` |
| `reconcile` | `[--check]` (default) `[--remove <slug>]…` | exactly one worktree, no `task/*` branch, clean `git status --porcelain --untracked-files=normal`, on the default branch; `--remove` = `git worktree remove` then `git branch -D`, explicit slugs only | git |
| `cleanup` | `[--kill] [--pattern codex-linux-sandbox] [--down]` | processes matching the pattern whose cwd is under `<project>/.worktrees/` and deleted; never a pid recorded as the owned server; identity (pid, start time, cwd) rechecked before SIGTERM and again before SIGKILL (5 s later); Linux only, macOS reports | `/proc`, `pgrep` |
| `report` | `[--md] [--check-042] [--run last\|ID] [--no-tests] [--close\|--no-close]` | turns and tokens from **every run thread's** `events/<thread>.ndjson`, outcomes for the run, lead text, decisions, `git log <sentSha>..HEAD`, worktree list; verifies the record step; runs the project test command independently; `--check-042` adds the pack-validation checks (below); `--md` renders the evidence section; **closes the run**: moves `task` to `history` by `runId` with a result of `passed`, `incomplete`, or `failed` | data dir, git, `bd show` |
| `state` | `--show` | read the state | file |

Deferred to v2: `pair` (documented as `openmausbot pair` plus one `curl`
into the 0600 token file), `send --room` (the rule is never to drive the
lead from the room), `state --set`, macOS lifecycle, connector, credential,
skill and routine requests in `answer`.

### Task lifecycle (`task`)

1. Inside the command transaction, check state and server identity;
   no run in `preparing` or `dispatched` (else exit 3 with the hint to
   `task --resume` or `task --abandon`); no team bot busy and nothing queued
   or running in team-map for team bots; `reconcile --check` passes.
2. Under the state lock, persist the intent: `runId`, `status: preparing`,
   the brief, `sendId = task-<runId>`, and the run's thread title
   `<title> [oml:<runId8>]` (task creation has no idempotency key and titles
   may repeat, `store.ts:1607`, `index.ts:11105`; the tag is what makes a
   thread attributable to this run).
3. Still holding the lock (writers wait up to 60 s), for each team bot:
   look for tasks whose title carries the tag in `GET /api/bots` `tasks[]`;
   exactly one → adopt; more than one → stop, exit 3 `ambiguous`; none →
   `POST /api/bots/:id/tasks`, and checkpoint the returned thread id into
   state before the next bot.
4. Send the brief to the lead's run thread with the run's `sendId`; the
   brief ends with the run marker instruction (below); record the 202
   receipt; `status: dispatched`; release the lock.
5. `--resume` re-enters at step 3 with the same `runId`, `sendId`, brief,
   and tag (a repeated send with the same `sendId` returns the canonical
   receipt). `--abandon` marks the run `closed` with result `abandoned`
   without touching the server. There is no `--force`.

The brief's last paragraph, from `dev-team.md`'s template: "When the task
is finished, end your closing report with a line containing only
`DONE oml:<runId8>`." The marker is run-specific and anchored
(`^DONE oml:<runId8>$`, multiline), so an earlier request's report or the
sentence "I'll send a closing report after your answer" cannot match.

### Snapshot and evaluation (pure functions, table-tested)

`snapshot()` gathers `GET /api/bots?messages=0`, `GET /api/team-map`, and
messages from **every run thread**, including idle specialists. Each thread
pages backward through dispatch (timestamp ties included), with no arbitrary
page cap. A shared deadline bounds all reads; receipts are read only from a
verified local data directory. Unresolved requests are kept across pages. A
failed or partial fetch marks the snapshot `incomplete`: no terminal state
is ever derived from an incomplete snapshot. Team membership = the imported
ids plus bots created since in the same section; team-map edges count only
when both ends are team bots.

Lead-authored text on the lead's thread: `role:"bot"`, `kind:"text"`, and no
`from` (direct turn text carries none, `index.ts:2731-2736`; only room
messages and echoes carry `from`). Outcomes on the lead thread, persisted as
full records keyed by `id`, in message order: echoes (`from.botId` other than the
lead's, text `@<name> replied to the delegated task`, `index.ts:3383-3388`;
names may contain spaces), delegation activity messages (`Delegation to @X
completed without a text reply`, `failed`, `waiting — they're busy`,
dropped, canceled, denied variants, `index.ts:3392-3401`,
`delegations.ts:417-500`), and receipts for this thread when local
(`sourceThreadId` equal to the run thread; the file is fleet-wide,
deduplicated, capped at 100 and pruned after 48 h,
`delegations.ts:98-129`, so ids are accumulated in state). Counts are
informational only.

Timestamp ties use current hydrated message order only. Receipt ties or
unavailable order remain unknown; an old sequence index cannot prove a new
ordering. `evidenceOf` captures all evaluation inputs, including content,
identities and order. The shared `carriedVerdict` rule used by status and
report requires complete, unchanged evidence with no pending or in-flight
work. Legacy checkpoints without evidence cannot carry a verdict.

Request cards are `kind: "options"` messages with no `card.kind` and may
have no message text. Classification checks `routineRequest`, then
`skillRequest`, then permission `tool`; otherwise it is a question.
JSON retains full title, subtitle/text, options, request id, tool, and typed
payload metadata; only the brief is shortened. Skill and routine answers
exit 5 before any POST; their real upstream protocols remain in the fake.

```
busy     = team bots with busy, or activity in {working, waiting-on-you, no-signal}
inflight = busy.length || queued(team).length || running(team).length
quiet    = !inflight for ≥ 30 s across two consecutive complete snapshots inside this invocation,
           with no relevant frame in between (a held wake between a delegate settling and the lead
           waking is invisible to team-map, index.ts:3253-3259); quiet evidence never persists
           across invocations and resets on resumed:false, on an incomplete snapshot, or on progress
snapshot incomplete                                                           -> running (unknown), no terminal state
any team bot waiting-on-you, or an unanswered card, connector or secret request
  on any run thread                                                           -> needs-user (5)   [precedence over failure, as upstream]
lead dead                                                                     -> failed (6)
not quiet                                                                     -> running
quiet && dispatchFailedAfterLatestUser (exact mirror: no bot text after the last user
  message and an activity with tool.ok === false and name /^error:/i)         -> failed (6)
quiet && the newest outcome is later than the lead's last own text (ties broken by message
  order) && now - outcome.at > 2 min           -> stalled (6), "suspected unacknowledged delegation", hint: send "status?"
                                                  (an empty successful reply never wakes the lead by design, index.ts:3410)
quiet && the lead's last own text is later than every outcome, the dispatch, and the latest
  user message:
    contains the run marker line                                              -> done (0)
    otherwise                                                                 -> attention (5): the lead stopped early
                                                                                 (Premise fails, BLOCKED, a plain question); read the text
lead no-signal, or no change for --stall-minutes                              -> stalled (6)
```

"Done means the lead closed the run, not that it passed": the skill text
tells the agent to read the report, then `reconcile` and `report`. A false
`done` requires the lead to emit this run's marker prematurely.
Notifications are wake-ups only (a bot's notifications can be off,
`notify.ts:85`).

### `watch` loop

1. Open and start reading the SSE stream first (`?screens=off`, bearer
   header when set, `since=<last covered frame id>` when resuming).
   Begin initial hydration only after reading starts or polling fallback
   is explicitly selected; connection setup consumes the same deadline.
2. Take a complete REST snapshot (always, including cold start:
   `hello.resumed` is false then too).
3. Drain the buffered frames as invalidations (`bot` for team bots,
   `message`/`message.patch` for run threads, `notify`, `resumed:false`); if
   any was relevant, snapshot again; only then evaluate and emit what
   changed against `lastReported`. No terminal result is emitted with
   unapplied frames in the buffer.
4. Live frames trigger coalesced re-snapshots (at most one per 2 s); REST is
   the truth; the checkpoint cursor is the `id:` of the last frame actually
   applied, never `hello.cursor` (which is the head before replay,
   `index.ts:8582-8596`). A polling snapshot runs every `--poll` seconds;
   the receipts file is `fs.watch`ed best effort. On a stream drop or idle
   watchdog: 2 s backoff, reconnect with the cursor, polling-only after
   three failures; a reconnect that reports `resumed:false` resets quiet
   evidence.
5. Return on a terminal state, on `--until change` when the state, the
   lead's last own message id, the outcome list, or the pending set changed,
   or at the deadline with `timeout` (exit 4).
6. Each non-dry return attempts a checkpoint with at most a one-second
   lock wait. It merges `task.lastEval {state, cursor, lastLeadMessageId,
   lastChangeAt, outcomes, evidence, lastReported}` over the existing
   record, keeping the newer `lastChangeAt` when a `send` advanced it during
   the watch, only for the same open run and binding. Lock timeout or a replaced run returns
   `checkpointed:false`; other state errors propagate. `watch` never
   changes `task.status`.

One monotonic deadline bounds identity, SSE setup/read/replay, coalescing,
pagination, polling, reconnects and optional nudges. Continuous events
cannot extend it. Every relevant frame resets quiet, including unchanged
REST signatures. Quiet has its own wake deadline instead of waiting for the
next poll. The received cursor advances on frames; the covered cursor
advances only after their complete snapshot and alone is persisted.

`--quiet-if-unchanged` prints nothing when nothing changed; `--nudge` sends
`status?` once per run on the stalled signal (persisted watermark, fixed
`sendId`), for unattended automations.

`--brief` lines, phone-sized:

```
T10 · running 23m · Nova working · outcomes 2 · Sudo 4m ago: "Delegating the implementation to Nova…"
T10 · NEEDS YOU · Sudo: "Premise fails: slugkit/text.py does not exist…" → omb send "…"
T10 · APPROVAL · Sudo wants to contact Quill (request 80114c6b) → omb answer --allow --request 80114c6b
T10 · DONE after 41m · Sudo: "Closing report: merged as 2adb6bd, 67 tests, record cbf87c1"
T10 · ATTENTION · settled without the run marker · Sudo: "BLOCKED: …" → read, then omb send "…"
T10 · STALLED · outcome newer than Sudo's last text, idle 3m → omb send "status?"
```

### Report evidence and history

Tests are required even when no command is configured, `--no-tests` is set,
or dry-run skips execution. Only the exact generated suffix
` (run inside the task's worktree)` is stripped from commands. The root is
checked after tests. Every applicable check must be true for `passed`;
`unknown` and `failedChecks` name the missing and failed evidence without
duplicates. Actual failed tests or a failed run return exit 6. Ordinary
reports omit genuinely unrequested record/bead requirements; `--check-042`
requires all nine checks. Approval uses the last attributable reviewer reply
before worktree creation, with explicit final verdicts and conservative
handling of contradictions and conditions.

New runs retain token-free server/team/facts context; closure archives the
context used for the report. `--run` reports use this archive without a live
server check or snapshot. A legacy run uses current bindings only when the
exact run roster and environment identity corroborate them; otherwise
context stays unknown and current test commands are not executed. Archived
thread messages come from read-only `messages.db` or legacy JSON. Historical
reanalysis appends a separate entry and preserves the original result.
Concurrent replacement of the run or binding refuses a closing write.

## State file `<project>/.omb/state.json`

Excluded through the repository's `info/exclude`, located with
`git rev-parse --git-path` so a linked worktree writes the main repository's
file (same mechanism as `.worktrees/`), ids
only, never tokens. Chosen over `~/.config` because sandboxed hosts can
write inside the workspace but often not to the home directory, and over the
data dir because `--fresh` rotates it.

**Concurrency.** `state.json` remains authoritative, atomically renamed,
and version 1. A persistent private (0600) `.omb/lock.sqlite` database is
used solely as a mutex. Node's built-in SQLite is loaded only for a write.
`BEGIN IMMEDIATE` uses zero busy timeout; only `SQLITE_BUSY` is retried,
with asynchronous sleeps and a monotonic deadline (normally 60 s). Rollback
and close release ownership even after callback failure. Never unlink or
rotate this database; a live writer is never displaced by age. Process exit
releases the SQLite lock. Corruption and permission errors propagate.

Any legacy `.omb/lock` file or directory is refused. Migration requires all
commands and automations stopped and all installed copies updated before
removing only that legacy path. No automatic reclaim or state-format bump.

Mutating commands acquire the mutex before preflights and hold it through
their associated effects. They re-read and reject a changed `rev`; run
resume/abandon and report closure verify the intended run. Watch locks only
for a nudge or final checkpoint; `interrupt` and read-only commands never
take the lock or initialize SQLite.

Every live command verifies the environment id, URL, health pid, and on
local Linux the process start ticks. Missing identity fails closed.
`import` and `up` protect existing ownership before selecting or mutating a
server: a verified live owned server is retained only at its URL; unknown
ownership blocks replacement. Replacement is allowed when both recorded
processes are proven stopped. `up --fresh` reserves its directory atomically.
Cleanup verifies true unlinked cwd identity, containment, pid/start ticks,
and current protected server pids before each signal; a live directory
literally ending in ` (deleted)` is preserved.

```jsonc
{ "version": 1, "rev": 17,
  "project": { "dir": "/home/wsh/Documents/proj", "defaultBranch": "main" },
  "server":  { "url": "http://127.0.0.1:8899", "owned": true, "supervisorPid": 264330, "supervisorStart": 12345678,
               "healthPid": 264336, "healthStart": 12345690, "environmentId": "…", "dataDir": "…/openmausbot-data-6",
               "version": "0.1.56", "askBotTimeoutMs": 600000, "log": "…/serve.log" },
  "team":    { "package": { "path": "…", "name": "dev-team", "release": "0.4.2" }, "section": "Dev team", "environmentId": "…",
               "lead": { "id": "…", "name": "Sudo", "key": "sudo", "title": "Team Lead" },
               "rooms": [ { "id": "…", "name": "Dev Room", "threadId": "…" } ],
               "bots": [ { "id": "…", "name": "Sage", "key": "sage", "title": "Planner", "model": "claude/claude-sonnet-5", "approvalMode": "auto" } ] },
  "facts":   { "defaultBranch": "main", "test": "…", "setup": "none", "merge": "auto", "taskLog": "…", "tracker": "beads", "planReview": "ask" },
  "task":    { "runId": "…", "status": "dispatched", "slug": "t10", "title": "slugkit T10", "tag": "oml:1a2b3c4d", "brief": "…", "bead": "slg-a9x",
               "sendId": "task-…", "sentAt": 0, "sentSha": "aa16067", "sendReceipt": { "steered": false, "queued": false },
               "leadThreadId": "…", "threads": { "<botId>": "<threadId>" }, "nudgedAt": null,
               "lastEval": { "state": "running", "cursor": "ab12cd34:4419", "lastLeadMessageId": "…", "lastChangeAt": 0,
                             "outcomes": [ { "id": "…", "at": 0, "kind": "echo" } ],
                             "lastReported": { "leadMessageId": "…", "pending": [], "state": "running" } } },
  "history": [ { "runId": "…", "slug": "t9", "status": "closed", "result": "passed", "outcomes": 3, "commit": "cbf87c1", "durationSec": 601 } ] }
```

Task status values: `preparing` → `dispatched` → `closed` (by `report`
with a result, or by `task --abandon`). Writers: `up`/`down` → `server`;
`import` → `team`; `bind` → `project`, `team.bots[]`; `facts` → `facts`;
`task` → `task` and its thread checkpoints; `watch` → `task.lastEval`,
`task.nudgedAt`; `report` → moves `task` to `history` by `runId`.

## SKILL.md

Frontmatter, spec-valid (`metadata` is a string map; the OpenClaw block is
omitted and its requirements live in `hosts.md`; `allowed-tools` omitted
because the exec pattern is host-specific):

```yaml
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
```

Sections (target 220 lines): 1 You are the operator (bots run real CLIs on
the user's subscriptions; you drive, you never do the task; `omb` means
`<dir of this file>/scripts/omb.mjs`, resolved per host); 2 Setup once per
project (`doctor`, `up`, `doctor --server`, `import`, `bind`, `facts`; what
to ask the user first; the Stop-hook prerequisite in one sentence); 3 Per
task (`task`, then the `watch` loop; the hard rules: the lead's own thread
never the room, one run at a time, resume or abandon a run rather than
forcing, done is the run marker and still needs reading); 4 Reading
`watch` (state → meaning → action table, including `attention` and
`stalled`); 5 Answering (plain question → `send`; approval card → `answer
--allow --request`; dead question card → `send`; unsupported request types
→ tell the user what the server needs; keep the user's words); 6 Finish and
clean up (`reconcile`, `cleanup --kill`, `report --md`, `down`; stopped
tasks keep their worktree); 7 Guardrails (never fork or patch OMB, never
bind publicly, never PATCH playbooks, ids not names, `/api/decisions` is a
log, one-hop chains, the wake budget, every turn costs subscription);
8 Hosts and phone mode (one line per host with its `--max-seconds`);
9 References.

`agents/openai.yaml`: `interface.display_name "OpenMausBot Launcher"`,
`short_description`, `default_prompt "Use $openmausbot-launcher to run a
task through my OpenMausBot team and relay its questions to me."`,
`policy.allow_implicit_invocation: true`.

## Hosts (references/hosts.md)

| Host | Install | Run | Time budget | Status |
|---|---|---|---|---|
| Claude Code | `ln -s <repo>/skills/openmausbot-launcher ~/.claude/skills/openmausbot-launcher` | Bash, `${CLAUDE_SKILL_DIR}/scripts/omb.mjs` | `--max-seconds 100` (120 s default), or 570 in background with a 600 s timeout | command checks verified; see evidence for watch coverage |
| Grok Build | reads `~/.claude/skills`, nothing more | bash tool | 100 | command checks verified |
| Codex | `ln -s … ~/.agents/skills/openmausbot-launcher` (also `~/.codex/skills`); `$openmausbot-launcher` | shell under sandbox; loopback HTTP and `up` may need escalation | 100 | command checks verified with escalation; long SSE unverified |
| DSH | `~/.agents/skills` (tier 500, non-recursive) | shell | 100 | docs only |
| OpenClaw | `~/.agents/skills` (default state only) or `openclaw skills install <path>`; allowlist the script path, scoped per agent and arguments per the exec-approvals docs | `exec` with `host: gateway` and an explicit `timeoutSeconds` | 1500 in background, or automations | docs only |
| Hermes | `~/.hermes/skills/` copy or `skills.external_dirs: [~/.agents/skills]`; `hermes skills trust` for project installs | terminal, `${HERMES_SKILL_DIR}` | 240 in cron via the `.sh` adapter | docs only |

`npx skills add ~/Documents/openmausbot-launcher -g` installs for the hosts
it knows (symlinks by default); Hermes and OpenClaw still need the one
config line or their own installer, and discovery is verified per host, not
assumed.

**Phone mode, same machine (OpenClaw).** Telegram → gateway → `exec
<abs>/scripts/omb.mjs` → loopback OMB. Session flow: "start the team on
~/proj and do T10 (bead slg-a9x)" → `doctor`, `up --fresh`, `doctor
--server`, `import`/`bind`/`facts` for that fresh server, `task
--todo T10 --bead slg-a9x`, reply with the brief line. Progress: (a) an
automation `openclaw automations create "*/5 * * * *" --command "<abs>/scripts/omb.mjs
watch --brief --max-seconds 240 --until change --quiet-if-unchanged --nudge"
--command-cwd <project> --announce --channel telegram --to <chat>` (an
admin-authored command, separate from the agent's exec allowlist; disable it
after done; whether an empty output is announced is unverified); or (b) the
agent runs `watch --max-seconds 1500 --until change` in the background and
relays each result. Answers: "tell Sudo: …" → `send`; "approve" → `answer
--allow --request <id>`; "what's happening" → `status --brief`. Reuse a team
binding only on the same verified server; after a restart, re-import or
adopt to establish the new identity even when old team state is present.

**Hermes**: a short `~/.hermes/scripts/omb-watch.sh` adapter (cron
`--script` takes a filename there, not an absolute path) that runs `watch
--brief --max-seconds 240 --until change --quiet-if-unchanged` with the
project path and exits 0 for the expected codes 0, 4, and 5 while letting
1, 2, 3, and 6 through as real failures; `hermes cron create "every 5m"
--no-agent --script omb-watch.sh` with `deliver: telegram`.

**Remote variant (documented only).** `openmausbot serve --tailscale` (or
`--tunnel` after `login`), `openmausbot pair --label openclaw`, one `curl
POST /api/auth/pair` whose token goes into the 0600 token file (never into a
transcript or argv); the remote host runs `import --adopt` once, then
`status`, `watch`, `send`, `answer`, `interrupt`; everything else runs on
the dev box. Preferred: run the script on the dev box through an OpenClaw
node, or an SSH tunnel to loopback. Loopback is owner trust, not isolation:
never bind the server publicly.

## Testing

`tests/fixtures/fake-omb.mjs` (a contract fake, written before the driver):
health with a pid, well-known environment with a persistent id per data dir,
auth session, instances, bots (list with `activity` and `tasks[]`, patch
with `cwd` allowed while busy, approval-level change guards, model 409 when
the selection changes while busy or an approval grant is pending, tasks 409
when busy or saving a credential, messages with `sendId` dedupe, 409 on a
stale thread, a `sendId` conflict, or a late steer after settlement, 202
`steered`/`queued` while busy, interrupt with `threadId` and a 409 when busy
elsewhere), thread messages with `before` paging, respond with all four
outcomes, decisions, team-map (hidden bots omitted), teams/import (fresh
ids, numbered names on collision, `chiefOfStaff` on the lead), groups patch
(409 on `cwd` once pinned, even when equal; other fields fine), `/api/events`
with `id:` lines, replay buffer, `since`, ping, and a receipts file with cap
and age pruning. Its `serve` spawns a child that answers health with its own
pid, so lifecycle tests see a supervisor and a child. A control route `POST
/__fake` drives scenarios: busy set, receipt, lead text (without `from`),
echo (with a spaced name and `from`), every delegation activity variant,
card (live or dead), connector and secret requests on a specialist thread,
notify (and notifications off), drop stream, queued delegation, held wake,
delayed responses (hung request), environment change (restart).

`tests/*.test.mjs`: per verb the happy path and every refusal in the verb
table; `evaluate` table-driven (echo with a spaced name as last text, an
outcome newer than the lead's text, held wake between snapshots, queued with
no bot busy, marker present, absent, or from a previous run, marker text
inside a longer sentence, pruning that shrinks the file, notifications off,
specialist blocked on a card, incomplete snapshot yields no terminal state,
pending input precedence over dispatch failure); state store interleavings
(concurrent SQLite writers, asynchronous busy waits, owner death, legacy
lock refusal, corruption, bounded checkpoints, rev conflict, run id mismatch, crash after
`preparing`, crash after one thread created, crash after send, ambiguous
tagged threads, `--resume` idempotency); `watch` over SSE to done, question
(5), cold-start hydration, buffered busy frame before a terminal result,
stream drop → polling, reconnect with `resumed:false` resetting quiet,
early return without losing replay, idle watchdog reconnect, deadline (4)
with cursor, bearer header on the stream, `--quiet-if-unchanged` silent
twice; `up`/`down` ownership (ancestry verified, repeated `up` stays
`owned`, attached server refused, stale pid refused, restarted child with a
reused pid refused, remote refused); `reconcile` and `cleanup` in a temp git
repo with a worktree, a `task/*` branch, and a spawned `sleep` whose cwd is
deleted; `report --md` on synthetic ndjson for several threads and its
run-closing write; brief snapshots. `tests/size.test.mjs` checks the
SKILL.md name equals the directory and the body stays under 500 lines.

**Detached-survival spike (step 4, before the driver grows)**: from each
installed host's shell, run `up` against the fake and the real server, end
the shell or turn, confirm health still answers, then `down`. If a host's
policy kills the child, `hosts.md` documents the fallback: a user-managed
server (`systemd --user` unit or a terminal) and `up` reporting `attached`.

**First real test configuration: dev-team 0.4.2.** The recorded run also
collected pack diagnostics for bead `atw-yyd.9`, spending bot turns once:
the slugkit clone from the 0.4.1 validation on a fresh data dir; a new
small TODO item with an open bead; baseline sha and test count recorded;
exact Project facts; roster per `bd memories validation-models` (Sonnet 5
for the lead, planner and implementer; gpt-5.6-luna at high for both
reviewers, as in `EVIDENCE.md:807`); `doctor`, `up --fresh --port 8899`,
`doctor --server`, `import`, `bind`, `facts`, `task`, `watch` loops,
`report --md --check-042`, `cleanup --kill`, `down`. `--check-042` verifies
from the native and runtime events and the repository: the plan approval
precedes `git worktree add`; the record entry is first in the task log and
its heading time equals the `date -u +%FT%TZ` output captured in the lead's
events; no host `ListAgents` call appears in the lead's events while
`list_bots` does; the bead is closed; the record commit touches only the
task log and `.beads`; the merged commit named in the closing report is an
ancestor of the default branch (`git merge-base --is-ancestor <sha>
<default>`; the task branch is deleted by the cleanup gate,
`worktree-workflow/SKILL.md:16`, so ancestry uses the commit id, and the
branch and `.worktrees/<slug>` are asserted absent); the root is clean; the
test command passes when run by `report` itself. The result closes the run
as `passed`, `incomplete`, or `failed`; the record goes to the new repo's
`docs/evidence.md` and a pointer section in the devpack `EVIDENCE.md`.

The dev-team package is one supplied test configuration. Its nine checks
describe that package's workflow; request them explicitly with `--check-042`.
An ordinary report uses the run's configured requirements without these
additional checks. Importing this package never enables them automatically.
Launcher validation checks import, binding, dispatch, monitoring, input
relay, accurate reporting and cleanup. A bot's failure to follow a package
instruction remains evidence to report; fixing the package is not a
prerequisite for demonstrating that the launcher performs those operations.

Host checks: Claude Code (symlink, triggers on "run T10 through the team",
`${CLAUDE_SKILL_DIR}` resolves, 100 s and background 570 s watches); Codex
(`$openmausbot-launcher` listed, loopback HTTP and `up` under the sandbox or
with escalation, state file writable); Grok (discovered through
`~/.claude/skills`, one `status` and one `send`).

## Implementation and validation tracking

Beads owns detailed work; `oml-t8u` tracks the M1.1 repair. The original
fourteen implementation steps are historical. Repairs use failing
regressions, focused implementation, independent review, and an integrated
suite. Commit coherent, tested checkpoints without a separate permission
question. Every `git push`, including automated or force pushes, requires
the user's explicit permission for that push.

M1 is complete: `oml-axr.15` records doctor, server doctor, status, send and
reply observation through the three native hosts on OpenMausBot 0.1.56.
The operator authored each test message; the native CLI agent executed
`omb send`, and OMB stored it as `role: user`. This establishes host command
execution, not OMB bot sender identity. All five user-requested model
bindings were configured, but only Sudo ran (three OMB turns). The other
four models and a new full-team task were not exercised. No launcher task
was opened; `run: null` remains distinct from task completion.

The checks exposed and fixed a standalone-status defect: without a task,
the command discarded the hydrated leader/user messages and requested
tail. A failing regression precedes the fix; the full suite passes 154/154.
`docs/evidence.md` records the native sessions, restrictions, messages and
cleanup. T12's 8/9 package score and original incomplete report remain
unchanged. Resolving ListAgents behavior is outside launcher acceptance.
M1.1 added no paid bot run; the later host checks are recorded separately.

## Risks and unknowns

1. Codex sandbox: the recorded configuration blocks listening sockets and
   blocked loopback HTTP during the native check. The host command sequence
   passed with per-command escalation; long SSE inside the sandbox remains
   unverified. Lifecycle commands may need escalation or a user-managed server.
2. OpenClaw `--announce` on empty output and the exact allowlist argument
   syntax are documented, not verified (OpenClaw is not installed).
3. The run marker depends on the lead following the brief's last
   paragraph; a lead that omits it yields `attention` after quiet, which
   costs the agent one read of the closing report.
4. OMB churn: pin 0.1.56 in `compatibility` and `metadata.omb-version`,
   keep `api.md` versioned with source lines, read routes from the pinned
   clone only.
5. Lifecycle management is Linux-only (`/proc` ancestry and start times);
   macOS gets `attached` mode and reports; Windows unsupported.
6. A 2.5-hour task still needs repeated `watch` calls under Claude Code's
   10-minute ceiling; each invocation must observe its own 30 s quiet
   window before declaring settlement, which `--max-seconds 100` allows.
7. Numbered names on re-import ("Sudo 2") are handled by ids, but a
   `--adopt` by name must be told which team.
8. Node 24 is the supported runtime for local and remote operation.
   SQLite may emit an experimental warning on stderr. See the lock upgrade
   procedure above; mixed launcher versions must not run concurrently.
