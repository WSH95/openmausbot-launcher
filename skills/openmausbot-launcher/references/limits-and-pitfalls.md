# Budgets, dead cards, and tried-and-rejected

Source lines point at the pinned read-only clone
(`~/.cache/agent-team/openmausbot-src`, `server/` unless another directory is
named), OpenMausBot 0.1.56. Operating lessons come from the dev pack
(`~/Documents/agent-team-devpack`) and this repository's `docs/evidence.md`;
they are named where they are used.

## Budgets and caps

| Limit | Value | Source | What it means here |
|---|---|---|---|
| Bot-to-bot chain depth | `MAX_COMMS_DEPTH = 1` | `index.ts:569`, refusal at `7783` (`message chains are limited to one hop`), peer tools mounted only below the depth at `5068` | One hop. A specialist running a delegated or asked turn has no peer tools, so every question and hand-off returns to the lead. |
| `ask_bot` window | `max(5000, OMB_ASK_BOT_TIMEOUT_MS)`, default 4 min | `index.ts:2193`, timeout answer at `7917` | One value for the whole server. Past it the ask converts to a delegation: the answer arrives later as a wake and costs one wake. Start the server with `OMB_ASK_BOT_TIMEOUT_MS=600000`. |
| Wake budget | 3 per 5 min per source thread | `delegations.ts:680-681`, `698-703` | The fourth delegation outcome inside the window is not delivered as a wake. The reply is still in the thread; nothing tells the lead. |
| Wake budget reset | any genuine user turn on that thread | `delegations.ts:707-710` | Writing anything to the lead ("status?") clears the debt. |
| Held wake | while the source is busy | `index.ts:3253-3260` | The wake waits for the source to settle and is invisible to `/api/team-map`. This is why settlement needs a quiet window, not a single snapshot. |
| Empty reply | never wakes | `index.ts:3410-3414` | The wake fires only for `ok && reply.trim()`, or for a failure. A delegate that answers with nothing leaves the lead idle. |
| Notifications off | no `notify` frame at all | `notify.ts:85` | Notifications are wake-ups, never evidence. |
| `wait_delegation` | default 60 s, max 240 s | `drivers/agents-proxy.ts:295,670` | A bot cannot block longer than four minutes on one wait. |
| Queued delegations | `MAX_QUEUED_PER_THREAD = 4` | `delegations.ts:266,285` (`too_many`) | The lead holds at most four pending delegations. |
| Busy retries | `MAX_BUSY_ATTEMPTS = 3` | `delegations.ts:101,506` | Then `Delegation to @X canceled — still busy after 3 retries`. |
| Room posts | 2 unanswered bot posts per 5 min | `room-post-budget.ts:89-90,162-168` | The third is refused and the room is handed to the human. Also 10 posts per bot per minute (`75-76`), a 60 s duplicate window (`78`), and a 5 min breaker after a three-bot ring (`80-83`). |
| Approval cards | 15 min, then denied | `peer-approval.ts:72,162-170` | An unanswered peer-approval card is settled as `deny` by the system, so an unattended run stalls rather than hangs. |
| `create_bot` | instructions ≤ 1000 chars, name ≤ 80, role ≤ 120, 4 bots per turn | `index.ts:8183,8195-8202`; `drivers/agents-proxy.ts:40` | A lead assembling specialists on the fly is tightly bounded. |
| Bot description | ≤ 4000 chars | `shared/bot-profile.ts:5`, `bot-profile.ts:50` | The `Project facts` block lives inside it; `facts` refuses at 4000 before sending. |
| Package limits | tagline ≤ 160, agent description ≤ 4000, playbook instructions ≤ 24000 | `bot-package.ts:47,68,118` | A long tagline is a 400 at import, not a truncation. The rendered playbook mount is also capped at 24000 (`installed-playbooks.ts:4`). |
| Delegation receipts | 100 entries, pruned after 48 h | `delegations.ts:98-99,113-129` | Fleet-wide and lossy: accumulate the ids seen rather than recounting the file. |
| Message page | `limit` 0-200, default 50 | `index.ts:1937-1946` | A long thread needs `before` paging. |
| Event replay | 500 frames, heartbeat 15 s | `index.ts:2014,2016-2020` | A cursor older than the buffer gets `resumed:false`, which means hydrate. |

## Dead question cards

A Claude bot's `AskUserQuestion` card dies with the turn. Answering it
afterwards through `POST /api/threads/:id/respond` returns
`{ok:true, outcome:"unavailable"}` (`contracts.ts:162`); the server marks the
card answered so it stops owning the composer, and the decision reaches
nothing (`index.ts:2116-2126`). The sanctioned answer path is an ordinary
chat message on the bot's thread — the dev pack's rules forbid the tool
outright (`docs/upstream/0005-question-cards-outlive-the-turn.md`).

The driver mirrors that: `answer --message` on the lead's run thread falls
back to `send` when the outcome is `unavailable`, but an unavailable
`--allow` or `--deny` is never turned into chat. It is reported, exit 5, and
the user decides.

## The Stop-hook trap

A Claude bot runs the user's own Claude Code installation, so the user's
plugins and hooks fire inside every bot turn. A Stop hook that injects
feedback — Project Steward's auto-handoff guard in `block` or `remind` mode —
turns the bot's final message into a reply to the hook, and the delegation
returns that instead of the plan or the closing report (dev pack
`.project-steward/RISKS.md`, observed in the 0.4.1 validation T10 on
2026-09-07; the lead re-delegated at the cost of one wake).

Prerequisites for any run on a Project Steward repository:

- `auto_handoff_mode = "off"` in the project's `.project-steward/config.toml`.
- `.project-steward/runtime/` excluded through `.git/info/exclude`.

`omb doctor` checks both whenever the project has a `.project-steward/`
directory. A bare `.project-steward/` directory with no `config.toml` is worse
than none: the hook fires in a degenerate state (dev pack `HANDOFF.md`,
"Tried and rejected").

## Sandboxes

- Tests that spawn processes can fail or hang **only** inside a CLI's
  sandbox. Measured: 21 s under an explicit `timeout 90s`, then 281 s until
  killed (exit 143) with 927 bytes of output where the first run produced
  9,676 — and the bot saw no timeout message, so it reasoned from a short,
  killed run (`docs/upstream/0007-sandboxed-test-run-stalls-in-review-turn.md`).
  The pack's rule is to escalate and report; no driver can prevent it.
- Sandboxed test runs outlive their turn. After a run,
  `pgrep -af codex-linux-sandbox` finds groups still running for hours with a
  cwd inside a worktree that has been deleted (dev pack `HANDOFF.md`,
  "Warnings"). `omb cleanup --kill` is exactly that scan, restricted to
  processes whose cwd is under `<project>/.worktrees/` and gone.
- Codex's `workspace-write` sandbox denies listening sockets, so `omb up`
  there dies in about 236 ms with `listen EPERM: operation not permitted
  127.0.0.1:<port>` in `serve.log` (this repository's `docs/evidence.md`,
  2026-09-08). Run `up` outside the sandbox with an approved escalation, or
  start the server elsewhere and let `up` report `attached`.
- The record step (`bd`, `git commit`) runs inside the lead's CLI sandbox. A
  failure there leaves the root dirty, and the next task's `reconcile --check`
  is what reports it.

## Tried and rejected

| Tried | Why it was dropped |
|---|---|
| Driving the lead from a room | A task sent in a room is never picked up after the first delegation: no delegation outcome wakes a room source, so the closing report never comes (dev pack Decision 0004, T1 2026-09-05). Tasks go to the lead's own thread; the lead mirrors into the room. |
| `PATCH`-ing a bot's playbooks | There is no `playbooks` field on `PATCH /api/bots/:id` and no editor in the UI (dev pack `DECISIONS.md:70-72`). |
| Treating installed playbooks as editable | They are import-only. A playbook fix reaches running bots only through a fresh import; the interim path is an Instructions addendum inside the 4000-character description (dev pack `RISKS.md`). |
| `delegate_bot` by name | Refused with "no such bot"; three such calls in M7 each needed a `list_bots` round trip to recover the id (dev pack `EVIDENCE.md:322,340,354`). Ids, never names. |
| `/api/decisions` as a pending-work queue | It is a log of resolved requests (`index.ts:11398-11405`); its length says nothing about what is waiting (dev pack `HANDOFF.md`). |
| `scripts/control-omb.ts` as the operator surface | Its `wait` is capped at 120 s and it ships only in the upstream source tree, not in the npm package, so it cannot be a skill's dependency. |
| Project-mode import for a full package | `mode=project&cwd=` opens a room only for a legacy `openmaus.team` manifest; the `!pkg && importMode === "project"` branch skips full packages (`index.ts:9302`; dev pack `EVIDENCE.md:70`). Per-bot and per-room PATCH is the binding path. |
| Committing on the default branch mid-task | It forces a rebase round on every open task branch; commit on the task branch instead (dev pack `HANDOFF.md`). |
| A seed task-log entry stamped with a future time | A 23:30Z entry written at 22:40Z inverted the file's order and led the lead to append at the bottom with an invented time. Seed entries carry the real time. |
| Answering a question card through `/respond` | Stale once the turn ends; see "Dead question cards" above. |
| `git switch main` inside a worktree | `fatal: 'main' is already used by worktree at …`. Branch from the tip instead: `git switch -c task/<slug> main` (dev pack `EVIDENCE.md:137,150`). |
| Forced worktree removal | `git worktree remove` refuses a worktree holding untracked, unignored files (`use --force to delete it`, exit 128). The rule is never `--force` or `-D`: report what remains and let the user remove it (dev pack `EVIDENCE.md:438`, `RISKS.md`). |

## Driver rules restated

- **Receipts are informational.** A 202 `steered` or `queued` says the server
  took the text, not that the lead acted on it. No terminal state is ever
  derived from one.
- **Done is the run marker line.** The run ends when the lead's own last text
  carries `DONE oml:<runId8>` on a line of its own. Everything else that goes
  quiet is `attention`, and still has to be read.
- **Settled needs 30 s of quiet inside one invocation.** Quiet evidence never
  crosses invocations, and it resets on `resumed:false`, on an incomplete
  snapshot, and on any progress.
- **One run per team.** A second dispatch is refused; finish with `report`,
  or close the run with `task --abandon`. There is no `--force`.
- **Never retarget a stale thread.** A 409 `the bot switched tasks…` is
  reported with the bot's active thread in the hint; the driver does not
  resend somewhere else on its own.
- **Tokens never in argv.** They come from `OMB_TOKEN` or the 0600 file at
  `~/.config/openmausbot-launcher/tokens.json`, so nothing lands in a process
  list or a transcript.
