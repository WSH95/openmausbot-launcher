# The dev-team pack conventions

`SKILL.md` is the generic operator core and works with any team package. This file carries the
conventions of one package: the **dev-team** pack, release 0.4.2, from `~/Documents/agent-team-devpack`.

## What the pack is

Package file: `~/Documents/agent-team-devpack/packages/dev-team/dev-team.openmaus.json`
(`format: openmaus.package`, `package.name` "Agent Team dev team", `package.release` "0.4.2", `chiefOfStaff: sudo`).

| Key | Name | Title | Role |
|---|---|---|---|
| sudo | Sudo | Team Lead | the user's single point of contact: runs the loop, merges, records, reports |
| sage | Sage | Planner | read-only plan; checks the task's claims about the repository first |
| vale | Vale | Plan Reviewer | verdict: approve, revise, human decision |
| nova | Nova | Implementer | works only in the task's worktree; commits, rebases, retests, reports |
| quill | Quill | Code Reviewer | read-only verdict: ready, needs work, needs rebase, discard |

One room, **Dev Room** (all five members, default responder Sudo), where the lead posts one
closing report per task. Tasks go to the lead's own chat, never to the room: a finished
delegation wakes a bot only in its own conversation, and the room accepts two unanswered bot
posts per five minutes. Two playbooks: **Worktree workflow** (the loop below) and **New
specialist**; installed playbooks cannot be edited after import
(`~/Documents/agent-team-devpack/docs/setup-guide.md`, section 6), so a rule change goes into
a bot's Instructions or a new release. Readable copy of the loop:
`~/Documents/agent-team-devpack/skills/worktree-workflow/SKILL.md`.

## The lead's loop

From `worktree-workflow/SKILL.md:9-19`, one line per step:

1. Read the request; root check (`git branch --show-current` is the default branch, `git status --porcelain --untracked-files=normal` is empty); pick a slug no branch, worktree, or path uses.
2. Plan: `delegate_bot` to the Planner with the task text and acceptance criteria verbatim, the test command, the default branch, "plan only, read-only, check the claims first"; end the turn.
3. Plan review: the Plan Reviewer by `ask_bot` under `Plan review: ask` (inside the turn) or `delegate_bot` under `delegate`; "revise" goes back to the Planner, at most two rounds.
4. Worktree, only after the plan is approved: from the root, `git worktree add -b task/<slug> .worktrees/<slug> <default>`, then the setup command inside it.
5. Implement: `delegate_bot` to an Implementer with no open task — the approved plan verbatim, the branch, the worktree path, the test command; it commits when the tests pass, rebases, retests, reports.
6. Code review: `delegate_bot` to the Code Reviewer — read-only, ancestor check, diff against the plan, one verdict.
7. Merge. `auto`: root check, `git merge --ff-only task/<slug>`, then the test command on the default branch. `ask`: report and wait for the user's merge.
8. Cleanup gate, both policies: `git merge-base --is-ancestor` succeeds, the root check passes, the tests passed there; then `git worktree remove`, then `git branch -d`, never forced; stop at the first failure and say what remains.
9. Record, both policies: a task log entry at the top headed by `date -u +%FT%TZ` and the lead's name; `bd close <id> --reason "merged as <sha>"` when the tracker is beads; one commit `docs(team): <task> merged as <short sha>` with only those files.
10. Closing report in the lead's chat and once in the room with `post_to_room`, then the next task. (Step 11: when the user reports a merge, the lead runs steps 8 and 9 for that branch and sends every other open branch back for a rebase, a retest, and a fresh review.)

## Roster and `bind`

Advice from the operator guide (`setup-guide.md`, section 3): both reviewers on the strongest
model available at high effort, the lead on a model that verifies a reviewer's claims against
the files before acting. Basis: on 2026-09-07 Codex gpt-6-astra at xhigh reproduced two real
P1 bugs and refuted a design's own lock recipe where Sonnet 5 reviewers had found nothing on
four earlier tasks, at about six times the wall time (`EVIDENCE.md`, M7 T5). `--reviewers`
applies to every team bot whose title or name matches `/review/i` (`scripts/lib/team.mjs:21`)
— Vale and Quill; `--default` covers the rest:

```
omb bind --default claude/claude-fable-5-1/max --reviewers codex/gpt-6-astra/xhigh --approval auto
```

- Per-bot override: `--model "Nova=codex/gpt-6-astra/xhigh"` (id, key, name, or title).
- A Grok bot has no auto approval level: `bind` leaves it on `ask` and reports it under `skipped` (`scripts/lib/verbs/team.mjs:141`); its cards go to `omb answer --allow --request <id>`.
- A model change is refused with 409 while a bot is busy; `bind` runs only on an idle team.

**Validation roster** — the user's instruction for the dev pack's own tests, not general advice
(`docs/design.md`, "Real run"; `EVIDENCE.md`, pack 0.4.1 validation): Sonnet 5 for the Claude
bots at the server's default effort, gpt-5.6-luna at high for both Codex reviewers.

```
omb bind --default claude/claude-sonnet-5 --reviewers codex/gpt-5.6-luna/high --approval auto
```

## Project facts

The lead's description ends with a facts block; the pack ships it as `Project facts (edit me):
default branch: main. Test command: <fill in>. …`. `facts` replaces everything from the marker
`Project facts` to the end of the description (`scripts/lib/team.mjs:54`), so "(edit me)"
disappears on the first call.

| Field (label in the block) | Flag | Values | What it controls |
|---|---|---|---|
| default branch | `--default-branch` | branch name; inferred from git | worktree base, rebase, merge, root check, ancestor check |
| Test command | `--test` | a command; `<fill in>` until set | run by the implementer in the worktree, by the code reviewer, and by the lead on the default branch after a merge |
| Setup command (run once in each new worktree) | `--setup` | a command or `none` | the lead runs it in each new worktree before the implementation |
| Merge policy | `--merge` | `auto` \| `ask` | `auto`: root check, ff-only merge, tests. `ask`: report and wait |
| Task log | `--task-log` | a repo-relative path or `none` | where the record entry goes; `none` skips the record step and the report says so |
| Task tracker | `--tracker` | `beads` \| `none` | `beads`: `bd close <id>` when the brief names a bead |
| Plan review | `--plan-review` | `ask` \| `delegate` | `ask`: review inside the lead's turn. `delegate`: each review and revision is a delegation, one wake each |

Rendered exactly like this (`scripts/lib/team.mjs:50`):

```
Project facts: default branch: main. Test command: <t>. Setup command (run once in each new worktree): <s>. Merge policy: auto. Task log: <l>. Task tracker: <tr>. Plan review: ask.
```

The whole description must stay under 4,000 characters; `facts` refuses at 4,000 and says how
many to cut (`scripts/lib/verbs/team.mjs:12`, `:192`). The pack's lead description is 3,865
characters, so about 130 remain for values (0.4.1's patched description was 3,922).

```
omb facts --default-branch main --test "python3 -m unittest discover -s tests -t ." --setup none --merge auto --task-log .project-steward/PROGRESS.md --tracker beads --plan-review ask
```

Use `--plan-review delegate` when the reviewers run at xhigh or max and the server's ask
window (`OMB_ASK_BOT_TIMEOUT_MS`, four minutes by default) cannot be raised: an `ask_bot`
past the window turns into a delegation anyway, and the switch makes that explicit.

## The brief

`omb task --todo T10 --bead slg-a9x` composes (`scripts/lib/verbs/run.mjs:60-67`):

> Sudo, do T10 from TODO.md in this project. Test command: python3 -m unittest discover -s tests -t . (run inside the task's worktree). Setup command: none. Bead: slg-a9x.
>
> When the task is finished, end your closing report with a line containing only
> `DONE oml:1a2b3c4d`.

- The test sentence appears when Project facts carry a test command other than `<fill in>`; the setup sentence when a setup command is recorded; the bead sentence with `--bead`.
- A free-form brief (`omb task "Sudo, …"`) is used as written; `Bead: <id>.` is appended when `--bead` is given and the text has none. The marker paragraph is appended either way.
- The marker is run-specific and anchored (`^DONE oml:<8 hex>$`, multiline, `scripts/lib/snapshot.mjs:12-13`), so an earlier run's report cannot match it.
- Title: `--title`, else the `--todo` value, else the brief's first 60 characters. The driver opens one fresh task thread `<title> [oml:<8 hex>]` on every team bot before sending; a fresh thread per task is also the pack's guidance — it bounds each bot's context, at the cost of the lead re-reading the design each time (about three minutes).
- The brief always goes to the lead's own run thread, never the room.

## Expected shape of a run

Outcomes on the lead's thread, in order: the plan, the plan review when `Plan review: delegate`
(under `ask` it runs inside the lead's turn and produces no outcome), the implementation, the
code review. A premise correction adds one outcome and one plain-text exchange with the user
before the plan.

| Setting | Wall time per task | Source |
|---|---|---|
| sample repositories, default efforts | 10 to 20 min | `setup-guide.md`, section 4 |
| slugkit clone, Sonnet 5 + gpt-5.6-luna/high (0.4.1 validation) | T10 10 min 1 s (4 receipts, 4 wakes); T11 18 min 29 s (5 receipts, 5 wakes, one premise correction, 71 s waiting for the user) | `EVIDENCE.md`, pack 0.4.1 validation |
| agent-team-cli, a real repository, Sonnet 5 / Codex mix | T1 20, T2 31, T3 25, T4 49 min | `EVIDENCE.md` M7; `docs/retrospective-m7.md` |
| the same, reviewers at Codex xhigh | T5 2 h 37 min, 12 receipts, 2 user decisions | the same |

The closing report contains (playbook step 10): the task, the plan summary with files, the
branch, the commit, the test result and where the suite ran, the verdicts, the merge result,
the cleanup result (worktree removed and branch deleted, or what was left and why), the record
commit or that the task log is `none`, and what happens next.

`done` means the lead emitted this run's marker: the run closed, not that it passed. Read the
closing report, then run `omb reconcile` and `omb report --md`, which reruns the tests itself.

## When the lead stops early (`attention`)

`attention` (exit 5) means the lead settled without the marker. The pack stops in these
cases (`worktree-workflow/SKILL.md`; `setup-guide.md`, section 4):

| Stop | What the lead does | How to answer |
|---|---|---|
| the Planner reports "Premise fails" | reports the claim and what the planner found, usually with options | send the corrected task text |
| a human decision confirmed by the plan reviewer (a plan's own flag goes to the reviewer first and is not by itself a stop) | asks in plain text | send the decision: "no new dependency, use a table" |
| two revision rounds without approve or ready | reports both texts | narrow the scope, authorize one more round, or "discard T6" |
| an implementer reports BLOCKED for a reason it cannot settle from the code | reports and leaves the worktree in place | send the fix, or drop the task |
| a fast-forward refused after one rebase round | reports | decide; the lead never forces or rewrites |
| the tests fail on the default branch after a merge | reports, never reverts | tell it what to do next |
| a dirty root at the merge | shows the `git status` output | "merge it anyway" to continue |
| `Merge policy: ask` with a ready branch | reports and waits | merge from the root, then "T5 merged, main is now <sha>" |

Answers go to the lead's own run thread: `omb send "<text>"`, in the user's own words. The pack
forbids the question tool (its card dies with the turn), so a dev-team stop is plain text; an
approval card appears only from a bot without an auto approval level.

Wake budget: the server wakes the lead at most three times in five minutes, and a fourth
outcome in that window is dropped, not delayed. Reviews under `ask` run inside the turn and do
not count; under `delegate` a plan with two revision rounds costs four wakes. If a teammate
finished and the lead is silent, `omb send "status?"` wakes it (`watch --nudge` does this once
per run).

## The record step and `report --check-042`

Without `--check-042`, `report` already verifies the record
(`scripts/lib/verbs/run.mjs:330-333`): a commit since dispatch touched the task log; one
commit's subject matches `docs(team): … merged as <sha>` and its files are all the task
log or under `.beads/`; `bd show <id> --json` says closed.

`--check-042` adds nine checks (`scripts/lib/report.mjs:55-77`, `scripts/lib/verbs/run.mjs:341-350`).
The first three are the 0.4.2 wording release: each fixes a deviation seen in the 0.4.1
validation (`EVIDENCE.md`, "Deviations and findings").

| Check | What it proves |
|---|---|
| `worktree-after-approval` | `git worktree add` in the lead's native log comes after the plan reviewer's verdict — 0.4.1's lead created T10's worktree at step 1, before the plan |
| `record-time-from-date-u` | the task log's first heading carries the timestamp the lead's last `date -u` returned — 0.4.1's T11 entry went to the bottom of the file with an invented time |
| `no-host-listagents` | no host `ListAgents` among the lead's tool calls, and `list_bots` present — 0.4.1's lead called `ListAgents` first, nine times across two tasks |
| `bead-closed` | the brief's bead is closed |
| `record-commit` | the `docs(team)` commit exists and touched only the task log and `.beads` |
| `merged-ancestor` | the sha the closing report names as merged is an ancestor of the default branch (the task branch is gone by then, so the check uses the commit id) |
| `task-branch-and-worktree-absent` | the cleanup gate ran: no `task/*` branch, exactly one worktree |
| `root-clean` | the root is on the default branch with nothing modified or untracked |
| `tests-pass` | the Project facts test command passes when `report` runs it itself |

Result: `passed` (state `done`, record ok, tests green, root clean, no check `false`),
`incomplete`, or `failed`. Either way `report` closes the run into the state's history.

Unverified: 0.4.2 is a wording release not yet exercised live — the 0.4.1 entry ends "not
validated live, the next run does", and the launcher's own validation run (`docs/design.md`,
"Real run = the 0.4.2 pack validation", bead `atw-yyd.9`) is that run. The tool name the third
check expects in a Claude lead's native log (`mcp__agents__list_bots`) is unconfirmed against a
real log.

## Cleanup

- **A stopped task keeps its worktree on purpose.** After a discard, two failed rounds, a BLOCKED implementer, or a failing default branch, `.worktrees/<slug>` and `task/<slug>` stay so someone can look, and the report says so; `reconcile --check` then fails and the next `task` refuses to dispatch.
- **Removing them is the operator's explicit act**: `omb reconcile --remove <slug>` runs `git worktree remove .worktrees/<slug>` then `git branch -D task/<slug>`, for the named slugs only (`scripts/lib/git.mjs:69-75`). Ask the user first; the leftover exists to be inspected. `git worktree remove` refuses a worktree holding unignored untracked files, and the lead stops there and reports what remains.
- **Orphaned sandbox processes.** A CLI's sandbox process group can outlive its turn. `omb cleanup` lists processes matching `codex-linux-sandbox` (the default `--pattern`) whose cwd is under `<project>/.worktrees/` and deleted; `--kill` terminates them, never a pid recorded as the owned server. Five such groups from the M7 run were alive five to six hours later and were killed by hand.
