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

## 2026-09-08 — first real run: T12 on the slugkit clone through the dev-team pack 0.4.2 (design step 13)

OpenMausBot 0.1.56 started by `up --fresh --port 8899 --data-dir ~/.cache/agent-team/omb-launcher-data` (data dir `omb-launcher-data-20260907-2300`, environment `3c244ba3-4319-449a-8179-017f3d6449f2`, supervisor 367683, server 367690). Team: `import ~/Documents/agent-team-devpack/packages/dev-team/dev-team.openmaus.json` (release 0.4.2, section "Agent Team dev team", Sudo 1aa41a6d…, Sage 38710dd0…, Vale f20e06c4…, Nova a36e4c2f…, Quill 8eeeeea1…). Roster per the user's instruction for this project's tests: `bind --default claude/claude-sonnet-5 --reviewers codex/gpt-5.6-luna/high` (Sudo, Sage, Nova on Sonnet 5 at the server's default effort; Vale and Quill on gpt-5.6-luna at high; all on approval auto). Facts: test `python3 -m unittest discover -s tests -t . (run inside the task's worktree)`, setup none, merge auto, task log `.project-steward/PROGRESS.md`, tracker beads, plan review ask. Project: `~/.cache/agent-team/validate-0.4.1/slugkit` at 2f6d9d5 (72 tests) with a new TODO item T12 (separator validation) and bead `slg-ceo`.

Dispatch: `task --todo T12 --bead slg-ceo` at 03:00:58Z (run 61e709700923670a, tag oml:61e70970, five fresh task threads, lead thread eb9e6184…). Watched with three `watch --max-seconds 540 --brief` calls from this Claude Code session; the third returned `done` at 03:24:13Z (23 min 15 s wall clock, 1,483 s by the driver's count). The lead's closing report ended with the run marker line. The `report --check-042` below was produced after two driver fixes the run exposed: the test command was run with its parenthetical note attached (exit 2), and the merged commit was sought only as "merged as" in the closing text; both fixed the same day (`bareCommand`, `mergedShaFrom`, `report --run last`). Cleanup after the run found no orphaned sandbox processes; `down` stopped both pids.

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
