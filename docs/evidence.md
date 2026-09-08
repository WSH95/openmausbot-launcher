# Evidence

Every claim about a real run goes here with the command, the OpenMausBot
version, and the ids involved. Fake-server test runs are not evidence.

## 2026-09-08 — detached-survival spike on the three installed hosts (design step 4)

Question: does a server started by `omb.mjs up` outlive the agent's shell
call on each host, and does ownership verification hold across shells?
Driver at commit after step 3 (`7d822fc`) plus the step-4 lifecycle code.
No bot turns were spent: a server alone costs nothing.

| Host | How `up` ran | Result |
|---|---|---|
| Claude Code 2.1.263 (this session's Bash tool) | real `openmausbot` 0.1.56 (`OMB_BIN=~/.cache/agent-team/openmausbot-cli/node_modules/openmausbot/cli.js`), `up --port 8897 --data-dir ~/.cache/agent-team/omb-launcher-spike/data` | owned: supervisor 333306, server 333313 (PPid 333306), environment `d2ff5834-…`; a later shell call got `{"app":"openmausbot","pid":333313}`; `doctor --server` passed all ten checks (loopback admin, engines grok/claude/codex available, no provider keys in the server's environment, identity matches); `down` stopped both pids |
| Grok Build 1.0.13 (`grok -p … --permission-mode bypassPermissions`) | fake server (`tests/fixtures/fake-omb.mjs`), `up --port 8895` | owned: supervisor 335693, server 335700; health answered from this shell after Grok exited; `down --project …/grok-repo` from this shell stopped it |
| Codex CLI 0.153.4 (`codex exec --sandbox workspace-write`) | fake server, `up --port 8896` | **failed in 236 ms**: the server child died with `listen EPERM: operation not permitted 127.0.0.1:8896` (serve.log); the sandbox denies listening sockets |
| Codex CLI 0.153.4 (`codex exec --sandbox danger-full-access`, modelling an approved escalation) | fake server, `up --port 8894` | owned: supervisor 336607, server 336614; health answered from this shell after Codex exited; `down` from this shell stopped it |

Conclusion: `up` works from Claude Code and Grok Build as is; on Codex it
needs a command run outside the workspace-write sandbox (an escalation
approval), or a server started elsewhere and `up` used to attach. `up`
now reads the server log on a startup failure and names the sandbox cause
in its hint. Logs: `~/.cache/agent-team/omb-launcher-spike/`.

Correction (2026-09-08, M1 review finding 24, `oml-nqo.28`): the last
sentence above was not true on a real sandboxed failure until the fix. The
tier 2 negative check (`codex exec --sandbox workspace-write`, `up --port
8905`, artifact `codex-up-ww.jsonl`, SHA-256 `60f53a05…`) produced the
generic hint `see <serve.log>`: `logTail` returned the last twelve lines of
the log and the `listen EPERM` line lay above them. The hint names the
sandbox since commit `0da606c`. The Grok and Codex rows above used the fake
server; the same spike against the real server is in "M1 review, tier 2"
below (finding 4, `oml-nqo.4`).

## 2026-09-08 — first real run: T12 on the slugkit clone through the dev-team pack 0.4.2 (design step 13)

OpenMausBot 0.1.56 started by `up --fresh --port 8899 --data-dir ~/.cache/agent-team/omb-launcher-data` (data dir `omb-launcher-data-20260907-2300`, environment `3c244ba3-4319-449a-8179-017f3d6449f2`, supervisor 367683, server 367690). Team: `import ~/Documents/agent-team-devpack/packages/dev-team/dev-team.openmaus.json` (release 0.4.2, section "Agent Team dev team", Sudo 1aa41a6d…, Sage 38710dd0…, Vale f20e06c4…, Nova a36e4c2f…, Quill 8eeeeea1…). Roster per the user's instruction for this project's tests: `bind --default claude/claude-sonnet-5 --reviewers codex/gpt-5.6-luna/high` (Sudo, Sage, Nova on Sonnet 5 at the server's default effort; Vale and Quill on gpt-5.6-luna at high; all on approval auto). Facts: test `python3 -m unittest discover -s tests -t . (run inside the task's worktree)`, setup none, merge auto, task log `.project-steward/PROGRESS.md`, tracker beads, plan review ask. Project: `~/.cache/agent-team/validate-0.4.1/slugkit` at 2f6d9d5 (72 tests) with a new TODO item T12 (separator validation) and bead `slg-ceo`.

Dispatch: `task --todo T12 --bead slg-ceo` at 03:00:58Z (run 61e709700923670a, tag oml:61e70970, five fresh task threads, lead thread eb9e6184…). Watched with three `watch --max-seconds 540 --brief` calls from this Claude Code session; the third returned `done` at 03:24:13Z (23 min 15 s wall clock, 1,483 s by the driver's count). The lead's closing report ended with the run marker line. The `report --check-042` below was produced after two driver fixes the run exposed: the test command was run with its parenthetical note attached (exit 2), and the merged commit was sought only as "merged as" in the closing text; both fixed the same day (`bareCommand`, `mergedShaFrom`, `report --run last`). Cleanup after the run found no orphaned sandbox processes; `down` stopped both pids.

Correction (2026-09-08, M1 review finding 18, `oml-nqo.18`): the run exposed
four driver defects, not two. `f302ec0` also fixed the brief doubling the
worktree note and `import` recording the response name instead of the
bots' numbered section. The two durations quoted above are different
measurements: 23 min 15 s runs from dispatch (03:00:58Z) to the `done`
verdict of the third watch (03:24:13Z); the archive's 1,483 s (24 min 43 s)
runs from dispatch to the run's closure by `report` at 03:25:41Z.

### 2026-09-08 — T12 (incomplete)

Run 61e709700923670a, tag oml:61e70970, OpenMausBot 0.1.56, lead Sudo (claude/claude-sonnet-5), project /home/wsh/.cache/agent-team/validate-0.4.1/slugkit, dispatched 2026-09-08T03:00:58.726Z from 2f6d9d5; final state done.

| Thread | Turns | Bot seconds | Input | Cached | Output |
|---|---|---|---|---|---|
| Sudo | 6 | 734 | 2509653 | 2305396 | 23501 |
| Quill | 2 | 235 | 104501 | 99840 | 1973 |
| Nova | 2 | 251 | 3241178 | 3181386 | 13608 |
| Vale | 3 | 241 | 147666 | 136448 | 5336 |
| Sage | 3 | 262 | 1322973 | 1266635 | 19391 |

Outcomes: 10 (receipt Sage, echo Sage, receipt Nova, echo Nova, receipt Quill, echo Quill, receipt Nova, echo Nova, receipt Quill, echo Quill). Commits since dispatch: 3 (4fe344e docs(team): T12 separator validation merged as 9127a0a; 9127a0a Document sep constraint in unique_slug docstring (T12 / slg-ceo); 8ff81d2 Validate sep in slugify (T12 / slg-ceo)).

Record step: task log yes, record commit 4fe344e, bead slg-ceo is closed. Tests: passed in 0 s. Root: clean.

0.4.2 checks:

- worktree-after-approval: yes — git worktree add at 2026-09-08T03:10:32.046Z, Vale's verdict at 2026-09-08T03:10:27.585Z
- record-time-from-date-u: yes — date -u returned 2026-09-08T03:22:54Z; the task log's first entry heading is "### 2026-09-08T03:22:54Z — Sudo (orchestrator)"
- no-host-listagents: no — tools used: ListAgents, mcp__agents__list_bots
- bead-closed: yes — bead slg-ceo is closed
- record-commit: yes — 4fe344e docs(team): T12 separator validation merged as 9127a0a (.beads/interactions.jsonl, .project-steward/PROGRESS.md)
- merged-ancestor: yes — 9127a0a is an ancestor of main
- task-branch-and-worktree-absent: yes — 0 task branch(es), 0 extra worktree(s)
- root-clean: yes — clean
- tests-pass: yes — exit 0 in 0 s

Closing report from Sudo: "**T12 (separator validation, bead `slg-ceo`) is done and merged.** - **Plan** (Sage → Vale): one revision round — fixed a missing invalid-`sep` fixture gap, a `TypeError`-vs-`ValueError` edge case, and an underspecified test-fix step; revised plan approved. - **Implementation** (Nova): added `sep` validation to `slugify` (rejects non-string, empty, or letter/digit separators, inherited by `unique_"

Reading: the pack's loop ran unattended end to end (plan with one revision round, implementation, one review round, fast-forward merge 2f6d9d5..9127a0a, cleanup gate, record step with the entry at the top of the task log timed by `date -u`, bead closed, one `docs(team)` commit, closing report in chat and the room). Of the three 0.4.2 wording fixes, two are validated (the worktree was created after Vale's verdict; the record entry is first and carries the `date -u` time) and one is not: the Sonnet lead still called the host's `ListAgents` alongside `list_bots`. Host checks the same day: Claude Code lists the skill and drove this run; Codex CLI 0.153.4 found it at `~/.agents/skills/openmausbot-launcher/SKILL.md` and ran `status` from inside its workspace-write sandbox; Grok Build 1.0.13 found it at the same path and ran `status`.

Correction (2026-09-08, M1 review findings 18 and 26, `oml-nqo.18`,
`oml-nqo.30`): the host-check sentence above overstates two things. Codex
did not run `status` from inside its workspace-write sandbox: that sandbox
blocks loopback HTTP, and the M1 review's tier 2 artifact
`codex-ww-state.jsonl` (SHA-256
`9b1d103ce262486f5c5f05dd899484d8a6b293f673ce79588bdc164a66e7cb7f`,
`docs/validation/2026-09-08-m1-review.json`) shows `status` exiting 3 there
with "the server identity could not be verified" against a healthy server;
since commit `ddcafb5` it exits 1 with a network error that names the URL.
Grok Build did not find the skill "at the same path" as Codex: it read
`~/.claude/skills/openmausbot-launcher/SKILL.md`
(`docs/validation/2026-09-08-m1-hosts.json`), Codex
`~/.agents/skills/openmausbot-launcher/SKILL.md`.

## 2026-09-08 — M1.1 offline reanalysis of the recorded T12 approval

This is a reanalysis of the archive above, with **zero new bot turns**.
OpenMausBot version remains 0.1.56. Run `61e709700923670a`, lead thread
`eb9e6184-f4ed-4670-8515-a3d474006f50`, reviewer Vale
`f20e06c4-4775-44f3-9809-fa7b2b367d43`. The archive contains 1,340 lead
native entries and 85 stored lead-thread messages. The legacy run's exact
roster and environment were corroborated. Original history and report both
remain `incomplete`; state bytes were unchanged after the read.

The corrected report helpers find Vale's correlated `ask_bot` reply at
**03:10:22.421Z**, before worktree creation at **03:10:32.046Z**. The old
report's 03:10:27.585Z was Sudo's paraphrase; retain the original report above
as historical output, with this attribution correction. The other archive
checks still show the correct 03:22:54Z record timestamp and the unwanted
host `ListAgents` call alongside `mcp__agents__list_bots`.

The planned full `report --run last --check-042 --dry-run` command includes
Git inspection. This session's active Beads hook prohibited Git operations,
so the equivalent attribution check used the report helpers directly, with
no HTTP, test command, Git, or state writes. The six remaining repository
and test checks were not re-run; the previously recorded 8/9 result stands.
Run from the launcher repository:

```javascript
// node --input-type=module (script on stdin)
import fs from 'node:fs';
import path from 'node:path';
import { readNdjson, historicalContext, archivedMessages, check042 }
  from './skills/openmausbot-launcher/scripts/lib/report.mjs';
const project = '/home/wsh/.cache/agent-team/validate-0.4.1/slugkit';
const data = '/home/wsh/.cache/agent-team/omb-launcher-data-20260907-2300';
const state = JSON.parse(fs.readFileSync(path.join(project, '.omb/state.json')));
const run = state.history.find(h => h.runId === '61e709700923670a');
const context = historicalContext(run, state, data);
const reviewer = context.team.bots.find(b => /plan review/i.test(b.title));
console.log(check042({
  native: readNdjson(path.join(data, 'native', `${run.leadThreadId}.ndjson`)),
  messages: await archivedMessages(data, run.leadThreadId),
  leadThreadId: run.leadThreadId, reviewer, sentAt: run.sentAt,
  taskLogText: fs.readFileSync(path.join(project, context.facts.taskLog), 'utf8'),
}));
```

M1's formal host gate is also incomplete: recorded discovery/status and
survival spikes do not establish the specified doctor/status/send sequence
on all three hosts. M1.1 makes no new all-host or 9/9 validation claim.

## 2026-09-08 — Scope clarification: supplied test configuration

The user clarified that `dev-team.openmaus.json` is an external test
configuration. T12 demonstrates the launcher driving that supplied team;
its optional 0.4.2 checks also measure the package's own behavior. The
8/9 score and original incomplete report remain unchanged. A 9/9 package
score is not a launcher acceptance requirement. The missing host command
evidence remains in `oml-axr.15`; Decision 0006 records the corrected scope.
This clarification involved no real bot runs or edits to the package.

## 2026-09-08 — M1 native CLI command checks

The remaining host command checks passed on **Claude Code 2.1.263,
Codex CLI 0.153.4, and Grok Build 1.0.13**, using Node 24.11.0 and real
OpenMausBot **0.1.56**. The [structured evidence](validation/2026-09-08-m1-hosts.json)
contains native session/tool-call IDs, exact executed commands, selected
JSON results, transcript hashes, send receipts, runtime turns and cleanup.
This completes `oml-axr.15` and M1 (`oml-axr`).

**What sent the messages.** The operator authored the acknowledgment text
and launched three native CLI agent sessions, supplying the installed skill
path and exact commands. Each session's own shell tool executed `omb send`.
OMB stored those messages as **`role: user`**. That role does not identify
which CLI executed the command. Execution is established by each native
tool record correlated with the returned message ID, not by the OMB sender
label or the host name embedded in the text. The launcher's `deliver`
posts to `/api/bots/:id/messages`; the pinned server's `startTurn` appends
ordinary sends with `role: "user"` (`server/index.ts:3835-3849`).

These checks establish command execution and reply observation. They do
not establish bot-to-bot communication, autonomous interpretation of a
development brief, or a new full-team workflow. All five user-requested
bindings were configured and read back; **only Sudo ran**, for exactly
**three successful OMB turns**. The other four models were not exercised.
Native host CLI sessions also consumed subscriptions. No launcher task
was opened (`run: null`); a complete snapshot is not a task-done verdict.

### Fixture, package and bindings

- Temporary Git project: `/tmp/oml-m1-hostcheck-VslL6s/project`, branch
  `main`, initial empty commit `0fc03b1ed618584a7a2a9b1d1c2fad9d6e1a3c34`.
- Fresh data directory:
  `/tmp/oml-m1-hostcheck-VslL6s/data-20260908T084943-RegNMH`.
- Server: `http://127.0.0.1:46783`; environment
  `b7181155-e0cc-46b8-96dc-82fad3ad9c65`; owned supervisor/server PIDs
  `534440`/`534447` (both stopped after the checks).
- Unchanged external test input:
  `/home/wsh/Documents/agent-team-devpack/packages/dev-team/dev-team.openmaus.json`,
  release 0.4.2. SHA-256 before import and after all checks:
  `48e4ac637c7afb6d9e82f0ecf035967411d9c75e61ac8e0603ee7b62a3255949`.
- Sudo bot `d28aeaae-ad8c-4895-ae91-0b840b053554`; conversation
  `2fc5c12e-0891-4bcd-af8b-840e33ba7965` for all three user sends.

| Role | Binding | Execution in these checks |
|---|---|---|
| Sudo, leader | `codex/gpt-5.6-luna/high` | three acknowledgment turns |
| Sage, planner | `claude/claude-sonnet-5/high` | configured only |
| Vale, plan reviewer | `codex/gpt-5.6-terra/high` | configured only |
| Nova, implementer | `claude/claude-opus-5/high` | configured only |
| Quill, code reviewer | `grok/grok-4.6/medium` | configured only |

These are OMB bot bindings. The operator CLI sessions used their existing
host defaults; their host names do not describe the model answering in OMB.
The package and launcher contain no new required roster or package path.

Cross-check at the user's suggestion: the supplied package project's
`~/Documents/agent-team-devpack/docs/setup-guide.md`, sections 3–5, describes
the lead's full delegation loop and fresh threads for development tasks.
Its `EVIDENCE.md` day-1 driver proof instead uses one probe bot per engine;
its final 0.4.2 section records the earlier T12 full-team run. Those are
different checks from this native CLI sequence. None makes the four unused
model selections in this new fixture tested. The package repository was
read only; its older guide and handoff wording were not treated as new
execution evidence or instructions to change this launcher's acceptance.

### Commands and results

The operator ran `up --fresh --port 46783 --data-dir <temporary-root>/data`,
`import <supplied-package>`, and `bind` with the five per-bot selections
above. Exact setup argv and results are in the structured evidence. Each
native CLI then executed this sequence with direct JSON stdout:

```sh
# Paths used in this run; these variables only abbreviate the commands here.
export OMB_BIN=/home/wsh/.cache/agent-team/openmausbot-cli/node_modules/openmausbot/cli.js
OMB_SCRIPT=/home/wsh/Documents/openmausbot-launcher/skills/openmausbot-launcher/scripts/omb.mjs
M1_PROJECT=/tmp/oml-m1-hostcheck-VslL6s/project
node "$OMB_SCRIPT" doctor --project "$M1_PROJECT"
node "$OMB_SCRIPT" doctor --server --project "$M1_PROJECT"
node "$OMB_SCRIPT" status --tail 10 --project "$M1_PROJECT"
node "$OMB_SCRIPT" send "This is an authorized launcher transport check, not a development task. Reply with exactly: <nonce> ACK. Do not call tools, delegate, edit files, run Git, or post to a room." --project "$M1_PROJECT"
node "$OMB_SCRIPT" status --tail 10 --project "$M1_PROJECT"
```

| Native CLI | Session | Nonce and observed reply | Result |
|---|---|---|---|
| Claude Code | `5032fc81-cdca-41b6-abfb-b60fcd177642` | `M1-claude-a67539db ACK` | doctor 5/5, server doctor 10/10; one send; existing reply verified after status fix |
| Codex CLI | `01a08042-55e4-7021-a025-f78ee5e3a157` | `M1-codex-9b5b4c6c ACK` | doctor 5/5, server doctor 10/10 with escalation; one send and matching reply |
| Grok Build | `01a08044-7934-7250-b9a1-e9c06cc82e9b` | `M1-grok-f28dd2fa ACK` | doctor 5/5, server doctor 10/10; one send and matching reply |

| Native execution | User message ID | Sudo reply ID | OMB runtime turn ID |
|---|---|---|---|
| Claude Code | `c3af3d90-69de-452f-a892-4abf1512aa95` | `29703b13-5da5-421b-97c5-7bf5a8965311` | `ee1dcc70-825c-4d62-9d02-3b9a20a7ed88` |
| Codex CLI | `19fea1cf-c79f-4f65-9607-528e21228b1e` | `87bcde6d-fd9f-4c42-9072-cfc49437eeb1` | `4798f426-220c-411c-b4c5-20e854738f3d` |
| Grok Build | `5df65b65-8b7d-4f40-90e8-2a27af571b48` | `1a2fb241-eb2e-4103-a12a-e0887dd270c0` | `5644f540-bcff-4500-a05c-a4f75a042cf1` |

The runtime turns completed successfully at 08:55:41.984Z, 09:05:14.563Z
and 09:07:44.911Z respectively. All three native reply observations showed
the matching latest user message, exact acknowledgment and an idle team.
Raw transcripts remain under `/tmp/oml-m1-hostcheck-VslL6s/logs`; the
committed extraction excludes transcript reasoning and credentials.

### Failure found, retries and cleanup

The first successful Claude send exposed a launcher bug: with no open
task, `status --tail 10` discarded the leader/user messages already loaded
by `snapshot`. Sudo had answered, but the native operator could not observe
that answer through status. A failing fake-server regression reproduced
the missing field before the fix. Status now returns that conversation
with `run: null`, without creating or classifying a task. The same Claude
session resumed with doctor/server-doctor/status reads and verified the
existing reply; it did not send again.

Claude ran in default permission mode with command allowlists. An earlier
attempt to redirect command results to files was blocked before any send;
direct stdout worked. The first Codex launch combined incompatible CLI
flags and exited before an agent session or bot turn. In the corrected
native session, workspace-write blocked loopback access during server
doctor (exit 3); the exact command passed with approved escalation, as did
subsequent network commands. Grok used auto permission mode. No global
host configuration was changed. These results do not establish unrestricted
Codex sandbox networking or long SSE watch support.

Focused snapshot tests passed **5/5** in 3.441 s. The full `npm test` suite
after the source fix passed **154/154**, zero failures or skips, in
52.225 s outside the socket-restricted sandbox. `cleanup` found no launcher
orphan candidates, a clean `main`, one worktree and no task branches.
`down` stopped the owned server; independent checks found both recorded
PIDs absent, health returning `ECONNREFUSED`, and no process with a cwd
under the temporary fixture. No pushes occurred. T12's archive and 8/9
package result remain unchanged; this check did not repeat that task.

## 2026-09-08 — M1 review, tier 2: real server lifecycle and host survival (0 bot turns)

Question: does the driver's full setup path work against real OpenMausBot
0.1.56, and do the design's unevidenced host checks pass — the detached
survival spike against the real server from every host, the Codex skill
listing and state writability, the Claude trigger phrase, and
`${CLAUDE_SKILL_DIR}`?

Node 24.11.0 and real `openmausbot` **0.1.56**
(`OMB_BIN=~/.cache/agent-team/openmausbot-cli/node_modules/openmausbot/cli.js`),
`OMB_TOKEN` empty and every other `OMB_*` variable unset. Temporary fixture
`/tmp/oml-review-t2-CGG7JR` holding four git projects, each at
`40bef591e39ca0e8bd474a74f1c6f7f955c7f6d7` on `main`. Server
`http://127.0.0.1:8893`, environment
`98b1f9f2-e973-4c16-819f-aed3ba7fe778`, owned supervisor/server PIDs
`617810`/`617817`, data dir
`/tmp/oml-review-t2-CGG7JR/data-20260908T105019-92irGo`, `askTimeoutMs`
600000. Team from the unchanged external test input
`~/Documents/agent-team-devpack/packages/dev-team/dev-team.openmaus.json`
(release 0.4.2, SHA-256 `48e4ac63…3255949` before import, after import and at
the end of the tier): Sudo `414ffd78-4cb0-4190-8e88-53db14bbb002`, Sage
`fe2bbf47-7765-40eb-824f-efd32daba949`, Vale
`44a5609a-3d8d-4ce4-a949-c478de5c3075`, Nova
`58323a8b-7059-4dff-9cec-70a89464f672`, Quill
`d22c6301-fedd-4a04-91cc-7556f4e13305`, room
`5fa03555-5107-4e15-aadc-a43e4e4d407b`. Bindings: Sudo
`codex/gpt-5.6-luna/high`, Sage `claude/claude-sonnet-5/high`, Vale
`codex/gpt-5.6-terra/high`, Nova `claude/claude-opus-5/high`, Quill
`grok/grok-4.6/medium`.

**No OpenMausBot bot turn was spent in this tier**: no `task`, `send` or
`answer` was issued. The operator ran the driver commands from this Claude
Code session's shell. The three host checks below launched native CLI agent
sessions, which **consumed those hosts' own subscriptions**; each was given
the exact command to run and told to print its stdout and stop.

| Check | Command | Result |
|---|---|---|
| Local doctor | `doctor --project <project>` | 0; 5/5; binary `…cli.js (openmausbot 0.1.56, from OMB_BIN)` |
| Server doctor | `doctor --server` | 0; **10/10**; loopback session scopes `admin,client`; engines grok, claude and codex available; no provider keys; identity matches |
| Stripped environment | `/proc/617817/environ`, `/proc/617810/environ` | 0 of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, `OMB_TOKEN`. Repeated self-contained on port 8897 from one shell holding all three decoy keys: 0 in both processes; `down` removed both pids |
| Import | `import <supplied package>` | 0; release 0.4.2; section "Agent Team dev team"; lead Sudo; 5 bots; 1 room |
| Bind | `bind --model` ×5 | 0; all five read back; Quill skipped for auto ("a grok bot has no auto approval level") |
| Facts | `facts --test true --setup none --merge auto --task-log none --tracker none --plan-review ask` | 0; 183-character block |
| Status | `status --tail 3` | 0; `run: null`; `busy` and `pending` empty |
| Adopt | `import --adopt "Agent Team dev team" --project <project2> --url … --data-dir …` | 0; `package: null`; identical lead and bot ids; `owned: false`; `status` there 0 with `run: null` |
| Grok survival | `grok -p … --permission-mode bypassPermissions --cwd … --max-turns 4 --no-subagents --disable-web-search --output-format streaming-json`, `up --port 8901` | owned: supervisor 620924, server 620931, environment `2777264e-a090-4fae-8df9-e6b02352769f`; after Grok exited, health from this shell answered `{"app":"openmausbot","pid":620931}`; `down` from this shell stopped both |
| Codex survival | `codex exec --sandbox danger-full-access --cd … --json --skip-git-repo-check … < /dev/null`, `up --port 8903` | owned: supervisor 625770, server 625777, environment `9606fa72-d3fa-41f3-8217-ec76fd322170`, thread `01a080af-8cc4-77c2-9b66-dac9c863f0ea`; health answered after Codex exited; `down` from this shell stopped both |
| Codex sandbox negative | same with `--sandbox workspace-write`, `up --port 8905` | **exit 1**: `{"ok":false,"verb":"up","error":"the server exited during startup",…,"log":"… code: 'EPERM', … syscall: 'listen', … port: 8905"}` |
| Codex skill listing | `codex exec --sandbox read-only … "list the names of the skills available to you"` | 0; `openmausbot-launcher` listed; no command executed |
| Codex state writability | `codex exec --sandbox workspace-write` running `accessSync(state.json, 2)` | 0; printed `state writable` |
| Codex `status` in the sandbox | same session, `status --project <project2>` | **exit 3**, "the server identity could not be verified"; the same command exits 0 from an unsandboxed shell |
| Claude trigger phrase | `claude -p "run T10 through the team" --output-format stream-json --verbose --max-turns 2 --allowedTools Skill --add-dir <project>` | first tool call was `Skill` with `{"skill":"openmausbot-launcher"}`; session `8c6b77b4-7f71-4295-847c-6836c399995d`; ended `error_max_turns`; the repository was unchanged |

In both survival cases the server process's parent was its supervisor and the
supervisor's parent was `systemd --user` (pid 1987, a child of pid 1), not the
host CLI.

**Claude Code skill path.** `${CLAUDE_SKILL_DIR}` (`docs/design.md:572-576`)
resolves by **load-time text substitution, not an environment variable**. This
was observed in the interactive Claude Code 2.1.263 session that invoked the
skill through its Skill tool, not by a `claude -p` invocation, so no transcript
file exists for it and no bot turn or extra host session was spent. `SKILL.md`
line 23 arrived with `${CLAUDE_SKILL_DIR}/scripts/omb.mjs` already rewritten to
`/home/wsh/.claude/skills/openmausbot-launcher/scripts/omb.mjs`, and the loaded
content announced "Base directory for this skill:
/home/wsh/.claude/skills/openmausbot-launcher". In that same session's Bash
tool, `echo "${CLAUDE_SKILL_DIR:-unset}"` printed `unset`. A shell script
therefore cannot read the variable; an agent must use the path already
substituted into the skill text. `ls -l` of that path showed the symlink to
`/home/wsh/Documents/openmausbot-launcher/skills/openmausbot-launcher/scripts/omb.mjs`,
and `node` on it printed the driver's usage JSON with its 15 verbs.

Two host attempts failed before doing anything and are recorded as incidents.
Grok's first attempt ran the command it was given verbatim on port 8894 and the
driver answered `GET /api/health -> 404: Unknown webhook endpoint` (exit 1),
because OpenMausBot binds `PORT + 1` for webhook ingress
(`server/index.ts:320`, `server/cli.ts:438`) and the 8893 server already held
8894; reproduced from a plain shell, and re-run on 8901 it passed. Codex's
first attempt blocked on stdin ("Reading additional input from stdin…") and was
killed at 420 s with an empty transcript, no listener, no state file and no
data dir; `< /dev/null` fixed it.

Not exercised in this tier: any bot turn, `task`, `send`, `answer`,
`interrupt`, `watch`, `report`, delegation, and OpenClaw, Hermes Agent or
DeepSeek Harness.

Conclusion: the driver's setup path, ownership proof and shutdown work against
real OpenMausBot 0.1.56, and every design host check that had never been
evidenced passes — including the detached survival spike against the real
server from Grok Build and Codex CLI, which previously existed only against the
fake. The tier also produced five defects that only a real server, sandbox or
port can surface (`oml-nqo.26`–`.30`). Raw logs, prompts and transcript
SHA-256s: session scratchpad `tier2/`, copied from
`/tmp/oml-review-t2-CGG7JR/logs`.

## 2026-09-08 — M1 review, tier 3: transport check with a peer-approval card, interrupt, historical report (5 Sudo turns)

Question: do the relay verbs — `answer` in both directions, `interrupt`, the
background `watch`, and `report` in its historical modes — work against a real
server, and does the `approvePeerComms` gate produce the approval card the
design's "a bot wants to contact a peer" flow depends on?

Same server, team, bindings and fixture as the tier 2 section above,
OpenMausBot **0.1.56**. Before dispatch, `bind --approval ask` set all five
bots to ask (every roster line read `(ask)`), and
`PATCH /api/bots/414ffd78-4cb0-4190-8e88-53db14bbb002` with
`{"approvePeerComms":true}` returned **200** and read back `true`. Run
`d0a01943d403c7af`, tag `oml:d0a01943`, lead thread
`aec43e24-af2b-413d-95a6-32cec24e2e1e`, Sage thread
`e054e856-a05d-412c-9947-e895e9c2ca8d`, five fresh threads, dispatched
2026-09-08T11:13:41.103Z from `40bef59`.

**What sent the messages.** The operator wrote every message text in this
Claude Code session and the driver's `send`/`task` posted them over the local
HTTP API; OpenMausBot stored them as `role: user`. Only Sudo and Sage
executed. **5 Sudo turns and 1 Sage turn** were spent, counted from
`turn.completed` in the data dir's event files. The tier 2 host CLI sessions
also consumed those hosts' subscriptions; no host CLI was used in tier 3.

| Step | Command | Result |
|---|---|---|
| Dispatch | `task --title transport-check "<brief>"` | 0; run `d0a01943d403c7af`; 5 fresh threads |
| Watch 1 | `watch --max-seconds 100` | **5** needs-user in 19 s; card `9dee0033-cd91-4918-b7a2-fd36b962dab2`, tool `list_bots`, options Allow/Deny |
| Allow the prerequisite | `answer --allow --request 9dee0033…` | 0; `allowed-once` |
| Watch 2 | `watch --max-seconds 100` | 0 done in 32 s. Sudo's turn called only `date -u +%FT%TZ` and `list_bots`; it never called `ask_bot`, yet wrote "Sage contact denied" |
| Force the call | `send "…call the ask_bot tool exactly once now, with bot id fe2bbf47…"` | 0 |
| Watch 3 | `watch --max-seconds 100` | **5** in 11 s; card `523623c0-ae9b-4b0c-a005-28f5680ef66a`, tool `ask_bot` |
| Deny | `answer --deny --request 523623c0…` | 0; outcome **`rejected`** |
| Watch 4 | `watch --max-seconds 100 --brief` | **0 DONE** in 33 s; lead quoted `{"content":[{"type":"text","text":"user rejected MCP tool call"}],"isError":true}` and the marker line |
| Allow path | `send "…ask Sage to reply with the single word PONG…"`, `watch` | 5; card `a89ec38a-f03f-4ca8-932e-11ea2389f998`, tool `ask_bot` |
| Allow the tool | `answer --allow --request a89ec38a…` | 0; `allowed-once` |
| Watch 5 | `watch --max-seconds 100` | 5 immediately; **peer card** `ca82697e-7f6d-4ace-99ab-40591e7fcb37`, title "@Sudo wants to contact @Sage", options Allow/Deny/Always allow, `allowKey ask_bot:fe2bbf47-…` |
| Allow the peer contact | `answer --allow --request ca82697e…` | 0; `allowed-once`. "Always allow" was never chosen |
| Watch 6 | `watch --max-seconds 100` | **0 done** in 41 s; lead: "Sage replied: PONG" plus the marker. Sage's event file appeared with 1 turn |
| Interrupt | `send "…\`sleep 90\`…"`, then `status --brief` after 10 s, then `interrupt` | status showed `Sudo working`; `interrupt` 0 with `interrupted: true`; Sudo idle within 1 s |
| Background watch | `watch --max-seconds 570 --brief` started with `&` | exit **0** after **60 s**, not 570: it returned at the next terminal state, `DONE after 10m` |
| Foreground watch | `watch --max-seconds 100 --brief` | 0 after 32 s, `DONE after 11m`; lead: "Closing report: `sleep 90` was aborted before completion." The state file's md5 changed across the pair, so both checkpointed |
| Report preview | `report --dry-run` | 0; `closed: false`; tests `skipped: dry run`; state md5 unchanged |
| Report | `report --md` | 0; `(passed)`; run closed 2026-09-08T11:24:49.645Z |
| No open run | `report` | **3**, "no open run to report" |
| Historical dry run | `report --run last --dry-run` | 0; `historical: true`; state md5 unchanged |
| Historical re-report | `report --run last` | 0; `reReported: true`; exactly one `reanalysis` entry appended; the original result stayed `passed` |
| Reconcile | `reconcile` | 0; clean; no task branches; one worktree |
| Cleanup | `cleanup --kill` | 0; no orphan candidates, nothing killed; pid 426150 correctly ignored and still alive |
| Down | `down` | 0; both pids gone; 8893 and 8894 both refuse connections |

`/api/decisions` recorded six entries: `card-shown` then `user-approved` for
`list_bots`, `card-shown` then `user-denied` for the first `ask_bot`, and
`card-shown` then `user-approved` for the second. The peer-contact decision on
`ca82697e-…` is **not** in that log, so a peer approval leaves no trace there.

Turn accounting from `<dataDir>/events/<thread>.ndjson`: Sudo 5, Sage 1,
Quill 0, Nova 0, Vale 0. Only two event files exist — the lead's and Sage's —
so the three unused specialists never started a session. `teamMap.queued` and
`teamMap.running` were empty at every snapshot and no delegation, receipt or
echo occurred. SHA-256 of the lead's event file:
`40c180dc8c139fc34a49167c61a642075db7927f302c451817cbb6edc4926e03`. The
supplied package hashed `48e4ac63…3255949` at the end, unchanged. No process
remained with a cwd under the fixture.

### 2026-09-08 — transport-check (passed)

Run d0a01943d403c7af, tag oml:d0a01943, OpenMausBot 0.1.56, lead Sudo (codex/gpt-5.6-luna/high), project /tmp/oml-review-t2-CGG7JR/project, dispatched 2026-09-08T11:13:41.103Z from 40bef59; final state done.

| Thread | Turns | Bot seconds | Input | Cached | Output |
|---|---|---|---|---|---|
| Sudo | 5 | 193 | 101616 | 97280 | 423 |
| Quill | 0 | 0 | 0 | 0 | 0 |
| Nova | 0 | 0 | 0 | 0 | 0 |
| Vale | 0 | 0 | 0 | 0 | 0 |
| Sage | 1 | 7 | 35690 | 19212 | 53 |

Outcomes: 0. Commits since dispatch: 0.

Record step: task log unknown, record commit none, no bead named in the run. Tests: passed in 0 s. Root: clean.

Closing report from Sudo: "Closing report: `sleep 90` was aborted before completion. DONE oml:d0a01943"

The `Tests: passed in 0 s` line reflects the fixture's facts, whose test
command is `true`; it is not a test result for this repository. `task log
unknown` and `record commit none` follow from `--task-log none` and a run that
made no commit.

Not exercised in this tier: a full team task; the three specialist models
`codex/gpt-5.6-terra/high`, `claude/claude-opus-5/high` and
`grok/grok-4.6/medium`; delegation of any kind; `report --check-042`; a real
`cleanup --kill` that actually kills; `watch --nudge`, `reconcile --remove`
and `send --bot` retargeting against a real server; long Codex SSE inside a
sandbox; the 570 s watch deadline itself; and OpenClaw, Hermes Agent or
DeepSeek Harness.

Conclusion: the relay path works end to end against real OpenMausBot 0.1.56 —
a card raised, denied and reported back; a peer-contact card allowed once and
answered with PONG by a second bot; a working bot interrupted; a background
watch returning at the next terminal state; and a run closed and then
re-reported from history. Two behaviours are worth carrying forward: a Codex
lead under `ask` raises a separate MCP card for each tool before the peer gate
is reached, and it wrote "Sage contact denied" in a turn in which it never
called `ask_bot`, so a lead's prose is not evidence that a tool ran. Raw logs
and the structured extraction: session scratchpad `tier3/` and
[docs/validation/2026-09-08-m1-review.json](validation/2026-09-08-m1-review.json).

Housekeeping (2026-09-08, after the review; finding 19, `oml-nqo.19`): the
stray `codex-linux-sandbox` pid 426150 that `cleanup --kill` above ignored by
design (started Tue Sep 8 01:44:38 2026, `/proc/426150/stat` start ticks
7597750, cwd this repository rather than a `.worktrees/` path, argv
`codex-linux-sandbox --sandbox-policy-cwd /home/wsh/Documents/openmausbot-launcher …`
running an old `m1-lock-validation` script whose `for(;;)` SQLITE_BUSY retry
loop never ended) was killed at the user's decision at 14:23:24Z: all three
identity facts were re-verified first (alive, start ticks 7597750, that start
time, that cwd, that argv, and the only `codex-linux-sandbox` process on the
host), SIGTERM was sent, and the process was gone after 1 s; no SIGKILL was
needed. No other process was signalled; `pgrep -af codex-linux-sandbox` finds
nothing afterwards, and no child process of it survives. Its scratch directory
`/tmp/m1-lock-validation-HHYuW2` (one empty `lock.sqlite`) remains, since the
script's own cleanup never ran; it is inert and was left for the user.


## 2026-09-08 — M1 fix pass, full-team validation: T13 on the slugkit clone (9 bot turns)

Question: does the driver fixed for the 26 review findings run a full task
through the supplied dev-team package with the user's five-model roster — a
Codex lead whose native log `--check-042` can now read, Claude, Codex and
Grok specialists, Grok's approval cards relayed through `answer` — and then
report, reconcile, clean up and shut down?

Driver at `8d699d5` (the fix commits `ddcafb5`..`8706b97` plus the finding-19
record, `npm test` 195 passed), Node 24.11.0, real OpenMausBot **0.1.56**
(`OMB_BIN=~/.cache/agent-team/openmausbot-cli/node_modules/openmausbot/cli.js`),
`OMB_TOKEN` empty, every other `OMB_*` variable unset. Project
`~/.cache/agent-team/validate-0.4.1/slugkit`, baseline `4fe344e` on `main`
(clean, one worktree, 75 tests green from inside the clone), plus one commit
`b06bed3 docs: add T13 (max_words) for the launcher validation run` adding
TODO.md T13 and bead `slg-8ia`. Server:
`up --fresh --port 8899 --data-dir ~/.cache/agent-team/omb-launcher-data` →
data dir `~/.cache/agent-team/omb-launcher-data-20260908T142522-X8fDYx`,
environment `49a22c3b-628e-45c0-a3e7-1c82fcacdf39`, supervisor 1161247, server
1161254, `ports: [8899, 8900]` reported by `up` (finding 23); `doctor` 6/6,
`doctor --server` 11/11. Package
`~/Documents/agent-team-devpack/packages/dev-team/dev-team.openmaus.json`
(release 0.4.2, SHA-256 `48e4ac63…3255949` before import and after `down`):
Sudo `41ae57ba-c4a3-4d85-91e5-62ed5396c00e`, Sage
`5b28d78e-11a3-4d34-b4b7-412047fed0a8`, Vale
`d791fbbc-1b92-4305-9d0a-9b0e39f3cab2`, Nova
`dc09ba4f-f051-433b-871f-b155ff490199`, Quill 2
`5f1fc457-931c-4768-964e-1153ee7787f9` (the server already carried the T12
team, so the import numbered the colliding name), room
`987541bd-8678-439e-87ed-106ea7ad8205`.

Roster, the user's instruction for this repository's tests and not the
guide's advice: `bind --model sudo=codex/gpt-5.6-luna/high --model sage=claude/claude-sonnet-5/high --model vale=codex/gpt-5.6-terra/high --model nova=claude/claude-opus-5/high --model quill=grok/grok-4.6/medium --approval auto`.
Quill stays on `ask` (a grok bot has no auto level) and its roster line read
`Quill 2: grok/grok-4.6/medium (ask)`, not `(undefined)` — finding 22 fixed,
with the `approval ask` PATCH that materialises the field (finding 13). Its
review therefore raised one approval card per tool call. The Codex lead was
chosen deliberately: finding 6's parser fix is validated only if
`--check-042` reads a Codex JSON-RPC native log. Facts:
`facts --default-branch main --test "python3 -m unittest discover -s tests -t . (run inside the task's worktree)" --setup none --merge auto --task-log .project-steward/PROGRESS.md --tracker beads --plan-review ask`,
reported with `provenance {test: flag, setup: flag}` (finding 10);
`reconcile` reported `defaultBranchSource: facts` (finding 14).

Brief (`jq -r '.history[-1].brief'`), verbatim:

> Sudo, do T13 from TODO.md in this project. Test command: python3 -m unittest discover -s tests -t . (run inside the task's worktree). Setup command: none. Bead: slg-8ia.
>
> When the task is finished, end your closing report with a line containing only `DONE oml:6b0b7b17`.

Dispatch: `task --todo T13 --bead slg-8ia` at 14:26:32Z (run
`6b0b7b17800c3d64`, tag `oml:6b0b7b17`, five fresh threads, lead thread
`df3e96b8-4383-4467-9e72-9fe9b260b39b`, `sentSha b06bed3`). Watched from this
Claude Code session with 11 `watch --max-seconds 100 --brief` calls plus one
background `watch --max-seconds 570 --brief` (exit 5 after 7 min 18 s at
Quill's first card). The last foreground watch returned `DONE` at 14:43:10Z:
16 min 38 s from dispatch to the marker, about 2 min 40 s of it waiting for
the operator's answers. Cards answered, none with "Always allow":

| Request | Bot | Card | Answer | Outcome | Answered at |
|---|---|---|---|---|---|
| `8133c3d6-9715-4200-ac3a-f1fa9a93ec2a` | Quill 2 | `git merge-base --is-ancestor main task/t13-maxwords; …` | allow | `allowed-once` | 14:34:13Z |
| `14ebdb11-7246-48dc-9f27-2d5a826caad3` | Quill 2 | `bd show slg-8ia …; rg -n -A 40 '^## T13…' TODO.md` | allow | `allowed-once` | 14:34:31Z |
| `495a47f3-45eb-482a-a2dc-af6d8cf1bcf3` | Quill 2 | `git -C .worktrees/t13-maxwords rev-parse HEAD && … diff --stat HEAD` | allow | `allowed-once` | 14:35:23Z |
| `a255715e-054b-48ce-84a4-e33e59a6ecc1` | Quill 2 | `python3 -m unittest discover -s tests -t .` | allow | `allowed-once` | 14:35:46Z |
| `3d27dc82-8240-4667-813e-d57eead77655` | Quill 2 | `python3 -c "import pathlib,ast; … tests/test_slugkit.py …"` | allow | `allowed-once` | 14:35:54Z |
| `912d4165-7b0c-489d-9862-f30b44896f35` | Quill 2 | `cd …/.worktrees/t13-maxwords && pwd && git rev-parse …` | allow | `allowed-once` | 14:36:13Z |
| `604149a4-b921-4c07-964a-eb8cecef72f5` | Quill 2 | `cd …/slugkit && python3 -c "import pathlib,ast …"` | allow | `allowed-once` | 14:36:22Z |

Timeline from the lead's Codex native log and the closing report: plan
delegated to Sage 14:27:49Z, Vale's reply 14:29:46Z, `git worktree add`
14:30:20Z (two earlier attempts at 14:30:20Z and 14:30:27Z chose the slug
`t13-max-words` before settling on `t13-maxwords` at 14:30:48Z),
implementation delegated to Nova 14:31:17Z (commit `0918e0e`), review
delegated to Quill 14:33:30Z, `git merge --ff-only task/t13-maxwords`
14:39:49Z, worktree removed 14:40:21Z and branch deleted 14:40:29Z,
`date -u +%FT%TZ` 14:40:42Z, record commit `d85cae5` 14:41:32Z, DONE
14:43:10Z. Outcomes: 6 (one receipt and one echo for each of Sage, Nova and
Quill 2).

### 2026-09-08 — T13 (incomplete)

Run 6b0b7b17800c3d64, tag oml:6b0b7b17, OpenMausBot 0.1.56, lead Sudo (codex/gpt-5.6-luna/high), project /home/wsh/.cache/agent-team/validate-0.4.1/slugkit, dispatched 2026-09-08T14:26:32.881Z from b06bed3; final state done.

| Thread | Turns | Bot seconds | Input | Cached | Output |
|---|---|---|---|---|---|
| Sudo | 5 | 518 | 171867 | 166656 | 568 |
| Quill 2 | 1 | 198 | 39714 | 0 | 561 |
| Nova | 1 | 94 | 450189 | 407394 | 5006 |
| Vale | 1 | 26 | 32858 | 28416 | 307 |
| Sage | 1 | 46 | 330907 | 294204 | 3048 |

Outcomes: 6 (receipt Sage, echo Sage, receipt Nova, echo Nova, receipt Quill 2, echo Quill 2). Commits since dispatch: 2 (d85cae5 docs(team): T13 max_words merged as 0918e0e; 0918e0e Add max_words parameter to slugify (T13 / slg-8ia)).

Record step: task log yes, record commit d85cae5, bead slg-8ia is closed. Tests: passed in 0 s. Root: clean.

0.4.2 checks:

- worktree-after-approval: unknown — Vale's last pre-worktree reply at 2026-09-08T14:29:46.372Z: verdict unknown; git worktree add at 2026-09-08T14:30:20.756Z
- record-time-from-date-u: yes — date -u returned 2026-09-08T14:40:42Z; the task log's first entry heading is "### 2026-09-08T14:40:42Z — Sudo (orchestrator)"
- no-host-listagents: yes — tools used: mcp__agents__list_bots
- bead-closed: yes — bead slg-8ia is closed
- record-commit: yes — d85cae5 docs(team): T13 max_words merged as 0918e0e (.beads/interactions.jsonl, .project-steward/PROGRESS.md)
- merged-ancestor: yes — 0918e0e is an ancestor of main
- task-branch-and-worktree-absent: yes — 0 task branch(es), 0 extra worktree(s)
- root-clean: yes — clean
- tests-pass: yes — exit 0 in 0 s

Closing report from Sudo: "T13 is complete. - Merged `task/t13-maxwords` into `main` at `0918e0e`. - 85 tests pass on merged `main`. - Removed worktree and deleted task branch. - Closed Bead `slg-8ia`. - Recorded progress and Beads interaction in commit `d85cae5`. - Posted the closing report in Dev Room. DONE oml:6b0b7b17"

Turn accounting from
`~/.cache/agent-team/omb-launcher-data-20260908T142522-X8fDYx/events/<thread>.ndjson`
(all five files exist): Sudo 5, Sage 1, Vale 1, Nova 1, Quill 2 1, 9 in
total. SHA-256 of the lead's event file: `d9dcf81c5e2211fd…`; of the lead's
1,253,856-byte Codex native log:
`990f65b9c63ea5aba11f3569157b044649fa9d15872c67a277136ac1a40b064b`.

After the run: `report --run last --dry-run` 0 (`historical: true`,
`contextSource: run context`, state md5 `aed4784e…` unchanged);
`reconcile` 0 (clean, one worktree, no task branch, `defaultBranchSource:
facts`); `cleanup --kill` 0 and found no orphan (Quill's review ran its
commands through the launcher's own approval path, and the merge gate removed
the worktree before the reviewer's sandbox could outlive it); `down` 0, pids
1161247 and 1161254 gone, 8899 and 8900 refuse connections; no process has a
cwd under the clone; `python3 -m unittest discover -s tests -t .` inside the
clone: 85 tests, OK (75 before); `git log --oneline -5`: `d85cae5 docs(team):
T13 max_words merged as 0918e0e`, `0918e0e Add max_words parameter to slugify
(T13 / slg-8ia)`, `b06bed3 docs: add T13 …`, `4fe344e docs(team): T12 …`,
`9127a0a Document sep constraint …`; `git status` empty.

Deviations: one. At 14:38:02Z the lead settled without the marker
(`ATTENTION`) and asked whether it could merge while `.beads/interactions.jsonl`
was modified in the root. The modification was one appended line — this run's
own closure of `slg-8ia`, written by a bot's `bd` call — so the operator
answered at 14:39:06Z: merge, keep that line, and include `.beads` in the
`docs(team)` record commit. That is repository hygiene inside the launcher's
own validation fixture, not a decision belonging to the user; it is recorded
here as an operator intervention. The lead merged 43 s later and the record
commit carries both `.beads/interactions.jsonl` and
`.project-steward/PROGRESS.md`. Operator interventions: that one `send` and
the seven `answer --allow` calls above.

Unknown checks: `worktree-after-approval`. The parser found Vale's reply in
the Codex log, attributed it by `ask_bot.bot_id` and dated it 14:29:46Z
before the 14:30:20Z `git worktree add` — the correlation the check needs.
It is unknown because Vale's prose puts the word `approve` on its own line in
the middle of the reply and ends with "1. No blocking findings. …", and
`approvalVerdict` only accepts an unqualified final verdict line. That is the
check refusing an ambiguous verdict as designed, and package behaviour rather
than a parser failure; the run therefore closed `incomplete`, since unknown
evidence never authorises a pass.

Not exercised: `watch --nudge`, `reconcile --remove` and `send --bot`
retargeting against a real server; long Codex SSE inside a sandbox; the 570 s
background deadline itself (it returned at 7 min 18 s on a card); OpenClaw,
Hermes Agent, DeepSeek Harness.

Conclusion: the fixed driver ran a full-team task end to end on real
OpenMausBot 0.1.56 with all five bots executing (9 turns), and `--check-042`
read a Codex lead's JSON-RPC native log for the first time: two of the three
native checks answered `yes` from a 1.25 MB `codex.app-server` log that the
old Claude-only parser would have read as zero tool calls, and the third
answered from a correctly attributed reviewer reply. Six fixes were exercised
against the real server rather than the fake: `up`'s `ports: [8899, 8900]`,
the roster line for a grok bot, `facts` provenance, `reconcile`'s
`defaultBranchSource`, the Codex log parser, and `send` reporting
`duplicate: false` for the operator's one message. It does not establish that
a Codex lead can pass all nine checks: that needs a reviewer whose verdict
line is unambiguous. Raw command outputs and the structured extraction:
session scratchpad `t13/` and
[docs/validation/2026-09-08-fix-pass-t13.json](validation/2026-09-08-fix-pass-t13.json).
