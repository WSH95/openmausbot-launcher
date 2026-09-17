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
| Open proposal cards | 8 per thread, per kind | `index.ts:6303-6339` | The ninth is refused with 429 `confirm or cancel an existing learned-skill card first` (or `… routine proposal first`). A bot that keeps proposing while nobody answers stops being able to propose at all: settle them with `answer`. |
| Staged skills | `MAX_STAGED_SKILLS = 20` per bot | `skills.ts:68,1240` | Then `confirm or reject an existing staged skill first (max 20)`. A denied card releases its stage. |
| Message page | `limit` default 50, clamped to 200; a non-integer or negative value is a 400 | `index.ts:1937-1946,8646` | A long thread needs `before` paging; asking for more than 200 silently returns 200. |
| Event replay | 500 frames, heartbeat 15 s | `index.ts:2014,2016-2020` | A cursor older than the buffer gets `resumed:false`, which means hydrate. |

## Dead question cards

A Claude bot's `AskUserQuestion` card dies with the turn. Answering it
afterwards through `POST /api/threads/:id/respond` returns
`{ok:true, outcome:"unavailable"}` (`contracts.ts:162`); the server marks the
card answered so it stops owning the composer, and the decision reaches
nothing (`index.ts:2116-2126`). The sanctioned answer path is an ordinary
chat message on the bot's thread — the dev pack's rules forbid the tool
outright (dev pack
`~/Documents/agent-team-devpack/docs/upstream/0005-question-cards-outlive-the-turn.md`).

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
  killed run (dev pack
  `~/Documents/agent-team-devpack/docs/upstream/0007-sandboxed-test-run-stalls-in-review-turn.md`).
  The pack's rule is to escalate and report; no driver can prevent it.
- Sandboxed test runs outlive their turn. After a run,
  `pgrep -af codex-linux-sandbox` finds groups still running for hours with a
  cwd inside a worktree that has been deleted (dev pack `HANDOFF.md`,
  "Warnings"). `omb cleanup --kill` is exactly that scan, restricted to
  processes whose cwd is under `<project>/.worktrees/` and gone.
- Codex's `workspace-write` sandbox denies listening sockets, so `omb up`
  there dies in about 236 ms with `listen EPERM: operation not permitted
  127.0.0.1:<port>` in `serve.log` — twice, the webhook receiver on `port + 1`
  first and the API port second, followed by a 14-line Node stack ending in
  `code: 'EPERM'`, `syscall: 'listen'`, `port: <port>` (this repository's
  `docs/evidence.md`, 2026-09-08; review fixture
  `codex-ww-data-20260908T110446-DLKtHf/serve.log`, 25 lines). `up` scans the
  whole log for that signature and names the first matching line in its hint;
  the 12-line `log` field is display only. Run `up` outside the sandbox with an
  approved escalation, or start the server elsewhere and let `up` report
  `attached`. The same sandbox can block outbound loopback connections; the
  driver then exits 1 `cannot reach http://127.0.0.1:<port>: EPERM` with the
  escalation hint, never exit 3 "identity could not be verified". `doctor
  --server` names the same cause in its `health` check and carries that hint,
  so a blocked socket reads as the sandbox rather than as a dead server; only
  `ECONNREFUSED` keeps `nothing answers at <url> (ECONNREFUSED)`. Loopback
  HTTP is blocked there too: `status` exits 1 with a network error naming the
  URL (M1 review, tier 2); an exit 1 from a sandboxed Codex is the sandbox,
  not the server.
- The record step (`bd`, `git commit`) runs inside the lead's CLI sandbox. A
  failure there leaves the root dirty, and the next task's `reconcile`
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

### Two ports per server

OpenMausBot takes `--port` for the API and `port + 1` for its webhook
receiver (`index.ts:319-320`, `cli.ts:438`). `up --port N` refuses (exit 3)
when `N + 1` is taken, and a live verb pointed at a receiver port reports
`<url> is an OpenMausBot webhook receiver; its API is on port N-1` instead of
a bare 404. Space servers two ports apart: 8893 and 8895, never 8893 and 8894.

### State lock upgrades and recovery

Writers use Node 24's built-in SQLite support and a persistent
`.omb/lock.sqlite` mutex; `state.json` remains the authoritative state.
The SQLite file is private (0600) and never removed or rotated by the driver.
A live writer is never displaced based on age. SQLite releases its lock
when that process exits; a hung writer must be stopped before retrying.
Never unlink the database while another command could hold it: that would
allow separate databases to admit concurrent writers.

`down` refuses (exit 3 `refusing to stop: …`) whenever the recorded server no
longer verifies — after an `up --fresh` elsewhere, a data-dir swap, or any
restart that changed the environment id (`verifyOwned`, `lib/server.mjs`).
While the recorded pids are alive the hint names them: check them with
`ps -o pid,lstart,args -p <supervisor>,<server>`, then `kill <supervisor>`
yourself (it stops its child, `cli.ts:462-473`); the launcher never signals a
process it cannot prove it started. Once both are gone, `up` records the next
server.

An existing legacy `.omb/lock` file or directory causes a refusal. To
upgrade, stop all launcher commands and scheduled automations, update every
installed launcher copy, then remove only that legacy path. Removing it
while an older launcher can still run defeats serialization. Permission or
database-corruption errors are reported; they are not treated as contention
and do not trigger automatic removal. Node may print an experimental SQLite
warning on stderr; JSON stays on stdout.

### Bounded observation and report evidence

`watch` shares one monotonic deadline across identity checks, SSE setup,
message paging, polling, and reconnects. Each HTTP request is capped at
15 seconds or the remaining budget. A final checkpoint waits up to one more
second; `checkpointed:false` means its observation was not saved (for
example, another writer held the lock or the run was replaced). Call again;
the next invocation reloads state and establishes its own quiet window.
Read-only commands and dry runs do not create the lock database.

Every run thread is paged back through dispatch, including idle specialists.
A deadline or failed page makes the snapshot incomplete. Known outcomes
survive receipt pruning; uncertain ordering never proves completion. Status
can carry a prior verdict only when complete evidence is unchanged.

`report --run last --check-042 --dry-run` works offline from archived context
and local evidence. It sends no HTTP requests, executes no tests, and writes
no state. Previously passing tests stay in the original report; they do not
turn this skipped test check into a new pass. Required unknown evidence
produces `incomplete`; inspect `unknown` and `failedChecks`. Without dry-run,
historical reports append a reanalysis instead of replacing the original.

### Observation rules

- **Receipts are informational.** A 202 `steered` or `queued` says the server
  took the text, not that the lead acted on it. No terminal state is ever
  derived from one.
- **Done is the run marker line.** The run ends when the lead's own last text
  carries `DONE oml:<runId8>` on a line of its own. Everything else that goes
  quiet is `attention`, and still has to be read.
- **Settled needs 30 s of quiet inside one invocation.** Quiet evidence never
  crosses invocations, and it resets on `resumed:false`, on an incomplete
  snapshot, and on any progress.
- **Several runs, one lead.** A second dispatch is allowed while the first
  run is open, but the lead still runs one turn at a time
  (`index.ts:3775-3777`): two runs mean two open tasks whose implementers
  work at once, never two lead turns. Each run owns its own worktree, branch
  and implementer, and every run-scoped verb takes `--run <ref>` rather than
  guessing. Finish each with `report --run <ref>`, or close it with
  `task --abandon --run <ref>`. There is no `--force`.
- **A busy lead belongs to every open run** unless the runtime log names the
  thread its turn is on, and a pending request nobody can place is `shared`
  and needs `--request`. The driver would rather keep both runs waiting than
  hand one of them the other's work.
- **Never retarget a stale thread.** A 409 `the bot switched tasks…` is
  reported with the bot's active thread in the hint; the driver does not
  resend somewhere else on its own. The one exception is not a retarget: when
  the lead's active task is **another open run's**, `send` makes this run's
  own task active again (`POST /api/bots/:id/tasks/:threadId`) and posts the
  same text to the same thread it always meant. It does that once; a second
  refusal is reported.
- **An interrupt reaches only the active task.** A turn pinned to another
  thread — a delegation wake drained after the bot switched tasks
  (`index.ts:3225-3233`) — answers 409 `the bot switched tasks before it
  could be interrupted` (`index.ts:11077-11084`). There is no way to stop it
  from here: wait for the lead to go idle.
- **Tokens never in argv.** They come from `OMB_TOKEN` or the 0600 file at
  `~/.config/openmausbot-launcher/tokens.json`, so nothing lands in a process
  list or a transcript. A credential answered with `answer --provide` is the
  same, and stricter: there is no flag that takes a value, and **the operator
  must never compose a command that contains one** — an agent's own tool call
  is transcribed. Either the user writes the value to a file only they can
  read and the command redirects from that path
  (`--secret-stdin --request <id> < that-file`), or the user exports
  `OMB_SECRET` in their own shell with `read -rs OMB_SECRET` and runs the
  command there.
- **`answer` on a learned-skill card denies it unless it allows it.** Every
  behaviour other than `allow` rejects the staged write
  (`index.ts:6470-6504`), so `--message` on one of those cards would throw
  the skill away while reading like a remark. The driver refuses it (exit 2).
  An allow needs `--reviewed <sha256>` equal to the card's own hash, which is
  the sha256 of the preview text (`skills.ts:1250`) — read that preview to
  the user first; it is the whole skill.
- **Connected apps need Composio.** A bot raises a connection request only
  through the Composio MCP bridge, and the server refuses to create one with
  409 `connected apps are not enabled for this bot` when no project key and
  no broker are configured (`composio.ts:254-262`, `index.ts:8361-8363`).
  Without that, `answer --connect` has nothing to act on. Authorizing is
  admin scope; reading a status, resuming and dismissing are client scope
  (`request-auth.ts:219-220`), so a paired phone can finish a connection it
  cannot start.
- **Connection status reads can wake the bot.** Resume reads every sibling
  from the request's thread, including settled cards omitted from a run's
  pending view (`index.ts:6618-6622`). A required or failed sibling needs
  authorization first; a dismissed sibling prevents the whole family from
  resuming (`:6687-6697`). After polling, the driver reads the family again
  and posts resume only if needed. A later read failure does not undo a wake
  already triggered by an earlier status read (`:12255-12276`).
- **A provided credential is stored on the server.** `PUT /api/config`
  persists it in the server's own `config.json` under the path that
  credential id owns (`config.ts:570-633`,
  `shared/credential-request.ts:52-65`) and the answer is a set of
  configured-or-not booleans, never the value (`index.ts:7125-7157`). The
  driver's `--provide` therefore changes a machine-wide setting, not just
  that card. `boxToken` is refused outright: saving it makes the server list
  and verify the cloud computers on that account and fail the whole write
  when it cannot (`index.ts:11752-11790`).
- **A configured boolean cannot verify a replacement.** Before a credential
  PUT, the driver reads `GET /api/config`. After a timeout, network error or
  5xx it reads again: only an explicit false-to-true transition verifies the
  save. An already configured target or unreadable status leaves
  `saveOutcome: "unknown"` at exit 3, with no automatic wake. Choose
  `answer --resume --request <id>` to wake the bot on whatever is stored, or
  `--provide` again using the user's file or shell. A 4xx means not saved.
  With native system voice selected, `tts.configured` reports engine
  availability, not an ElevenLabs key (`tts/index.ts:28-36,57-63`); an
  ambiguous voice-key write therefore also remains unknown.
- **Saving a provider key restarts every provider.** A config write whose
  section is not on the no-reload list (`index.ts:12003-12014`) calls
  `reloadProviders`, which disposes the whole fleet, fails each in-flight
  delegation watch and leaves `error: turn interrupted — provider settings
  changed` on every busy bot's thread (`:7175-7207`). Of the credential
  targets that is `xaiApiKey` and `opencodeGoApiKey`; `ttsKey` and
  `openaiImageApiKey` write excluded sections and do not reload the fleet. `answer --provide`
  checks the whole fleet and team map before reading the value, and again
  immediately before the PUT. Any busy bot or queued/running delegation on
  the server refuses the write, including other teams' work. Dry runs and
  calls without a value retain the early check. There is no override.
  The server has no idle-conditional config write: work can still start in
  the residual millisecond window between the last reads and the PUT.
  Wait for the fleet and its queues to settle, or dismiss the card.
- **`doctor --server` reports only the names it strips.** It reads
  `/proc/<pid>/environ` and names the ones in `STRIPPED_ENV` —
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, `OMB_TOKEN`,
  `OMB_SECRET` — and no others, and never a value. `unknown` means the
  environment was unreadable, not that it was clean.
- `send --bot <specialist> --run <ref>` is refused with exit 3 when another open run records the same specialist thread, unless a complete snapshot attributes that bot to the selected run alone; pass `--thread <id>` to override deliberately. `interrupt` has the same guard.
