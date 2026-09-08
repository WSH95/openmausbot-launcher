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
