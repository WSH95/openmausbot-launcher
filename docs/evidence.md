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

## 2026-09-16 — v2 host verification: OpenClaw, Hermes Agent, DeepSeek Harness on real OpenMausBot 0.1.56 (3 bot turns)

The three hosts that `references/hosts.md` carried as "documented only" now have
command evidence: **OpenClaw 2026.9.4 (3a9d69d)**, **Hermes Agent** (no version
command; `~/.hermes/hermes-agent/pyproject.toml` reads `0.21.3`) and **DeepSeek
Harness (dsh) 0.1.5-rc.1**, each driving the launcher against real OpenMausBot
**0.1.56** on Node 24.11.0. Beads `oml-n2f` (OpenClaw) and `oml-5bw` (Hermes and
dsh). The structured record is
[validation/2026-09-16-hosts-v2.json](validation/2026-09-16-hosts-v2.json): native
session and item ids, every executed command with its exit code and output, the
approval cards, the automation runs, the cron execution row and the shutdown.

**What this establishes.** Each host found the installed skill, ran the driver by
path, reached the real server, sent one operator-authored message to Sudo and read
the matching reply back through `status`. It also establishes the OpenClaw phone
path end to end, from a Telegram DM to the answer in the same chat; that an
OpenClaw automation with `--announce` does not deliver an empty output; and that a
Hermes cron job runs the adapter script through the Hermes gateway. It does not
establish `watch` on any of these hosts, a launcher task (`run` was `null`
throughout), bot-to-bot delegation, or the other four bot models executing. Only
Sudo ran, for exactly **three OMB turns**. The host sessions also consumed the
user's subscriptions; the counts are below.

### Environment and fixture

- Temporary Git project `/tmp/oml-v2-hosts-i1Dlq7/project`, branch `main`, one
  commit `28f7f90772c94b6cc30d5a59c421687d704db1c1` ("init").
- Fresh data directory
  `/home/wsh/.cache/agent-team/omb-launcher-data-v2hosts-ZBIA7t-20260916T143458-6frTho`.
- Server `http://127.0.0.1:8899` (webhook ingress 8900), environment
  `3165e5e8-3ad0-4d84-bb65-fb311b09556b`, owned supervisor/health pids `43172` and
  `43179`, started 14:35:02.391Z, stopped 15:26:12.443Z. `doctor --server` from the
  operator shell passed 10/10.
- `OMB_BIN=/home/wsh/.cache/agent-team/openmausbot-cli/node_modules/openmausbot/cli.js`,
  `OMB_TOKEN` empty (loopback trust). The driver ran on Node 24.11.0 in every host;
  OpenClaw itself runs on Node 24.21.0, installed side by side.
- Unchanged external test input:
  `/home/wsh/Documents/agent-team-devpack/packages/dev-team/dev-team.openmaus.json`,
  release 0.4.2. SHA-256 before the import and after every check:
  `48e4ac637c7afb6d9e82f0ecf035967411d9c75e61ac8e0603ee7b62a3255949`.
- Sudo `73230cfd-3bba-4962-800e-57ba1d3d5004`; conversation
  `86905161-06df-4cbd-9e6c-89eaadeae032` for all three sends.

| Role | Binding | Execution in these checks |
|---|---|---|
| Sudo, leader | `codex/gpt-5.6-luna/high` | three acknowledgment turns |
| Sage, planner | `claude/claude-sonnet-5/high` | configured only |
| Vale, plan reviewer | `codex/gpt-5.6-terra/high` | configured only |
| Nova, implementer | `claude/claude-opus-5/high` | configured only |
| Quill, code reviewer | `grok/grok-4.6/medium` | configured only |

`bind` ran with `--approval auto`; the state file records `approvalMode: auto` for
Sudo, Sage, Vale and Nova and `ask` for Quill. `facts` recorded `test: none`,
`setup: none`, `merge: auto`, `taskLog: README.md`, `tracker: none`,
`planReview: ask`.

Each host was told to use the installed skill, run the commands exactly as written
and paste stdout verbatim. The operator authored every nonce.

### OpenClaw 2026.9.4 (3a9d69d), bead `oml-n2f`

Install: Node 24.21.0 under `~/.local/lib/node-v24.21.0` (OpenClaw needs 24.16 or
later), `npm install -g --prefix` that directory `openclaw@latest` with build
scripts allowed for `openclaw`, `@google/genai`, `koffi`, `tree-sitter-bash` and
`protobufjs`; a wrapper `~/.local/bin/openclaw` puts that Node first on `PATH`.
Onboarded non-interactively (`--non-interactive --accept-risk --flow quickstart
--auth-choice skip --mode local --gateway-bind loopback --install-daemon`): gateway
`loopback:18789` with token auth and a `systemd --user` unit
`openclaw-gateway.service`. Auth: `openclaw models auth login --provider openai
--device-code --set-default`, which needs a TTY and a browser for the device code;
default model `openai/gpt-5.6-sol`. Agent turns run through the bundled Codex
app-server harness (`agentHarnessId: codex`).

Discovery: `openclaw skills list` shows `openmausbot-launcher` as `ready`, source
`agents-skills-personal` (the `~/.agents/skills` symlink); `openclaw skills check`
answers "Ready and visible to model".

Policy. `tools.exec.mode=allowlist` makes every agent turn fail at preflight before
any command runs:

```
Codex app-server local execution is unavailable because effective tools.exec.mode=allowlist.
Execution-host approvals are authoritative. For gateway turns, inspect them with
`openclaw approvals get --gateway` and update that same target with
`openclaw approvals set --gateway --stdin`; for local `agent exec`, omit `--gateway`.
Intentionally align that host policy before retrying.
```

`ask` and `auto` both work; `ask` was kept. Two allowlist entries were added with
`openclaw approvals allowlist add --agent main <path>/scripts/omb.mjs`, for the repo
path and for the `~/.agents/skills` symlink path, both with scope "any args". They
bought nothing here, because an entry matches a command whose program is that path
and the agent's own invocations were `node <script> …` on the phone path and
`env OMB_BIN=… <script> …` in the CLI turns. Every command also runs inside the
Codex sandbox, which blocks loopback. `status` exits 1 with

```json
{"ok":false,"verb":"status","error":"cannot reach http://127.0.0.1:8899: EPERM","hint":"the shell's sandbox blocks outbound connections: run this command outside the sandbox (escalation), or use --remote against a reachable URL"}
```

and `doctor --server` reports `nothing answers at http://127.0.0.1:8899` against a
healthy server, because the driver's health probe returns `null` on a network error
(`scripts/lib/server.mjs:70-75`) and the check has nothing else to print
(`scripts/lib/verbs/lifecycle.mjs:70`). That is a driver limitation, recorded here
and not fixed in this pass.

The way through is the harness's own escalation: the Codex plugin raises an
OpenClaw approval titled "Codex app-server command approval" with a 120 s window and
the decisions `allow-once`, `allow-always` and `deny`, resolvable with `openclaw
approvals resolve <id> allow-once`. `allow-once` was used every time and
`allow-always` never.

`skills.entries.openmausbot-launcher.env` (`OMB_BIN`, `OMB_TOKEN`) is stored in
`~/.openclaw/openclaw.json` but is not applied to commands run through the Codex
harness: `doctor` failed with `openmausbot not found: set OMB_BIN to cli.js of the
openmausbot package or put openmausbot on PATH` until the command itself carried an
explicit `env OMB_BIN=… OMB_TOKEN= …` prefix.

Three CLI turns, each `openclaw agent --json -m …`:

| Turn | Run id | Window | Commands and result |
|---|---|---|---|
| 1 | `2e1a8c31-f201-42bb-a27b-e0f4ab9413a8` | 15:12:13Z to 15:12:57Z, 42 s | `doctor` exit 3 (the binary check failed: no env), `doctor --server` exit 3 (binary and "nothing answers"), `status --brief` exit 1 (EPERM); no escalation requested |
| 2 | `85d47860-0e98-46ce-9fdb-e0f651c80531` | 15:15:31Z to 15:20:45Z, 312 s | the env prefix fixed `doctor` (exit 0); two escalation requests expired unanswered, so `doctor --server` and `status --brief` stayed sandboxed |
| 3 | `70443744-9399-421d-a220-a662ca6d6a50` | 15:21:27Z to 15:23:32Z, 123 s | four commands, each allowed once: `doctor --server` 10/10, `status --brief` `status · no run · team idle`, `send`, `status --tail 3` |

Turn 3's commands, as executed:

```sh
env OMB_BIN=/home/wsh/.cache/agent-team/openmausbot-cli/node_modules/openmausbot/cli.js OMB_TOKEN= \
  /home/wsh/.agents/skills/openmausbot-launcher/scripts/omb.mjs doctor --server --project /tmp/oml-v2-hosts-i1Dlq7/project
env … omb.mjs status --brief --project /tmp/oml-v2-hosts-i1Dlq7/project
env … omb.mjs send "OpenClaw check 396649b2: reply with just the nonce 396649b2" --project /tmp/oml-v2-hosts-i1Dlq7/project
env … omb.mjs status --tail 3 --project /tmp/oml-v2-hosts-i1Dlq7/project
```

Four approval cards, one per command, each allowed within about five seconds, and
each command started about 175 ms after its decision:

| Approval | Created | Allowed | Command it authorised |
|---|---|---|---|
| `plugin:ed2a39a6-a6a9-4032-b9a1-818ad236e1b7` | 15:21:54.556Z | 15:21:59.883Z | `doctor --server` |
| `plugin:7d191f4a-d919-4e2c-9d8b-c4dda01a017b` | 15:22:07.540Z | 15:22:12.019Z | `status --brief` |
| `plugin:dba3b0a5-dc97-4a0f-a459-908bcd3c20a2` | 15:22:18.756Z | 15:22:23.763Z | `send` |
| `plugin:0ce14524-5400-4732-9077-ddcd72e2c49e` | 15:22:30.657Z | 15:22:35.735Z | `status --tail 3` |

The send returned message `8004203b-6416-4305-99ab-25b517702a66` (nonce `396649b2`)
at 15:22:23.925Z; Sudo answered `396649b2` as `49c62479-285a-4ed2-b67e-b71f522dfade`
at 15:22:32.060Z, 8.1 s later, in OMB turn
`50518f2e-25e6-4c19-93ef-a57a4beb314c`.

**Phone proof.** A Telegram DM asking for the project's status line (inbound
15:09:52.611Z, 139 characters, `telegram:7724282441 -> @OMBLauncherCheckBot`)
produced, in OpenClaw run `cc799b9f-94e5-4a50-a4d4-bf8c8ad74c39`, thread
`01a0aac4-6c6f-71d2-8d7c-3618b890e931`: the agent reading the skill, then `node
/home/wsh/.agents/skills/openmausbot-launcher/scripts/omb.mjs status --project
/tmp/oml-v2-hosts-i1Dlq7/project --brief` at 15:10:08.971Z exiting 1 with the EPERM
error above; approval card `plugin:7c145865-a890-4ad7-96e2-2389490b98f0` raised at
15:10:15.123Z and delivered to Telegram as message `9` at 15:10:18.439Z; an inbound
Telegram update at 15:11:04.766Z, after which the gateway's
`plugin.approval.waitDecision` returned at 15:11:05.397Z having waited 50,186 ms;
the same command at 15:11:05.624Z exiting 0 with `status · no run · team idle`; and
the agent sending that exact line back as Telegram message `10` to chat
`7724282441` at 15:11:12.437Z.
The bot is `@OMBLauncherCheckBot`; its token lives in
`~/.openclaw/telegram-bot.token` (mode 0600) referenced by
`channels.telegram.tokenFile` and never appears on a command line. The DM required
pairing: code `TGLH7375`, approved with `openclaw pairing approve telegram
TGLH7375`, which also made that user the command owner. An earlier DM attempt failed
with "Something went wrong" while `tools.exec.mode=allowlist`, the preflight refusal
quoted above.

### 2026-09-17 — Telegram bot rotation remediation

The token visible in an earlier screenshot was treated as compromised. Before a
replacement was made, a token-safe `getMe` probe using the old 0600 file returned
HTTP 401 and `ok:false`; the token was not printed. The user then created
`OpenClaw Laptop` (`@WSHOpenClawLaptopBot`, Telegram bot id `8904072141`). Its
replacement token was staged privately, validated with a token-safe probe, and
atomically replaced `/home/wsh/.openclaw/telegram-bot.token`.

The final safe snapshot at `2026-09-17T11:40:11Z` records OpenClaw
`2026.9.4 (3a9d69d)`, token-file mode 0600 and owner `wsh:wsh`.
`channels.telegram.tokenFile` still names that file and no inline `botToken` is
configured. `dmPolicy=pairing` and `groupPolicy=disabled` remain explicit. The
user kept BotFather group joining enabled: the final safe probe reports
`can_join_groups:true` and `can_read_all_group_messages:false`; OpenClaw still
refuses group processing under `groupPolicy=disabled`.

The gateway service was active. The final Telegram account was configured,
running and connected, using `tokenFile` with token status available, zero
reconnect attempts and no last error. The user's `/start` and `/status` produced
fresh inbound and outbound channel timestamps. The existing approved sender
remained valid under account `default`, so no new pairing approval was needed.
There was one existing command owner and zero pending Telegram pairing requests;
no owner identifier or message content is recorded here.

After the replacement passed the DM gate, the user confirmed that
`@OMBLauncherCheckBot` was deleted in BotFather. Its already revoked token was
never restored. This was OpenClaw infrastructure validation: zero OpenMausBot
server starts and zero OMB bot turns. Telegram identifies the general OpenClaw
gateway; OMB is an OpenClaw skill, not a separate Telegram trust boundary. Future
projects may use Telegram forum topics and per-topic OpenClaw agent routing
through this bot. A second bot is deferred unless users, permissions or
workspaces require isolation.

**Automations** (`openclaw automations create`, aliased as `openclaw cron`) answer
the open question about `--announce` on empty output. Two jobs were created against
the fixture and run manually:

| Job | Command | Run | Result |
|---|---|---|---|
| `omb-empty` `2e7024a8-50fd-4aea-b6be-f43fcd284ebd` | `true` | `manual:2e7024a8-50fd-4aea-b6be-f43fcd284ebd:1789572099849:1` | succeeded; `command ok with no output`; `delivered: false`, `deliveryStatus: "not-delivered"`, `deliverySuppressionReason: "empty"` |
| `omb-status` `b117317c-f27b-4bc9-903a-4f63beac6a7a` | `<skill>/scripts/omb.mjs status --project <fixture> --brief` with `--command-env OMB_BIN=…` and `--command-env OMB_TOKEN=` | `manual:b117317c-f27b-4bc9-903a-4f63beac6a7a:1789572101199:2` | succeeded; `delivered: true` with summary `status · no run · team idle` |

Both used `--announce --channel telegram --to 7724282441` and both were removed
afterwards. An empty output is therefore not announced, and `--command-env` is how
an automation gets `OMB_BIN`.

### Hermes Agent, bead `oml-5bw`

Install: `curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
--non-interactive --skip-setup --skip-browser --skip-computer-use` into
`~/.hermes/hermes-agent` (uv-managed Python); the installer needs a C++ compiler
(`sudo apt install build-essential`), and puts `hermes` on `~/.local/bin`. There is
no version command (`hermes version` is not a command); the package metadata reads
`0.21.3`. Auth: `hermes auth add openai-codex --type oauth --no-browser` (device
code completed in the user's browser) produced credential `openai-codex-oauth-1`,
with `model.provider openai-codex` and `model.default gpt-5.6-sol`; `hermes -z`
answered `pong`.

Discovery: `hermes skills list` did **not** show the skill until
`~/.hermes/config.yaml` gained

```yaml
skills:
  external_dirs:
    - ~/.agents/skills
```

after which it is listed as local, enabled. The documented default scan of
`~/.agents/skills` did not hold on this install. At run time the agent loaded the
skill with its own `skill_view` tool, whose result begins `{"success": true,
"name": "openmausbot-launcher", …}`.

Turns ran through `hermes -z` with the terminal backend `local` and no sandbox;
`OMB_BIN` and `OMB_TOKEN` were exported in the launching shell. Turn 1
(15:12:43Z to 15:13:54Z, session `20260916_111246_e6c67d`) ran the three read
commands by path:

```sh
/home/wsh/.agents/skills/openmausbot-launcher/scripts/omb.mjs doctor --project /tmp/oml-v2-hosts-i1Dlq7/project
/home/wsh/.agents/skills/openmausbot-launcher/scripts/omb.mjs doctor --server --project /tmp/oml-v2-hosts-i1Dlq7/project
/home/wsh/.agents/skills/openmausbot-launcher/scripts/omb.mjs status --brief --project /tmp/oml-v2-hosts-i1Dlq7/project
```

`doctor` passed 5/5, `doctor --server` passed all ten checks including `identity`
("the recorded server identity matches") and `provider-keys` ("no provider API keys
in the server's environment"), and `status --brief` printed `status · no run · team
idle`. Turn 2 (15:15:38Z to 15:16:48Z, session `20260916_111540_924d2f`) sent
message `22ca85be-86c2-46c6-a07c-c01a26ed3813` (nonce `7755d349`) at 15:15:52.668Z;
Sudo answered `7755d349` as `539457e9-793a-4e4c-8a9e-9c6aeb323e3a` at 15:16:03.146Z,
10.5 s later, in OMB turn `c8630b48-c755-4817-aec4-ca293b3569c0`. The agent ran
`status --tail 3` twice, with a `sleep 20` between them. The `send` command's stdout
also carried Node's SQLite `ExperimentalWarning` lines ahead of the JSON.

**Cron adapter.** `~/.hermes/scripts/omb-watch.sh` holds the `references/hosts.md`
adapter, in the `status --brief` form because no run was open:

```sh
#!/bin/sh
export OMB_BIN=/home/wsh/.cache/agent-team/openmausbot-cli/node_modules/openmausbot/cli.js OMB_TOKEN=
/home/wsh/.agents/skills/openmausbot-launcher/scripts/omb.mjs status --project /tmp/oml-v2-hosts-i1Dlq7/project --brief
c=$?; case $c in 0|4|5) exit 0;; *) exit $c;; esac
```

`hermes cron create "every 5m" --name omb-watch --no-agent --script omb-watch.sh
--deliver local` created job `8be2016cb077`. Jobs fire only with the gateway
running: `hermes gateway install` installs the user service `hermes-gateway.service`
and the installer enabled `loginctl` lingering itself. `hermes cron run
8be2016cb077` answered "Ran now: succeeded"; the execution row
(`~/.hermes/cron/executions.db`) reads `status completed`, started
2026-09-16T11:18:35.655640-04:00, finished 11:18:36.027060-04:00,
`delivery_outcome: suppressed` for the `local` target. The output file
`~/.hermes/cron/output/8be2016cb077/2026-09-16_11-18-35.md` held "Mode: no_agent
(script)" and the line `status · no run · team idle`; it was removed with the job
and is no longer readable, so that content is quoted from the session ledger rather
than from the file. `--deliver` accepts `origin`, `local`, `telegram`, `discord`,
`signal` and `platform:chat_id`.

### DeepSeek Harness (dsh) 0.1.5-rc.1, bead `oml-5bw`

Install: `npm install -g @deepseek-ai/dsh@latest` under the Node 24.11.0 prefix with
build scripts allowed for `@deepseek-ai/dsh-subprocess-local`, `koffi`, `node-pty`,
`@google/genai` and `protobufjs`; symlink `~/.local/bin/dsh`. The DeepSeek key is
read by a wrapper from a 0600 file and never appears in argv. The headless entry is
`dsh --profile headless "<task>"`, which answers one task with reasoning on stderr
and the final message on stdout; a probe answered `pong`. The session runs
`deepseek-official` / `deepseek-flash`.

Discovery: the session prompt lists `openmausbot-launcher` with its description in
an `<available_skills>` block, and the skill tool resolves its base directory to
`/home/wsh/.agents/skills/openmausbot-launcher`, the only install location on this
machine. The tier numbers that third-party posts claim were not verified.

**PID namespace.** dsh runs its shell subprocesses as the same user inside a systemd
scope named `dsh-subprocess-*` with its own PID namespace (session log: permission
preset `workspace-write`, sandbox mode `workspace-write`, approval policy `ask`). A
probe returned:

```
1000
wsh
WSH

0::/user.slice/user-1000.slice/user@1000.service/app.slice/dsh-subprocess-57953-87ffb975f19c.scope
1
pid:[4026532841]
[stderr]
ls: cannot access '/proc/43179': No such file or directory
head: cannot open '/proc/43179/stat' for reading: No such file or directory
```

The server process is invisible from inside, so the driver's local process-identity
checks cannot pass. Loopback HTTP is allowed: health answered. In turn 1 (15:12:49Z
to 15:13:16Z) `doctor` passed 5/5 and `doctor --server` returned `ok: true` with an
empty `failed` list, because the two checks that did not pass are not required:

```
provider-keys  ok: null   unknown: the server's environment is not readable
identity       ok: false  the server is not the one recorded in the state (restarted or replaced): re-import or adopt the team
```

`status --brief` then exited 3:

```json
{"ok":false,"verb":"status","error":"the live server process identity could not be verified","hint":"run on the server's machine, or pass --remote for an HTTP connection"}
```

Turn 2 (15:17:23Z to 15:18:16Z) took the hint and used remote mode:

```sh
/home/wsh/.agents/skills/openmausbot-launcher/scripts/omb.mjs send "dsh check ee42ea0e: reply with just the nonce ee42ea0e" --remote --url http://127.0.0.1:8899 --project /tmp/oml-v2-hosts-i1Dlq7/project
/home/wsh/.agents/skills/openmausbot-launcher/scripts/omb.mjs status --tail 3 --remote --url http://127.0.0.1:8899 --project /tmp/oml-v2-hosts-i1Dlq7/project
```

The send returned `4ffbd26a-01b5-48bd-b757-c47cc6990fb4` (nonce `ee42ea0e`) at
15:17:31.005Z; Sudo answered `ee42ea0e` as
`6cff2a1d-dac3-473e-bb58-68560f95b3f4` at 15:17:38.503Z, 7.5 s later, in OMB turn
`a9400914-a1a3-4791-8744-cb64d455ff90`. `status --tail 3` ran three times: once
directly and twice inside the agent's own retry loop, which reported
`FOUND_ON_ATTEMPT 2`. So `--remote` is not an optional nicety on dsh; it is how the
live verbs work there.

### Incidents

1. OpenClaw's `tools.exec.mode=allowlist` blocks the Codex harness entirely, before
   any command runs. Fixed by keeping `ask`.
2. The exec allowlist matches the command's own program path, so neither the
   agent's `node <script> …` nor its `env OMB_BIN=… <script> …` form matched an
   entry for `<script>`, and the cards kept coming. Not fixed; treat the allowlist
   as an optimisation, not as a way to avoid approvals.
3. `skills.entries.<name>.env` is not applied to Codex-harness commands. Worked
   around with an explicit `env …` prefix in the command itself.
4. Two escalation requests in OpenClaw CLI turn 2 expired unanswered after the full
   120 s window, because the operator's auto-resolver filtered on a summary that the
   card truncates. One is named in the gateway log
   (`plugin:d5680bba-9625-40e3-995a-6bf946a38f76`, "expired" at 15:20:48.153Z); the
   other appears only as a second 119,976 ms wait and its id is not recorded. Turn 3
   resolved every card in about five seconds.
5. `doctor --server` cannot distinguish a blocked socket from a dead server: the
   health probe returns `null` on a network error (`scripts/lib/server.mjs:70-75`)
   and the check prints "nothing answers" (`scripts/lib/verbs/lifecycle.mjs:70`),
   while `status` on the same socket names the sandbox. Driver limitation, observed
   here, not fixed in this pass.
6. dsh's PID namespace defeats the local identity check. Answer: `--remote`.
7. Hermes did not scan `~/.agents/skills` by default. Answer: `skills.external_dirs`.

### Cleanup and accounting

`reconcile` at 15:26:12Z reported clean on `main`, one worktree, no task branches,
`defaultBranchSource: facts`. `cleanup --kill` found no orphan
(`pattern: codex-linux-sandbox`, `orphans: []`, `killed: []`). `down` stopped the
owned server (`supervisorPid 43172`, `healthPid 43179`); ports 8899 and 8900 are
closed afterwards and the package hash is unchanged. No pushes occurred.

Bot turns: **3**, all Sudo, all `ok: true`, in thread
`86905161-06df-4cbd-9e6c-89eaadeae032`:

| OMB turn | Host that sent | Completed | Usage in/out (cached in) |
|---|---|---|---|
| `c8630b48-c755-4817-aec4-ca293b3569c0` | Hermes | 15:16:03.207Z | 19215 / 42 (9984) |
| `a9400914-a1a3-4791-8744-cb64d455ff90` | dsh | 15:17:38.578Z | 23638 / 19 (5888) |
| `50518f2e-25e6-4c19-93ef-a57a4beb314c` | OpenClaw | 15:22:32.072Z | 25220 / 8 (23296) |

Paid host turns, counted from each host's own store: OpenClaw **6** (two `pong`
probes, one Telegram DM turn, three CLI turns; the session brief estimated about
five, and the attempts that failed at the allowlist preflight never reached the
model), Hermes **3** (pong, turn 1, turn 2), dsh **4** (pong, turn 1, the namespace
probe, turn 2).

### Not exercised

OpenClaw's `exec` 10-second background yield for a long `watch` (it needs an open
run), `allow-always`, a non-loopback gateway bind; Hermes cron delivery to a chat
channel and any watch longer than the terminal tool's configured timeout; a dsh
shell time limit and `watch` in remote mode; `watch`, `task`, `answer`, `interrupt`
and `report` on all three hosts. The M1 hosts (Claude Code, Codex CLI, Grok Build)
were not re-run in this pass.

## 2026-09-16 — v2 remote run: pair and the remote verbs over Tailscale (2 bot turns)

The remote variant that `references/hosts.md` and `docs/design.md` carried as
"documented only" now has command evidence. Real OpenMausBot **0.1.56**, started
by hand with `--tailscale`, published its loopback port on the tailnet as
`https://wsh.taila20f43.ts.net`; the launcher paired with it twice over that
tunnel — once for an owner-scope session, once for a client-scope one — and ran
the HTTP-only verb set through it. Beads `oml-xnn` (the `pair` verb) and
`oml-9kp` (the binding rule this run broke). The structured record is
[validation/2026-09-16-remote-tailscale.json](validation/2026-09-16-remote-tailscale.json):
54 commands with their outputs verbatim, the session, message and thread ids, the
binding gap, and the shutdown.

**What this establishes.** `openmausbot serve --tailscale` publishes the server
on the tailnet with an HTTPS certificate and nothing else; a proxied request
without a token is refused even though the same server trusts loopback. The
`pair` verb exchanges a code minted by `openmausbot pair` into a 0600 token file
and prints the session's label, scopes and expiry but never the token, for an
owner session and a client session side by side in two files. A spent code
replayed from the tailnet is refused in the server's own words. Through the
tunnel the driver ran `doctor`, `doctor --server`, `status`, `send`,
`status --tail`, `watch` and `interrupt`; a client-scope session was refused on
the one admin route and allowed on `interrupt`. A run dispatched locally was
watched and interrupted from the tunnel by both sessions. The lead answered
twice in the phase — once to a remote `send`, once to the run's brief — for
exactly **two OMB turns**.

**What it does not establish.** There was no second machine: the driver ran on
the server's own host and reached it through the tailnet address, so this is the
tunnel and the token path, not a network partition. No Telegram, no OpenClaw and
no other agent host took part — every command came from the operator's shell.
`answer` and an approval card through the tunnel, `--tunnel` after `openmausbot
login`, a delegation chain under a remote `watch`, a session left to expire
rather than revoked, and two launchers writing one origin are all untested.

### Environment and fixture

- Tailscale installed and logged in by the user (sudo); MagicDNS name
  `wsh.taila20f43.ts.net`; HTTPS certificates enabled by the user in the admin
  console (`CertDomains: ['wsh.taila20f43.ts.net']`); `sudo tailscale set
  --operator=$USER` so the operator shell could serve. The Tailscale version is
  not recorded.
- The server was started by hand, not by `up`, in a sanitized environment:

```sh
env -i PATH=/home/wsh/.local/bin:/usr/local/bin:/usr/bin:/bin HOME=/home/wsh \
  OMB_ASK_BOT_TIMEOUT_MS=600000 setsid nohup /home/wsh/.local/bin/node $CLI \
  serve --port 8899 --data-dir "$DD" --tailscale --no-pair > $SP/remote-serve.log 2>&1
```

  `$CLI` is
  `/home/wsh/.cache/agent-team/openmausbot-cli/node_modules/openmausbot/cli.js`,
  `$DD` is
  `/home/wsh/.cache/agent-team/omb-launcher-data-v2remote-CGHy3C`. It started at
  about 15:34Z and was stopped at 16:51:32Z. The log opens with

```
tailscale: serving https://wsh.taila20f43.ts.net → http://127.0.0.1:8899 (only your tailnet can reach it)
…
OpenMausBot is running on http://127.0.0.1:8899, reachable at https://wsh.taila20f43.ts.net
```

- `tailscale serve status` (15:35Z) read `https://wsh.taila20f43.ts.net (tailnet
  only)` with `|-- / proxy http://127.0.0.1:8899`. Through the tunnel,
  `/api/health` answered `{"app":"openmausbot"} HTTP 200` and the well-known
  environment answered

```json
{"environmentId":"15204312-7b3a-4022-90ec-cac6e5b1637c","label":"WSH","platform":"linux","version":"0.1.56","capabilities":{"remoteSessions":true,"selfUpdate":"operator"}}
```

- A protected route through the tunnel without a token is refused, while the same
  route on loopback is not:

```json
{"error":"forbidden: this request came through a proxy (pair this device to use the server remotely)"} HTTP 403
```

  That is `request-auth.ts:378` in the pinned 0.1.56 source: loopback trust does
  not survive a proxy hop, which is what makes pairing necessary rather than
  optional.
- Three pids, because the server was hand-started: `76752` the `setsid` wrapper
  the pid file recorded, `76759` the `cli.js serve` process, `76827` the health
  process the state file records (`healthStart 1622400`). Ports 8899 and 8900
  (the webhook receiver).
- Fixture project `/tmp/oml-v2-remote-l5cKYy/project`, branch `main`, one commit
  `64fa0970b43da65373cc3aff53b3d65ca7adfcf3` ("init"). `up` **attached** to the
  hand-started server (`owned: false`), `doctor --server` passed 10/10 with
  engines `grok, claude, codex, hermes`, the same unchanged package
  (`dev-team.openmaus.json` 0.4.2, SHA-256
  `48e4ac637c7afb6d9e82f0ecf035967411d9c75e61ac8e0603ee7b62a3255949`) was
  imported, the roster bound and `facts` set (`test: none`, `setup: none`,
  `merge: auto`, `taskLog: README.md`, `tracker: none`, `planReview: ask`). The
  exact argv of those setup commands is not in a raw log; the state file holds
  their result.
- Lead Sudo `0c942a97-34fe-4994-b37c-22c1f3e28d64` on `codex/gpt-5.6-luna/high`,
  with Sage, Vale, Nova and Quill configured and never executed.
- The driver ran on Node 24.11.0 from the repository checkout at `fb84e4f` for
  the first half and from a temporary worktree `/tmp/oml-wt-01901f9` at `01901f9`
  for the second.

### Pairing

Codes were minted on the server host and exchanged from the tailnet address.
Both are single use, both were spent on 2026-09-16, and both sessions are
revoked; they are printed here because they can no longer be used.

```sh
openmausbot pair --port 8899 --label launcher                 # ZNZ4-VGWT-CKKW
<skill>/scripts/omb.mjs pair --code ZNZ4-VGWT-CKKW --label launcher \
  --url https://wsh.taila20f43.ts.net
openmausbot pair --port 8899 --label launcher-client --client  # SYEH-YGMD-WYYW
OMB_TOKEN_FILE=<scratchpad>/tokens-client.json <skill>/scripts/omb.mjs pair \
  --code SYEH-YGMD-WYYW --label launcher-client --url https://wsh.taila20f43.ts.net
```

The mint prints the code, an expiry five minutes out ("12:34:00 PM (single
use)", 16:34Z), a `https://wsh.taila20f43.ts.net/pair#code=…` link and a QR
block. The exchange answered:

```json
{"ok":true,"verb":"pair","url":"https://wsh.taila20f43.ts.net","tokenFile":"/home/wsh/.config/openmausbot-launcher/tokens.json","replaced":false,"session":{"id":"b269f445-b39a-412a-9468-5225e88f88b2","label":"launcher","scopes":["admin","client"],"expiresAt":1792168140747},"environmentId":"15204312-7b3a-4022-90ec-cac6e5b1637c"}
```

and, with `OMB_TOKEN_FILE` pointed at a second file, session
`ee76fe1c-4fc8-440d-b208-2686e7f0ddcb` with scopes `["client"]`. Both expire
2026-10-16, thirty days out. Both files are `-rw-------`, 94 bytes; the owner's
directory `/home/wsh/.config/openmausbot-launcher` is `drwx------`. No token was
printed, and neither file was read while writing this record.

Replaying the spent owner code from the tailnet is refused by the server, not by
the preflight (exit 3):

```json
{"ok":false,"verb":"pair","error":"pairing code is wrong or has expired; create a new one on the server","status":401,"hint":"mint a new code on the server: openmausbot pair --port 8799 [--client]"}
```

The server log recorded the attempt with the caller's tailnet address: `pairing
refused from 100.88.158.53: pairing code is wrong or has expired; create a new
one on the server`. The hint named 8799, the CLI's default port, while the server
was on 8899 — wording only, fixed later the same day in `0a55d39`.
`openmausbot sessions --port 8899` then listed both devices:

```
id                                    device           scope   last seen  expires
b269f445-b39a-412a-9468-5225e88f88b2  launcher         admin   just now   2026-10-16
ee76fe1c-4fc8-440d-b208-2686e7f0ddcb  launcher-client  client  just now   2026-10-16
```

### The remote verb set

Through `--remote --url https://wsh.taila20f43.ts.net`, with the state file
shared from the fixture:

| Session | Command | Result |
|---|---|---|
| owner | `doctor --remote` | `doctor · remote · 4 checks, 0 failed` |
| owner | `doctor --server --remote` | `doctor · remote · 9 checks, 0 failed · engines grok, claude, codex, hermes` |
| client | `status --remote` | `status · no run · team idle` |
| client | `doctor --server --remote` | `{"ok":false,"verb":"doctor","error":"GET /api/instances -> 403: forbidden: this session lacks the admin scope","status":403}` |
| tokenless | `status --remote` | `{"ok":false,"verb":"status","error":"the server identity could not be verified","hint":"check the URL and server, then import --adopt or re-import"}` |
| tokenless | `doctor --remote` | `doctor · remote · 4 checks, 0 failed` |

Two things to read carefully. A client-scope session is refused only where the
driver touches an admin route — `doctor --server` reads `/api/instances`; the
same session's `status`, `watch` and `interrupt` all worked. And on the day of
the run a tokenless call did **not** say "no token": an unauthenticated
`/api/health` through the tunnel answers 200 without a pid
(`index.ts:7352-7354`), so the driver could not tell a missing credential from a
different server and reported the identity failure above. `0a55d39` made a
missing token say so, naming the origin and the `pair` command to run;
`3b6dce0` stopped the pair hint inferring a port from the endpoint, which is why
the capture above shows `--port 8799` against a server on 8899. A revoked bearer
still reads as an identity failure, for the reason above (see Cleanup): the
token is present, it simply no longer works. The health route's shape is
upstream and unchanged.

### The binding gap (bead `oml-9kp`)

The first remote verb of the run failed, at 16:29:21Z:

```json
{"ok":false,"verb":"status","error":"the server is not the one this team was imported on (identity changed or missing)","hint":"re-import the package or run import --adopt to establish the current server binding"}
```

`session.mjs:75` required `recorded.url === cfg.url`, so a state bound to
`http://127.0.0.1:8899` refused every call naming the tunnel even though the
environment id matched. The obvious workaround made it worse. `import --adopt
--remote` answered `import · Agent Team dev team · lead Sudo · 5 bots, 1
room(s)` and rebound the team to the tunnel URL; `status` then worked for both
tokens, and the local verbs stopped working in three different ways:

```json
{"ok":false,"verb":"task","error":"task needs the project checkout on the server's machine","hint":"remote hosts can status, watch, send, answer, and interrupt"}
{"ok":false,"verb":"task","error":"the data dir does not belong to this server","hint":"pass the matching --data-dir"}
{"ok":false,"verb":"task","error":"the server is not the one this team was imported on (identity changed or missing)","hint":"re-import the package or run import --adopt to establish the current server binding"}
```

— the URL rule from the other side, then the data-dir rule, then the identity
rule again, because the remote adopt had recorded `healthStart: null`. With no
run to open, all seven `watch --remote` calls in that window — four owner, three
client — answered `{"ok":false,"verb":"watch","error":"no open run to
watch","hint":"start one with task, or use status"}` (exit 3), and all five
`interrupt --remote` calls — three owner, two client — answered `no run thread
is recorded for Sudo`. The remote variant's whole
point — a run opened on the dev box and watched from elsewhere — was
unreachable, so remote `watch` and `interrupt` were not exercised at all before
the fix.

The local binding was restored with `import --adopt "Agent Team dev team" --url
http://127.0.0.1:8899 --data-dir <data dir>` (`healthStart 1622400`, adopted
16:32:34.175Z), and the rule was fixed in `01901f9`: the identity is the
environment id, and a URL is one path to it. In remote mode the URL comparison is
dropped as long as the live, recorded and team environment ids agree; local mode
keeps it, where another loopback port is another server. At 16:49:46Z, with the
driver at `01901f9` and the shared state still bound to loopback, the same
command answered `status · no run · team idle` (exit 0) with no re-adopt.

### The remote acknowledgment (bot turn 4)

At 16:30:29Z, with the owner token and the state bound to the tunnel at that
moment, `send --remote` delivered an operator-authored nonce to Sudo's own
thread `4975c501-a14d-4aab-8d16-cccf987585ab`:

```json
{"ok":true,"verb":"send","bot":"Sudo","threadId":"4975c501-a14d-4aab-8d16-cccf987585ab","messageId":"a7e74e9e-639d-480a-9c53-a4473cecc449","steered":false,"queued":false,"queueId":null,"duplicate":false,"sendId":"send-4198055b8ca697c0"}
```

The text was `remote check e2279e7b: reply with just the nonce e2279e7b`
(16:30:29.216Z). Sudo answered `e2279e7b` as
`c10e8f5b-434c-4173-b315-ea7604b079ad` at 16:30:41.071Z, **11.9 s** later, read
back through `status --tail 3 --remote`. The thread's event file records turn
`11b3f329-cafc-44bb-a8b0-2c9f82a1dcfb`, Codex session
`01a0ab0e-3278-7c83-a4c9-36cbcc1e41a4`, model `gpt-5.6-luna`, `ok: true`, usage
18425 in / 30 out / 9984 cached. The server log line for it is `[omb-turn]
bot=0c942a97-34fe-4994-b37c-22c1f3e28d64 text="remote check e2279e7b: reply with
just the nonce e2279e7b" images=0 depth=0 card=false`.

### The run: dispatched locally, watched through the tunnel (bot turn 5)

At 16:49:46Z the driver at `01901f9` opened run `73549ddbbd6f2318` locally
(slug `remote-check`, tag `oml:73549ddb`, lead thread
`139a86f5-c1cd-4098-b2d5-62b7a1d5e138`, dispatched from
`64fa0970b43da65373cc3aff53b3d65ca7adfcf3`) with a brief that deliberately asks
for one word:

```
This is a connectivity check, not a development task: reply with the single word READY and do nothing else; do not delegate and do not create a worktree.

When the task is finished, end your closing report with a line containing only `DONE oml:73549ddb`.
```

The second paragraph is the run marker the driver appends; the first is the
operator's, and "do nothing else" rules it out, so the marker was never going to
appear. Sudo replied `READY`
(`f56fbd0e-5ec8-4a86-9ec3-128fcd1f1453`, 16:49:54.701Z, **7.9 s**), turn
`d23ccd59-b072-4b41-8f4b-f20e13ffa12f`, Codex session
`01a0ab1f-dc2d-7a11-aa54-6ba2f09e9edc`, usage 21125 / 57 / 9984, and stopped.

Every observation after the dispatch was remote; only `report` and `reconcile`
ran locally, at the end. `watch --remote --max-seconds 90 --brief` from the
owner session ended at exit 5:

```
remote-check · ATTENTION · settled without the run marker · Sudo 32s ago: "READY" → read, then omb send "…"
```

which is the right verdict for a brief that never asked for the marker. The
client session's `watch --remote --max-seconds 35 --brief` printed the same line
(`Sudo 1m ago`), also exit 5. Both sessions then interrupted the lead's thread
through the tunnel, the client session included:

```json
{"ok":true,"verb":"interrupt","bot":"Sudo","threadId":"139a86f5-c1cd-4098-b2d5-62b7a1d5e138","interrupted":true}
```

`report --no-tests` closed the run `incomplete` at 16:51:30.802Z after 104 s:
Sudo 1 turn, 7.894 s, `gpt-5.6-luna`, 21125 in / 57 out / 9984 cached; the other
four threads unavailable with no turns; `closing: "READY"`; `unknown:
["tests-pass"]`; failed checks `run-done`, `task-log-changed`, `record-commit`.
`reconcile` answered `reconcile · clean`.

### Cleanup and accounting

Both sessions were revoked from the server host at 16:51:31Z:

```
revoked b269f445-b39a-412a-9468-5225e88f88b2: that device is signed out and its stream is closed
revoked ee76fe1c-4fc8-440d-b208-2686e7f0ddcb: that device is signed out and its stream is closed
no paired devices yet: run `openmausbot pair`
```

The owner token file still held the revoked session, and using it through the
tunnel reads exactly like having no token at all:

```json
{"ok":false,"verb":"status","error":"the server identity could not be verified","hint":"check the URL and server, then import --adopt or re-import"}
```

The server was stopped at 16:51:32Z with `SIGTERM` to pid 76759 — the pid file
held the `setsid` wrapper 76752, so the recorded pid was not the one to signal —
after which ports 8899 and 8900 are closed. `tailscale serve` reports `No serve
config`. The temporary driver worktree `/tmp/oml-wt-01901f9` was removed. The
fixture and the data directory were kept, because the ids above are read from
them. No pushes.

Bot turns: **2**, both Sudo, both `ok: true`, turns 4 and 5 of the v2 pass:

| OMB turn | Thread | Completed | Usage in/out (cached in) |
|---|---|---|---|
| `11b3f329-cafc-44bb-a8b0-2c9f82a1dcfb` | `4975c501-…` (remote send) | 16:30:41.157Z | 18425 / 30 (9984) |
| `d23ccd59-b072-4b41-8f4b-f20e13ffa12f` | `139a86f5-…` (the run) | 16:49:54.719Z | 21125 / 57 (9984) |

No paid host sessions belong to this phase; the pass's Codex review sessions are
counted in the pass total, not here.

### Not exercised

A second machine (the driver ran on the server's own host through the tailnet
address); `answer --remote` and an approval card through the tunnel; `--tunnel`
or any transport other than `tailscale serve`; a remote `watch` over a
delegation chain, since only the lead ran and only for one turn; `pair
--replace` against a live entry; two launchers writing one origin; a session
left to expire. The four non-lead bots were configured and never executed.

## 2026-09-17 — v2 validation: two parallel tasks T14/T15, request kinds, Codex sandbox (34 bot turns, 3 native sessions)

Two tasks ran on one team at the same time — T14 with Nova as implementer and
T15 with a second implementer the lead created during the session — against real
OpenMausBot **0.1.56** on the slugkit clone. The same server answered three of
the request kinds the driver had only ever met in the fake (a routine card, a
learned-skill card and a credential request), two other agent hosts watched the
live run from their own shells while it was open, and a sandboxed Codex was
asked for the long SSE watch that has been carried as unverified since
2026-09-08. Driver at `5217d71`; `3c64657`, the commit on top of it, touches
only `.project-steward/`. The structured record is
[validation/2026-09-17-parallel-t14-t15.json](validation/2026-09-17-parallel-t14-t15.json);
the raw outputs are the session scratchpad's `p7-*` files. Beads `oml-u1j` (long
SSE inside the Codex sandbox) and `oml-fg8`, filed by this run.

**What this establishes.** Two runs can be open on one team and make progress at
once: while Quill's 571 s review turn for T14 ran, T15's lead, planner, plan
reviewer and implementer each took a turn, and the twelve lead turns across the
two run threads never overlapped, the closest pair 75 ms apart. Each run owned its own
worktree, branch, bead and implementer, and every run-scoped verb was given
`--run`. A routine card, a learned-skill card and a credential request were
raised by a real bot and answered through `answer`, each with the server-side
effect verified afterwards and then undone. A lead created a second implementer
on request, `import --adopt` picked it up and `bind` gave it a model without
disturbing the other five. Two hosts (OpenClaw, Hermes Agent) ran
`watch --run t14 --max-seconds 40 --brief` against the live run and read the
approval line back. Inside Codex's `workspace-write` sandbox the driver cannot
reach the server at all, so long SSE there is not merely unverified but
unreachable without escalation.

**What it does not establish.** Neither run passed all nine `--check-042`
checks: both closed `incomplete`, because the lead's own CLI refused its record
commit and the operator made it afterwards. The parallel path is one team on one
machine with one lead, not two leads or two servers. The connector request kind
was still not exercised (Composio is unconfigured on this machine, so the server
cannot create one). No question card appeared, so `answer --message` on a real
card is still untested in this pass. `watch` on dsh, and any host watch longer
than 40 s, remain untested. And it does not establish that a lead handles a
shared reviewer well: T15's marker arrived before its review had started.

### Environment and fixture

- Project: the slugkit clone `/home/wsh/.cache/agent-team/validate-0.4.1/slugkit`
  at `17e2850` on `main` (that commit adds T14 and T15 to `TODO.md` and the beads
  `slg-h3m` and `slg-0sq`), clean, one worktree, no `task/*` branch, 85 tests.
- `doctor` before the server: 6/6. `up --fresh --port 8899 --data-dir
  ~/.cache/agent-team/omb-launcher-data-v2run-20260917T050914` at 05:09:14Z →
  `ports: [8899, 8900]`, supervisor `1643151`, health `1643158`, environment
  `b4962439-c550-4971-805b-25b11863b797`, `askTimeoutMs 600000`, started
  05:09:21.657Z, data dir
  `~/.cache/agent-team/omb-launcher-data-v2run-20260917T050914-20260917T050915-XwqQxP`
  (`up` appends its own timestamp and suffix to the given prefix). `doctor
  --server`: 11/11, engines `grok, claude, codex, hermes` available.
- Unchanged external test input:
  `~/Documents/agent-team-devpack/packages/dev-team/dev-team.openmaus.json`,
  release 0.4.2, SHA-256
  `48e4ac637c7afb6d9e82f0ecf035967411d9c75e61ac8e0603ee7b62a3255949` before the
  import and after `down`. Imported 05:09:22.958Z as section "Agent Team dev
  team": Sudo `3afba314-11aa-4916-9f05-e8a23ed788a8`, Sage
  `95e4a8fa-17a8-4a62-928c-b4c3f293c78a`, Vale
  `49665bf7-16ee-49be-9f0f-8ee253dac38b`, Nova
  `e032a653-97be-498e-95c3-eb3df3fdac71`, Quill
  `b13e5fa0-fad6-46bb-803a-4f88b9ca5ad5`, room Dev Room
  `2f4cd296-7df5-43b5-af54-8f117f515818`.
- `bind --approval auto` with the user's roster: Sudo `codex/gpt-5.6-luna/high`,
  Sage `claude/claude-sonnet-5/high`, Vale `codex/gpt-5.6-terra/high`, Nova
  `claude/claude-opus-5/high`, Quill `grok/grok-4.6/medium`. Quill is skipped
  with "a grok bot has no auto approval level; it stays on ask", so its review
  raised one card per tool call again.
- `facts`: default branch `main`, test `python3 -m unittest discover -s tests -t
  . (run inside the task's worktree)`, setup `none`, merge `auto`, task log
  `.project-steward/PROGRESS.md`, tracker `beads`, plan review `ask`; 1573-character
  block. `reconcile` before the first dispatch: clean, `defaultBranchSource:
  facts`, one worktree at `17e2850`.

### Request kinds on Nova (three verified, connector fake-only)

All three were raised by Nova (Claude engine) on its own DM thread
`441ace76-6100-418f-885a-e9f9a79ddd62`, before any run was open, each costing one
bot turn plus its continuation — four turns on that thread in total.

**Routine.** `send --bot Nova` at 05:10:38Z (message
`27fe03dc-fdd5-4e10-b6bb-aa5208c02817`) asked for a `propose_routine` call; the
card was pending 11 s later: request `c1cacd50-abc9-4f63-bf94-7902f5b2dabf`, tool
`schedule_routine`, title `Schedule "omb-smoke"?`, operation `create`, schedule
`interval` every 60 minutes, `runOn: maus`. `answer --confirm --request
c1cacd50…` returned `outcome: allowed-once`, `routineAction: create`, `resultId:
b74e949f-6f33-4f1b-b09b-2e2e768d7636`, and `GET /api/routines` then listed that
routine, enabled, with `nextRunAt` one interval out. `DELETE
/api/routines/b74e949f…` answered `{"ok":true}`; the data directory's
`routines.json` ends the session with an empty `routines` list.

**Learned skill.** The recorder is off by default, so `PUT /api/config
{"features":{"skillRecorder":true}}` came first and the response read
`features.skillRecorder: true`. `send --bot Nova` at 05:11:45Z asked for a
`skill_manage` call naming `omb-smoke`; the card arrived 11 s later: request
`cd93ec72-249c-4b32-bdd7-9c231d4f730d`, tool `stage_skill`, staged
`f554198e-6148-4400-8b3d-d56a50e1160d`, source `learn:conversation`, sha256
`15077bc5fe418639d1d397f0404a855e4d98d3570bec97e819aa6151a0512fef`, and a
seven-line preview. The orchestrator computed sha256 of that preview text locally
and got the card's own hash, which is what `--reviewed` must equal; `answer
--allow --reviewed 15077bc5… --request cd93ec72…` returned `allowed-once`. `GET
/api/bots/e032a653-97be-498e-95c3-eb3df3fdac71/skills/omb-smoke` then returned
200 with text byte-identical to the preview, and `DELETE` answered
`{"ok":true}`; the `GET` after it answered 404, which is the one step of this
kind not captured to a file. The bot's `skill-state/` ends the session with
`skills.json` `{}` and `staged.json` `{"writes":{}}`.

**Credential.** `send --bot Nova` at 05:12:38Z asked for a `request_credential`
call for `openaiImageApiKey` — an `imageGen` target, chosen because its config
section is on the no-reload list and cannot restart the provider fleet. The
pending request is not a card: kind `secret`, message
`62fcf731-180c-4a8d-b81b-9b8ace1f224f`, target `openaiImageApiKey`, label "OpenAI
API key", description "Used only to generate custom bot avatar images. launcher
smoke check", request key `2fdb4e6f-6ac2-4f91-8065-3e2876ede0e6`. It was answered
with `answer --provide --secret-stdin --request 62fcf731… < <file>`, where the
file is a 0600 one the operator wrote holding a dummy value — never a real key,
and never part of any command: the result read `saveOutcome: "saved"` (the `verified` value is reserved
for the recovery path after a lost answer), `provided: true`, `resumed: true`,
`woken: true`. `PUT /api/config {"imageGen":{"key":""}}` then returned
`imageGen.configured: false`. Leak check afterwards: the dummy value appears in
no `p7-*` output, in no `stdout`/`stderr` of the answer, in the project's
`.omb/state.json`, or in any of the 601 files of the data directory — the
server's own `config.json`, which held it by design while it was configured, now
reads `"imageGen": {"key": ""}`.

**Connector.** Not exercised, as the plan expected: `GET /api/config` reports
`composio: {"configured": false, "mode": "unavailable"}`, and the server refuses
to create a connection request without a project key or broker. That kind stays
fake-only.

### The second implementer

Before any dispatch, because `import --adopt` is refused while a run is open and
the implementer picker only chooses bound bots: `send "Sudo, create a second
implementer."` on the lead's DM thread `286c0a7c-a5f4-4df9-b19a-d3282d70e9c8` at
05:13:50Z (one lead turn). The team had `['Bramble', 'Nova', 'Quill', 'Sage',
'Sudo', 'Vale']`; 31 s later it also carried **Forge**,
`f761bfab-8745-4740-a7b5-f8d83800cf3a`, title Implementer, with no model and no
working folder — a same-section bot the lead made for itself, which is exactly
the kind `task` refuses to claim until it is adopted and bound. `import --adopt "Agent Team dev team"` at 05:14:27.013Z returned
the six titled bots — Bramble, the server's own titleless default bot, is not one
of them — and `bind --model Forge=claude/claude-opus-5/high` gave Forge `cwd`,
that model and `approval auto` while the other five reported `changes: []`. The
roster after the bind is the same five bindings plus `Forge:
claude/claude-opus-5/high (auto)`.

### The two runs

T14 was dispatched with `task --todo T14 --bead slg-h3m --implementer Nova` at
05:14:59.505Z: run `092671dff24f849a`, tag `oml:092671df`, slug `t14`, branch
`task/t14`, lead thread `4f8cc1eb-33df-4815-97c5-33028274b3c9`, `sentSha
17e2850`, and fresh tagged threads for all six bots, Forge included. T15 followed
at 05:28:41.712Z with `--implementer Forge`: run `289bb21f8b7d1dd4`, tag
`oml:289bb21f`, branch `task/t15`, lead thread
`f1cd8141-d945-4fa1-a750-3c2fbbf26b80`, `openRuns: 2`, the same `sentSha`, and —
as the design requires for a second run — only the lead thread fresh, the five
specialist threads recorded as the live ones T14 already owns. The watch that ran
immediately before that dispatch reported `t14 · running 14m · Nova working`.

**T14.** Sage planned, Vale reviewed, Sage revised, Vale rejected the revision
for renaming the operator's branch and worktree, and at 05:23:30.446Z the lead
settled without the marker (`attention`, message
`6de17184-a42e-46b6-bd93-d14a7bd23017`):

> Sage flagged a premise conflict: `TODO.md` does not specify the
> branch/worktree, while the repository convention uses names like
> `task/t14-lowercase` and `.worktrees/t14-lowercase`, not the requested
> `task/t14` and `.worktrees/t14`. Per the workflow, I stopped before
> provisioning. Please confirm whether to proceed with the exact names you
> specified, overriding the repository convention.

The operator answered at 05:25:40.592Z that the brief's names are the run's, that
the launcher owns each run's worktree by that slug now, and to provision and
delegate to Nova. Provisioning then hit a ref lock once — "Provisioning hit a
filesystem restriction while creating `refs/heads/task/t14` (`git` could not lock
the ref); the repository root itself is clean on `main`. I'm retrying the same
authorized worktree creation" — and the retry succeeded. Nova implemented in one
62 s turn (91 tests), Quill reviewed in one 571 s turn and returned "ready, no
findings", the lead merged `--ff-only` as `c7554a5`, ran the suite on `main`,
closed `slg-h3m`, removed the worktree and deleted the branch, and posted the
marker at 05:42:24.694Z — `t14 · DONE after 28m`.

**T15.** Sage planned, Vale reviewed, Forge implemented `abad668` (93 tests), and
at 05:37:35.134Z the lead posted the marker although the review had not started:

> Forge completed T15 in commit `abad668`. The full suite passes: 93 tests.
>
> Quill is currently busy, so the required code review has not started yet. I'm
> waiting for Quill's availability before merging and closing bead `slg-0sq`.
>
> DONE oml:289bb21f

`watch` read that as `t15 · DONE after 10m`, which is what the marker means, with
an unmerged branch behind it. After T14 closed, the operator sent `send --run t15
"Quill is free now: T14 is merged…"` at 05:46:52.915Z (`switched: false` — the
lead was idle, so no task switch was needed). Quill's review then found
`task/t15` missing the merged T14 and asked for a rebase; Forge rebased to
`11ff1e6` (99 tests); Quill's fresh review passed; the lead merged `--ff-only`,
ran the suite, closed `slg-0sq` and removed the worktree and branch. Its closing
message at 05:56:13.866Z lists all of that and then asks for commit
authorization, so the second marker never came and the run settled `attention`.

**Overlap.** The two runs were open together from 05:28:41.712Z until `report
--run t14` closed T14 at 06:00:20Z. The event files make the overlap exact: all
of T15's lead turn `05:31:26.935 → 05:36:03.427`, Vale's `05:32:27.252 →
05:33:08.118` and `05:34:30.389 → 05:34:45.387`, Sage's `05:33:26.494 →
05:33:54.076` and Forge's implementation turn `05:36:03.524 → 05:36:52.429` ran
inside Quill's single T14 review turn, `05:30:13.596 → 05:39:44.506`. The watch
loop saw the same thing from outside: at 05:33:53Z one `--run t14` view reported
`busy ['Quill', 'Sage']`, and at 05:36:29Z the `--run t15` watch reported `t15 ·
running 8m · Forge working` with the `--run t14` watch that followed it reporting
Quill's card and `busy ['Quill']`. The lead never doubled up: the twelve turns on
the two run threads are strictly sequential, the closest pair being T15's
`05:28:41.796 → 05:29:40.611` and T14's `05:29:40.686 → 05:30:13.504`, 75 ms
apart.

### Approval cards

Quill's grok binding stays on `ask`, so every tool call it made raised a card.
The watch loop (`p7-loop.sh`: alternate `watch --run t14` / `--run t15`, allow an
unshared approval card once, stop on anything else) answered **17** of them with
`answer --allow --request <id> --run <slug>`, 14 `shell` and 3 `edit`, all
`allowed-once`: nine on T14 between 05:31:20Z and 05:39:38Z and eight on T15
between 05:47:49Z and 05:53:59Z. The data directory's `decisions.ndjson` holds 19
`card-shown` and 19 `user-approved` records and no `always` in any of them: the
other two are Nova's routine and skill cards above. No question card appeared in
either run. Every one of the 17 arrived on Quill's single thread
`00c50bf4-9d27-4e1c-af12-7c175e5f0701`, which both runs record, and every one was
attributed to exactly one run — `shared: false` in each pending view — so
`--run <slug>` was enough to answer it.

### The two reports

`report --run t14 --md --check-042` and `report --run t15 --md --check-042` ran at
06:00:20Z and 06:00:21Z. Both blocks are quoted verbatim below, with the heading
demoted one level. Both closed `incomplete`: the record commit did not exist yet
(the lead's CLI had refused it, see the incidents) and the root therefore carried
two modified paths.

### 2026-09-17 — T14 (incomplete)

Run 092671dff24f849a, tag oml:092671df, OpenMausBot 0.1.56, lead Sudo (codex/gpt-5.6-luna/high), implementer Nova, branch task/t14, project /home/wsh/.cache/agent-team/validate-0.4.1/slugkit, dispatched 2026-09-17T05:14:59.505Z from 17e2850; final state done; still open: t15.

| Thread | Turns | Bot seconds | Input | Cached | Output |
|---|---|---|---|---|---|
| Sudo | 5 | 790 | 202227 | 193280 | 1119 |
| Forge (+2 shared) | 0 | 0 | 0 | 0 | 0 |
| Quill (+2 shared) | 1 | 571 | 68666 | 0 | 311 |
| Nova | 1 | 62 | 264702 | 222848 | 4428 |
| Vale (+5 shared) | 0 | 0 | 0 | 0 | 0 |
| Sage (+5 shared) | 1 | 88 | 272067 | 227076 | 7359 |

Outcomes: 6 (receipt Sage, echo Sage, receipt Nova, echo Nova, receipt Quill, echo Quill). Commits since dispatch: 2 (11ff1e6 Add --sep, --max-length, --max-words CLI options (T15 / slg-0sq); c7554a5 Add lowercase parameter to slugify (T14 / slg-h3m)).

Record step: task log no, record commit none, bead slg-h3m is closed. Tests: passed in 1 s. Root: 2 modified or untracked path(s).

0.4.2 checks:

- worktree-after-approval: no — Vale's last pre-worktree reply at 2026-09-17T05:22:23.102Z: not approved; git worktree add at 2026-09-17T05:26:10.097Z
- record-time-from-date-u: no — date -u returned 2026-09-17T05:40:53Z; this run's entry heading is "### 2026-09-17T05:55:23Z — Sudo (orchestrator)"
- no-host-listagents: yes — tools used: mcp__agents__list_bots
- bead-closed: yes — bead slg-h3m is closed
- record-commit: no — no attributable docs(team) record commit since dispatch
- merged-ancestor: unknown — the closing report names no merged commit
- task-branch-and-worktree-absent: yes — 0 task branch(es) and 0 worktree(s) with no owner; 0 task branch(es) and 0 worktree(s) in all
- root-clean: no — 2 modified or untracked path(s)
- tests-pass: yes — exit 0 in 1 s

Closing report from Sudo: "T14 completed and merged into `main` as `c7554a5`. - Quill review: ready, no findings. - Tests: 91 passed on `main`. - Bead `slg-h3m`: closed. - Worktree and branch removed. - Progress and Beads records are staged; commit was blocked by repository policy. - Team-room report was attempted but rejected by authorization controls. DONE oml:092671df"

### 2026-09-17 — T15 (incomplete)

Run 289bb21f8b7d1dd4, tag oml:289bb21f, OpenMausBot 0.1.56, lead Sudo (codex/gpt-5.6-luna/high), implementer Forge, branch task/t15, project /home/wsh/.cache/agent-team/validate-0.4.1/slugkit, dispatched 2026-09-17T05:28:41.712Z from 17e2850; final state running.

| Thread | Turns | Bot seconds | Input | Cached | Output |
|---|---|---|---|---|---|
| Sudo | 7 | 622 | 236040 | 197888 | 1559 |
| Forge | 2 | 72 | 386375 | 354558 | 4294 |
| Quill (+1 shared) | 2 | 294 | 160431 | 0 | 506 |
| Nova (+1 shared) | 0 | 0 | 0 | 0 | 0 |
| Vale (+2 shared) | 0 | 0 | 0 | 0 | 0 |
| Sage (+1 shared) | 1 | 106 | 185617 | 174740 | 10340 |

Outcomes: 10 (receipt Sage, echo Sage, receipt Forge, echo Forge, receipt Quill, echo Quill, receipt Forge, echo Forge, receipt Quill, echo Quill). Commits since dispatch: 2 (11ff1e6 Add --sep, --max-length, --max-words CLI options (T15 / slg-0sq); c7554a5 Add lowercase parameter to slugify (T14 / slg-h3m)).

Record step: task log no, record commit none, bead slg-0sq is closed. Tests: passed in 1 s. Root: 2 modified or untracked path(s).

0.4.2 checks:

- worktree-after-approval: unknown — Vale's last pre-worktree reply at 2026-09-17T05:34:45.402Z: verdict unknown; git worktree add at 2026-09-17T05:35:07.617Z
- record-time-from-date-u: yes — date -u returned 2026-09-17T05:55:23Z; this run's entry heading is "### 2026-09-17T05:55:23Z — Sudo (orchestrator)"
- no-host-listagents: yes — tools used: mcp__agents__list_bots
- bead-closed: yes — bead slg-0sq is closed
- record-commit: no — no attributable docs(team) record commit since dispatch
- merged-ancestor: unknown — the closing report names no merged commit
- task-branch-and-worktree-absent: yes — 0 task branch(es) and 0 worktree(s) with no owner; 0 task branch(es) and 0 worktree(s) in all
- root-clean: no — 2 modified or untracked path(s)
- tests-pass: yes — exit 0 in 1 s

Closing report from Sudo: "T15 is merged and validated: - `main` at `11ff1e6` - 99 tests pass - Bead `slg-0sq` closed - Worktree and branch removed - Progress log updated The required local documentation commit was blocked because explicit commit authorization is required. Please approve that commit so I can finish the record, post the team report, and emit the marker."

The checks that did not pass are worth separating, since both runs did merge,
test and close their bead.

- `record-commit` and `root-clean` are `no` in both runs for one reason: the
  lead's own CLI refused the record commit and the operator made it after the
  reports (incident 2 below).
- `merged-ancestor` is `unknown` in both because neither closing report names its
  merge in the form the check parses — T14's says "merged into `main` as
  `c7554a5`", which the report prints two lines further down.
- `record-time-from-date-u` is `no` for T14 because the entry heading the pack
  writes (`### <time> — Sudo (orchestrator)`) names no run and both runs write
  into the same file, so the check compared T14's `date -u` (05:40:53Z) with the
  entry T15 wrote later (05:55:23Z). Both entries exist and each names its own
  task and bead in its body.
- `worktree-after-approval` is `no` for T14 and `unknown` for T15. T14's is
  accurate about what happened: Vale's last pre-worktree reply, at 05:22:23.102Z,
  was a rejection, and the approval that unblocked the 05:26:10.097Z
  `git worktree add` was the operator's message at 05:25:40.592Z, which the check
  does not look for. T15's is the ambiguous-verdict case T13 already recorded:
  Vale replied at 05:34:45.402Z, 22 s before the worktree, and the parser refused
  to read a verdict out of it.

### Incidents

1. **A ref lock during provisioning.** The first `git` write for `task/t14`
   could not lock `refs/heads/task/t14`; the lead retried the same authorized
   worktree creation and it succeeded. No operator action, one lead turn spent.
2. **The lead's own CLI refused its record commit, in both runs.** T14: "Progress
   and Beads records are staged; commit was blocked by repository policy." T15:
   "The required local documentation commit was blocked because explicit commit
   authorization is required." Nothing in the fixture blocks it — the clone's
   hooks are the beads ones (`core.hooksPath=.beads/hooks`) and they pass — but
   its `AGENTS.md` says "Do not commit or push without clear authority from the
   active profile or the current user request", and a Codex lead reads that as a
   refusal it cannot lift by itself. The records stayed staged until the operator
   committed them as `ddd4684` after both reports, which is why both runs closed
   `incomplete` on `record-commit` and `root-clean`.
3. **A team-room report was refused too**: "Team-room report was attempted but
   rejected by authorization controls" (T14's closing message). The chat report
   arrived; the room copy did not.
4. **The marker before the review.** T15's lead posted `DONE oml:289bb21f` while
   Quill was still reviewing T14, with `task/t15` unmerged and the bead open, and
   said so in the same message. `watch` read `DONE` because that is what the
   marker means. The pack's rule should be to wait or queue rather than declare
   done; the operator's recovery was one `send --run t15` once Quill was free.
5. **Report attribution across two runs.** As above: `record-time-from-date-u`
   for T14 matched T15's task-log entry, because the pack's entry heading names
   no run and both runs write into the same file.
6. **Bead `oml-fg8`: a run that would not settle after its sibling closed.**
   After `report --run t14` moved T14 into history at 06:00:20Z, every
   `watch --run t15` returned `state: "timeout"` with `reasons: ["idle for 0 s,
   not yet settled"]` and `quietFor: 0`, `changes: []`, `inflight: false`,
   `busy: []`, `complete: true`, `checkpointed: true` — although every bot was
   idle and the lead's last turn on that thread had completed at 05:56:13.866Z.
   Before T14 closed, the same run had settled cleanly as `attention` four times
   in a row (05:55Z–05:59Z). `report --run t15` left the run open; the operator
   closed it with `task --abandon --run t15` (`history: 4`) at 06:06:56Z and
   reported from history. Four watch outputs, the two identical reports and the
   state file are in the scratchpad's `p7-quiet-defect/`.
7. **`status` has no `--run`.** A `status --run t14 …` call is exit 2 `Unknown
   option '--run'`; `status` lists every open run in `runs[]` and the plan's
   wording assumed otherwise. The run's tail was read from its `runs[]` entry
   instead.

**Follow-up, 2026-09-17 — a later reading of incident 6, not a new run.** No
bot turns were spent; the behaviour was reproduced against the fake server,
which is not evidence. Incident 6 was not a settlement defect: closing T14
unmasked the bots it held, which changed T15's evidence once and correctly
refused its stored `attention`, and the watches that followed asked for 8, 8,
12 and 20 seconds against the 30 s quiet window, so each returned the one
evaluation its own window had made. A watch that ends inside the window now
reports the idle time it observed and the budget the window needs, and `report`
names the watch that settles a run it leaves open (bead `oml-fg8`).

### Host watch proofs during the live run

Both hosts were given one command each, while T14 was open and Quill's cards were
arriving, and both read the driver's own line back.

**OpenClaw.** `openclaw agent --json -m "Run exactly this shell command once and
paste its complete stdout and stderr verbatim, then stop: env OMB_BIN=… OMB_TOKEN=
…/scripts/omb.mjs watch --run t14 --max-seconds 40 --brief --project <clone>"`,
prompt at 05:34:54.213Z: run `614776d8-418a-457e-9b62-55b128102520`, session
`571ddd65-a9c9-40de-b97b-18c0759c93ba`, provider `openai`, model `gpt-5.6-sol`
through the bundled Codex harness, `durationMs 45313`, `toolSummary` 3 calls.
The Codex harness raised one "Codex app-server command approval"
(`plugin:1004b3fb-8860-4e2b-b2f5-eeff658df98d`, pending 05:35:22Z) and the
operator's `approve-loop.sh` resolved it `allow-once` at 05:35:25Z; nothing was
ever answered `allow-always`. The agent's final text is the driver's brief line:

```
t14 · APPROVAL · Quill: "python3 - <<'PY' from slugkit import slugify, unique_slug import unicodedata def pipe(text): text =…" (request d1ff9318-baa6-41d2-bfd3-a8c3d283210b --run t14) → omb answer --allow --request d1ff9318-baa6-41d2-bfd3-a8c3d283210b --run t14
```

**Hermes Agent.** `hermes -z "Run exactly this shell command once and paste its
complete stdout and stderr verbatim, then stop: …/scripts/omb.mjs watch --run t14
--max-seconds 40 --brief --project <clone>"`, with `OMB_BIN` and an empty
`OMB_TOKEN` exported in the launching shell: session `20260917_013542_298e4e`
(`~/.hermes/state.db`), model `gpt-5.6-sol`, 4 messages, 05:35:39Z to 05:36:13Z
(34 s wall, 29.3 s in its own record). Its terminal tool recorded `exit_code: 5`
— the driver's "needs you" exit — and the answer is again the brief line, for the
next card:

```
t14 · APPROVAL · Quill: "git rev-parse --abbrev-ref HEAD; git status --porcelain; python3 -c "import slugkit,inspect; print(…" (request e38e414c-bee2-4b5e-900b-4887b4944455 --run t14) → omb answer --allow --request e38e414c-bee2-4b5e-900b-4887b4944455 --run t14
```

Neither host answered a card: the cards `d1ff9318…` and `e38e414c…` were answered
by the operator's watch loop at 05:35:43Z and 05:36:29Z. These are two paid host
turns, one each.

### The Codex sandbox and long SSE (bead `oml-u1j`)

The plan's first command, `codex exec --sandbox workspace-write
--approve-for-me …`, never ran: Codex refuses the combination at argument
parsing, "the argument '--sandbox <SANDBOX_MODE>' cannot be used with
'--approve-for-me'", which its own `exec --help` explains — `--approve-for-me`
"Route[s] approval requests through automatic review using the workspace-write
sandbox", so it already picks one. The second command, `codex exec
--approve-for-me -C <clone> "Run exactly this shell command
once, wait for it to finish (it may take up to 10 minutes), and paste its
complete stdout and stderr verbatim, then stop: env OMB_BIN=… OMB_TOKEN=
…/scripts/omb.mjs watch --run t15 --max-seconds 570 --project <clone>
--verbose"`, ran at 05:39:08Z on **Codex CLI v0.154.0**, model `gpt-6-astra` (the
config default), `approval: on-request`, `sandbox: workspace-write [workdir,
/tmp, $TMPDIR]`, `reasoning effort: max`, session
`01a0ade0-3bad-7f63-8530-cf3e076a800d`. The driver exited in 47 ms, before any
frame:

```
Error: cannot reach http://127.0.0.1:8899: EPERM
    at unreachable (…/scripts/lib/server.mjs:53:10)
    at serverIdentity (…/scripts/lib/session.mjs:57:41)
…
{"ok":false,"verb":"watch","error":"cannot reach http://127.0.0.1:8899: EPERM","hint":"the shell's sandbox blocks outbound connections: run this command outside the sandbox (escalation), or use --remote against a reachable URL"}
```

The model pasted that output and stopped without requesting an escalation: 31 s,
8,698 tokens, exit 0. So the question "can a sandboxed Codex hold a long SSE
watch?" has an answer, and it is not the one the check was shaped for: inside
`workspace-write` the watch cannot open the connection at all, so long SSE is
reachable only through the host's escalation path (`danger-full-access`) or
`--remote` against a URL the sandbox allows. This closes the "long SSE
unverified" line that `references/hosts.md`, `docs/design.md` and
`.project-steward/RISKS.md` carried from 2026-09-08; it is a documented
restriction, not long-SSE evidence.

### Turn ledger

34 `turn.completed` events across nine threads in
`…-XwqQxP/events/<thread>.ndjson`, counted from the files:

| Thread | Bot | Turns | What it is |
|---|---|---|---|
| `f1cd8141-d945-4fa1-a750-3c2fbbf26b80` | Sudo | 7 | T15's lead thread |
| `8c7b2c69-c85e-4958-8b54-70d509fa76d4` | Sage | 6 | planner, both runs |
| `4f8cc1eb-33df-4815-97c5-33028274b3c9` | Sudo | 5 | T14's lead thread |
| `1af9e409-70ba-47c5-9c80-e4cce193f1e8` | Vale | 5 | plan reviewer, both runs |
| `441ace76-6100-418f-885a-e9f9a79ddd62` | Nova | 4 | the DM thread for the three request kinds |
| `00c50bf4-9d27-4e1c-af12-7c175e5f0701` | Quill | 3 | code reviewer, both runs |
| `e7ae8680-abcd-40fb-bd4f-c71003abde3f` | Forge | 2 | implementer, T15 |
| `d67e5df0-bb24-48c0-90a1-b4553e99d120` | Nova | 1 | implementer, T14 |
| `286c0a7c-a5f4-4df9-b19a-d3282d70e9c8` | Sudo | 1 | the DM that asked for a second implementer |

The two reports allocate 20 of those 34 to a run (T14: Sudo 5, Quill 1, Nova 1,
Sage 1; T15: Sudo 7, Forge 2, Quill 2, Sage 1) and mark the rest of the shared
threads' turns `shared` — Vale's 5 and 4 of Sage's 6 fall outside either run's
open-delegation windows, and the 5 DM turns belong to no run at all. Where the
allocation can be checked against the event files it is exact: Quill's 571 s in
T14's table is the single `05:30:13.596 → 05:39:44.506` turn, and its 294 s in
T15's table is the two later ones (51 s and 242 s).

Pass accounting, against the session's 30-turn allowance and the v2 pass cap of
50:

| Phase | OMB bot turns | Native host sessions |
|---|---|---|
| v2 host verification (2026-09-16) | 3 | OpenClaw 6, Hermes 3, dsh 4 turns |
| v2 remote run (2026-09-16) | 2 | none |
| this phase (2026-09-17) | 34 | 3: OpenClaw 1, Hermes 1, Codex exec 1 |
| **pass total** | **39 of 50** | |

The 34 exceed the session's 30-turn allowance by 4. The overrun is the
orchestrator's decision to finish T15's review after the marker rather than
abandon a merged-but-unreviewed branch: the four turns are Quill's two review
turns, Forge's rebase turn and the lead turn that delegated it.

### Cleanup and end state

`task --abandon --run t15` closed the run that would not settle; `report --run
289bb21f8b7d1dd4 --md --check-042` then reproduced the same block from history.
`reconcile` at 06:07:25Z: clean, `main` at `ddd4684`, one worktree, no task
branch, nothing unowned, `openRuns: []`. `cleanup --kill`: `pattern:
codex-linux-sandbox`, `orphans: []`, `killed: []`. `down` at 06:07:26Z stopped
`supervisorPid 1643151` and `healthPid 1643158` with no orphans, and 8899 and
8900 have no listener afterwards. The package hash is unchanged. The clone ends
at `ddd4684`: `c7554a5` (T14), then `11ff1e6` (T15), then the operator's record
commit, with `git status` empty and `python3 -m unittest discover -s tests -t .`
reporting 99 tests, OK, where the fixture started at 85. The data directory and
the clone were kept, because the ids above are read from them. No pushes.

### Not exercised

The connector request kind (Composio is unconfigured on this machine, so the
server refuses to create a connection request at all); `answer --message` on a
real question card, since none appeared; a provider-key credential
(`xaiApiKey`, `opencodeGoApiKey`) and its busy-fleet refusal against a real
server; `watch --nudge`; a third open run; a host `watch` longer than 40 s, and
any `watch` from dsh; long SSE from a Codex sandbox, which this run showed is
unreachable there without escalation rather than merely untested.

## 2026-09-17 — Codex least-privilege loopback profile (0 bot turns)

This was a host-permission check, not an OpenMausBot run. Codex CLI 0.154.0
loaded the shipped `assets/codex/omb-loopback.config.toml` from a temporary
`CODEX_HOME` as the config profile `omb-loopback` and applied its named
permission profile through `codex sandbox`. The parser/runtime check was:

```sh
CODEX_HOME=<temporary-dir> codex sandbox \
  --profile omb-loopback --permission-profile omb-loopback -- /usr/bin/true
```

It exited 0. A second sandbox command ran a Node probe that imported the
launcher's real `createClient`, listened on an ephemeral `127.0.0.1` port,
called that server, and then attempted `https://example.com`. It exited 0 and
printed:

```json
{"local":true,"publicBlocked":true,"noProxy":"127.0.0.1,localhost"}
```

The same profile therefore permits the local listen/connect pair the launcher
needs while the network proxy continues to block an unlisted public host. The
driver supplied only the two exact proxy-bypass entries. No real
OpenMausBot server was started, no team was imported, and no bot turn was
spent. The earlier default-`workspace-write` negative and real-server
escalation evidence remain valid; this is an additional opt-in path, not a
rewrite of those runs. The probe used a clean temporary `CODEX_HOME`; it did
not test a layered installation that still contains legacy `sandbox_mode` or
`[sandbox_workspace_write]` settings, which override permission profiles.
