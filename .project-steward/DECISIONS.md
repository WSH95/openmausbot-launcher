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
