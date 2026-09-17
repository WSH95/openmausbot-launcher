# Decisions

Record decisions in order. Include the reason, the choice, and its practical
effect.

## 0001 — 2026-09-08T01:57:08Z — Adopt Project Steward

Context: Project work needs to survive changes of agent, tool, or device.

Decision: Keep project state in `.project-steward/`. Use `AGENTS.md` for
shared instructions and `CLAUDE.md` as a small Claude Code adapter.

Consequences: Git carries the files needed to resume the work elsewhere.

## 0002 — 2026-09-08 — Standalone repository, scope, and the design's hard rules

Context: the launcher role for OpenMausBot lived only in a Claude Code
session's memory and scratch scripts in `~/Documents/agent-team-devpack`.
The user chose a new repository (that repository stays the pack's home,
its Decision 0009; `agent-team-cli` excludes any OpenMausBot dependency),
documentation-only coverage for OpenClaw, Hermes, and DSH this round, and
the same-machine topology.

Decision: build `openmausbot-launcher` as one skill directory with a
dependency-free Node driver, as specified in `docs/design.md`. Hard rules
carried from two Codex review rounds: settled-then-classify completion with
a run-specific marker instead of receipt counting; a rename-reclaimed lock
directory and run ids for the state file; ownership proven by process
ancestry before `up` records it; SSE frames as invalidations over REST
truth; exact 409 semantics in the contract fake; one run per team; Linux
lifecycle only; tokens never in argv or transcripts.

Consequences: the driver is larger than a single script (an entry point
plus `lib/` modules); the first real run is the dev pack's 0.4.2
validation; `pair`, room sending, macOS lifecycle, and the special request
types wait for v2.

## 0003 — 2026-09-08 — M1.1 correctness repair contract

Context: re-review demonstrated overlapping writers in the directory-lock
protocol, incomplete monitoring evidence, mutating previews, unsafe identity
assumptions, and report approval attributed to the lead's paraphrase.

Decision: use a persistent SQLite mutex with immediate attempts and bounded
asynchronous retries, keeping atomic state JSON version 1. Stop all old
launchers and update every installed copy before removing a legacy lock.
Conservative snapshots, one observation deadline, verified bindings, and
attributable report evidence are specified in `docs/design.md`. Beads epic
`oml-t8u` owns the repairs. No new bot turns or dev-pack edits in this pass.

Consequences: Node 24 is the supported runtime; SQLite may warn on stderr.
Skipped required checks yield incomplete. Historical reanalysis preserves
original evidence. The earlier lock choice in Decision 0002 is superseded.
M1's all-host gate and T12's 8/9 result remain separate from repair completion.

## 0004 — 2026-09-08 — Commit authority during M1.1

Historical restriction, superseded by Decision 0005 below.

The active Beads session hook states `Git authority: no git operations in
this context`. The user authorized implementation after that restriction
was explained, without lifting it. Work is reviewed against a source copy
and remains uncommitted. Intended checkpoint once authorized: one tested
Conventional Commit for the integrated repair, including steward records;
never push. Automatic per-task commits from the re-review were not adopted.

## 0005 — 2026-09-08 — Permit Git work; require permission for pushes

The user clarified: "I don't want to prohibit Git operations; I just want
to make it a rule that no one can perform a `git push` without my permission."

Local Git inspection, staging, commits, branches, worktrees, rebases and
local merges are authorized as part of the requested work. Commit coherent,
tested checkpoints without a separate permission question. Every push,
including automated or force pushes, requires explicit user permission for
that push. Implementation, commit and merge approval do not authorize a push.

Corrected AGENTS.md and CLAUDE.md under that explicit instruction; their
policy diff was shown before applying it. Beads still emitted its blanket
restriction with `no-git-ops: false` in this repository without a remote.
The supported `.beads/PRIME.md` override now carries the project policy into
both hosts' existing hooks. Automated push settings remain disabled;
Project Steward keeps automatic local commits enabled. Decision 0004 is
historical and no longer defines the repository's policy.

## 0006 — 2026-09-08 — Team packages are external test inputs

The user clarified that `dev-team.openmaus.json` is a test configuration,
not a configuration to hardcode in the launcher. The earlier M1 explanation
incorrectly made resolving that package's ListAgents behavior a prerequisite
for launcher acceptance.

The importer already reads the supplied path and discovers the package's
roster and lead; `--check-042` already runs only when explicitly requested.
Keep this behavior. Package-specific diagnostics remain optional and retain
their original results. The launcher must import, bind, dispatch, monitor,
relay, report accurately and clean up with the supplied configuration.

Correct M1's scope and `oml-axr.15` to retain the missing host validation
without requiring package edits or a 9/9 package score. T12 remains 8/9;
its historical report is not changed to passed. This correction changes
documentation and tracking only, with no new bot turns or package edits.
Tracked in `oml-qh7`.

## 0007 — 2026-09-08 — Complete M1 with attributed native command evidence

The user approved M1 completion and specified the test bindings: Sudo
`codex/gpt-5.6-luna/high`, Sage `claude/claude-sonnet-5/high`, Vale
`codex/gpt-5.6-terra/high`, Nova `claude/claude-opus-5/high`, Quill
`grok/grok-4.6/medium`. Configure all five from the unchanged supplied
package and verify the remaining command sequence in the three native
CLIs, with one acknowledgment request to the leader per host. No pushes.

The operator authored the test text and prompted the native agents with
exact commands. Their shell tool records establish command execution;
OMB stores each ordinary send as `role: user`. The user correctly called
attention to that sender role. Do not describe these checks as OMB bot
messages, autonomous development-task handling or a full-team run.

The three successful OMB leader turns complete the missing host command
evidence. Only the leader model executed. A standalone-status visibility
bug found in the checks is fixed with a regression; the full suite passes
154/154. The fixture is clean and the owned server stopped. Close
`oml-axr.15` and `oml-axr`; preserve T12's separate 8/9 package result.
The exact records and restrictions are in `docs/evidence.md` and
`docs/validation/2026-09-08-m1-hosts.json`. This does not broaden acceptance
to the other unverified hosts, long Codex SSE, or the four unused models.

## 0008 — 2026-09-08 — AGENTS.md corrections in the M1 fix pass

At the user's request (M1 review finding 18, `oml-nqo.18`; the diff was
part of the approved fix plan), two lines of `AGENTS.md` outside the
managed blocks were corrected: the `scripts/lib` module list now names
every module and the `verbs/` directory, and the upstream-issue pointer
names the dev pack's `~/Documents/agent-team-devpack/docs/upstream/`, since
this repository has no `docs/upstream/`. No policy text changed;
`CLAUDE.md` was not touched.

## 0009 — 2026-09-16 — Hosts run on the user's logins; a second Node for OpenClaw

The user chose the v2 pass's host setup: OpenClaw and Hermes Agent
authenticate with the user's Codex (ChatGPT) OAuth login, DeepSeek Harness
with a DeepSeek API key the user placed in a 0600 file, and the Telegram
check uses a bot the user created. OpenClaw needs Node 24.16 or newer, so
Node 24.21.0 was installed side by side under `~/.local/lib/node-v24.21.0`
and is used only by OpenClaw (wrapper `~/.local/bin/openclaw`); the driver's
baseline stays Node 24.11.0 and the `node` symlink was not changed.
Secrets never entered this repository or a command line: the Telegram token
lives in `channels.telegram.tokenFile`, the DeepSeek key is read by a wrapper
into the process environment, and the user typed passwords and pastes in a
terminal window opened for that purpose.

## 0010 — 2026-09-16 — Tailscale is the verified remote path

For bead `oml-xnn` the user chose Tailscale over a LAN bearer exercise or
OpenMausBot's cloud tunnel. Tailscale was installed with `sudo`, the user
logged in and enabled MagicDNS and HTTPS certificates, and
`openmausbot serve --tailscale` was started by hand with a sanitized
environment and `--no-pair`; a request through the tunnel without a token is
refused with the server's proxy text, so the tunnel gives no loopback trust.
The `pair` verb (this pass) replaces the documented curl.

## 0011 — 2026-09-16 — The environment id is the server binding, not the URL

The Tailscale run showed that one state file could not serve the operator on
loopback and a remote observer on the tunnel address, because the binding
check required the recorded URL to equal the URL in use. The team is now
bound to the server's environment id; only local mode keeps the URL rule,
where another loopback port is another server. A remote observer shares the
machine-local state file and passes `--remote --url`; `import --adopt` is not
used to change a bound state's URL. Recorded in `docs/design.md` (Modes) and
`references/hosts.md` (Remote variant); commit `01901f9`, bead `oml-9kp`.

## 0012 — 2026-09-16 — Several runs per team, attributed conservatively

One task per team was a v1 simplification that the state file enforced by
holding a single `task`. The user wants two tasks open at once with distinct
implementers (bead `oml-no8`), so the state is now version 2 and holds `runs`
keyed by run id. A version 1 document is migrated on read; an older launcher
refuses a version 2 file, so every copy and automation has to be stopped and
updated before the first version 2 write. That rollout rule is in
`docs/design.md` ("Version 2 and its rollout").

What the server allows decided the rest. A bot runs one turn at a time
(`index.ts:3775`), so "parallel" means two open tasks whose implementers work
at once, never two lead turns; each run claims an idle Implementer that no
other open run holds, and `--share-implementer` is the deliberate exception.
A delegated turn lands on the target's **active** thread (`index.ts:3466`),
so only the lead gets a fresh thread per run: a second set of specialist
threads would hijack the first run's delegations. A message reaches only the
bot's active task (`index.ts:10790-10797`), so `send`, the dispatch,
`answer`'s chat fallback and `--nudge` share one delivery helper that
switches the lead's active task back to the run's own thread
(`index.ts:11120-11140`) and posts once more — once, and never to another
thread.

Attribution is conservative because the server offers no direct answer: a bot
is busy as a whole, team-map edges carry no source thread, and the delegation
chips carry names rather than ids. A busy bot nothing can place counts as
in flight for every open run, a busy lead likewise unless the runtime log
names the thread its turn is on, a pending request no run can claim is
`shared` and must be answered with `--request`, and an unmatched settlement
chip leaves a delegation counted as open. Ambiguity never gives one run
exclusive ownership and never lets another call itself finished.

One limit has no workaround and is documented as such: a turn pinned to a
thread that is not the bot's active task — a delegation wake drained after a
switch — cannot be interrupted at all (`index.ts:11077-11084`). The driver
reports the server's words and says to wait for the lead to go idle, then
`task --abandon --run <ref>`.

Recorded in `docs/design.md` (Task lifecycle, Snapshot and evaluation, the
`watch` loop, the state file), `SKILL.md` sections 3-6, and
`references/api.md`, `limits-and-pitfalls.md` and `dev-team.md`; bead
`oml-no8`.

## 0013 — 2026-09-16 — An exhausted watch drain returns uncertainty

The two-redraw ownership exception could authorize terminal results and
nudges from an invalidated snapshot. Watch now classifies frames at arrival,
confirms changed attribution, and checks the relevant generation and current
run ownership before decisions and effects. After three unsuccessful reads
or attempts to act, it returns visible running/unknown without checkpointing
the unconfirmed evidence. Ordinary foreign work does not reset quiet.

The stream remains open through the final bounded checkpoint wait. Nudge
delivery carries the same freshness guard and observation deadline through
its lock, identity read, task switch and retry. First-sight card owners are
retained in memory between reads, with locations saved for the selected run.

The design and regression matrix are in `docs/design.md` and
`docs/review/2026-09-16-watch-drain-rescue.md`. The change was made by Codex
(`gpt-6-astra`) under the user's rule for tasks still open after two review
rounds, on a side branch that `main` then fast-forwarded to (`0492520`).

## 0014 — 2026-09-16 — Sends to a shared specialist need exclusive ownership; a drop chip closes every window

The second Codex rescue (`0c7fcd2`..`cbc5975`, audited in
`docs/review/2026-09-16-watch-drain-followups.md`) changed two user-visible
behaviours. `send --bot <specialist> --run <ref>` without `--thread` is
refused unless a complete snapshot attributes that bot to exactly the
selected run, because two open runs may record the same specialist thread
and a message would otherwise land in the other run's delegated
conversation; `--thread <id>` stays the deliberate override. In the report,
an anonymous "N queued delegations dropped" chip now closes every open
delegation window at its timestamp, so later turns on a shared specialist
read as `shared` rather than being billed to the interrupted run: the
report under-counts on that side of the error. Both were confirmed by an
Opus completeness review that watched the regressions fail at `0492520`.

## 0015 — 2026-09-16 — A credential answered from the environment or stdin, and boxToken refused

`answer` now settles the four request kinds it used to hand back at exit 5
(bead `oml-170`). Three of them are ordinary decisions. The credential one
is not: the value is the user's secret, and the launcher is a command line.

So there is no flag that takes it. `answer --provide` reads `OMB_SECRET`, or
stdin with `--secret-stdin`, exactly one of the two; it strips one trailing
newline, deletes `OMB_SECRET` from its own environment the moment it reads
it, and `OMB_SECRET` joins the names `up` strips from a server it starts.
Keeping it out of argv is not enough, because the operator is usually an
agent whose own tool calls are transcribed: no instruction the launcher
prints may be a command the value could be substituted into. The two
supported paths both keep it out of what the agent composes — the user writes
the value to a file only they can read and the agent redirects from that path,
or the user exports `OMB_SECRET` in their own shell (`read -rs`) and runs the
command there. A
dry run never reads the value at all and the HTTP client redacts the body of
a config write, so a preview cannot print one. With no value the verb exits
5 and asks for the credential by its label rather than guessing. The
consequence to accept: `PUT /api/config` persists the credential in the
server's own `config.json` (`config.ts:570-633`), so providing one from here
changes a machine-wide setting, not only that card — which is why the save
and the card are reported separately when the second step fails. That failure
is recovered with `answer --resume`, never by asking for the credential
again: neither card route carries a value, `provided` only checks that the
credential is configured, and resuming an already-resumed card returns at
once (`index.ts:12197-12206`, `:6838-6842`).

The config status contains no value or per-write receipt (`index.ts:7125-7157`).
After a timeout, network error or 5xx, only a not-configured before / configured
after transition verifies the save. If the target was already configured, a
replacement remains unknown at exit 3 and never wakes the bot automatically:
the user chooses `answer --resume --request <id>` on whatever is stored, or
`--provide` again. A 4xx remains not saved. Provider-key writes check busy bots
and queued/running team-map work before reading the value and immediately
before the PUT. No override exists; the server offers no idle-conditional
write, so a residual millisecond race with new work remains.

`boxToken` is refused with exit 3 and pointed at the app. Saving it makes
the server list and verify the cloud computers on that account and fail the
whole write when it cannot (`index.ts:11752-11790`). That is a conversation
with a provider, not a settings write, and it belongs where the person can
see what it did.

One further deviation from the plan, recorded because it was deliberate: the
driver checks `--reviewed` against the card's `sha256` before posting, but
does **not** pre-empt the server's own check that the preview still hashes to
it. That check refuses before anything is applied (`index.ts:6520-6523`) and
its words name the remedy, so the user gets the server's instruction at exit
3 rather than a usage error this launcher invented.

Recorded in `docs/design.md` (the `answer` row, Deferred to v2, Snapshot and
evaluation), `SKILL.md` sections 4-5, and `references/api.md` and
`limits-and-pitfalls.md`.

## 0016 — 2026-09-17 — Long SSE inside Codex's sandbox is a documented restriction, not a verified path

Bead `oml-u1j` asked whether a long `watch` survives inside Codex's
workspace-write sandbox. The real probe (session `01a0ade0…`) shows the
driver cannot connect to loopback there at all: `EPERM` before the first
frame, the sandbox hint printed, no escalation requested by the model. There
is nothing to verify beyond that, so the bead closes as "documented
restriction": inside the sandbox the launcher's network verbs need escalation
(`danger-full-access`) or `--remote` to a reachable URL, and the docs say so.
`--approve-for-me` implies workspace-write and cannot be combined with
`--sandbox`.

## 0017 — 2026-09-17 — Ship an opt-in Codex loopback profile, not a broad sandbox exception

The default Codex workspace-write sandbox blocks both halves of local
launcher operation: OpenMausBot cannot listen and the driver cannot connect.
Granting `danger-full-access` for every command is wider than the launcher
needs, while starting the server outside the sandbox fixes only the listener.

The installable skill therefore carries
`assets/codex/omb-loopback.config.toml` as a separate profile. It extends
`:workspace`, enables Codex's network proxy, and allows only the literal
hosts `127.0.0.1` and `localhost`. The skill never installs or selects the
profile; the user copies and selects it on each machine, and can remove it
without changing the skill. A legacy `sandbox_mode` or
`[sandbox_workspace_write]` in any loaded config layer overrides the profile;
the user migrates only configuration they control. A managed Codex policy may
still reject it.

Codex's proxy can replace Node's inherited proxy bypass. For loopback clients,
the HTTP boundary now merges those two hosts with both existing `NO_PROXY`
spellings, deduplicates them case-insensitively, and writes the same list to
both variables before the first request. Remote clients do not change either
variable. The repository-only `omb-loopback-dev` profile adds `127.0.0.2`
for the fake proxy-host test; that address and profile are not shipped as
consumer permissions. This follow-up is bead `oml-9mc` and uses no bot turns.
