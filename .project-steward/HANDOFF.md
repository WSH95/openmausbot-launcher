---
updated_at: 2026-09-08
updated_by: claude
session_status: closed
---
# Handoff

## Now

The independent review and test of M1 is finished (Beads epic `oml-nqo`, plan
`~/.claude/plans/based-on-the-development-lucky-shell.md`). All four test tiers
ran; `oml-nqo.21`–`.24` are closed. **Twenty-six findings are filed and all
remain open**, because the user's decision for this pass was to file findings
and fix nothing. No source, test or reference file was changed by any tier, so
the suite is unchanged at 154 tests.

The write-up is `docs/review/2026-09-08-m1-review.md`. It carries the verdict,
a per-tier table, the full findings table with severities, `file:line` evidence
and bead ids, what this pass verified for the first time on real OpenMausBot,
what is still unverified, and a recommended fix order. Start there.

Nothing is in flight. No server or validation process is running. The next
worker picks work from `bd ready`; the review's fix order is the recommended
sequence, starting with findings 26, 24 and 23.

## What was validated

Tier 0 (free): `npm test` 154 passed, 0 failed, 0 skipped; `tests/snapshot.test.mjs`
5/5; four usage probes exit 2; the verb list holds 15 names and no `state`
verb; the earlier host evidence re-verifies (6/6 transcripts, 2/2 source files).

Tier 1 (free, fake server): 21 scripted steps, 211 assertions, 209 matching,
across 78 driver invocations. Fake runs are not evidence and stay in
`VERIFY.md`.

Tier 2 (real OpenMausBot 0.1.56, **zero bot turns**): the full setup path —
`doctor` 5/5, `doctor --server` 10/10, `up --fresh`, `import`, `bind`, `facts`,
`status` — plus the first real-server `import --adopt`. Provider keys and
`OMB_TOKEN` were proven absent from both server processes from a single shell
holding three decoy keys. The design's unevidenced host checks all passed:
Grok Build 1.0.13 and Codex CLI 0.153.4 each started the **real** server, which
outlived the host process and was stopped by `down` from another shell; Codex
`workspace-write` failed with `listen EPERM` as designed; Codex `read-only`
listed the skill; Codex `workspace-write` wrote the state file; and
`claude -p "run T10 through the team"` loaded the skill as its first tool call.
`${CLAUDE_SKILL_DIR}` resolves by load-time text substitution, not an
environment variable — a shell script cannot read it.

Tier 3 (real, **5 Sudo turns and 1 Sage turn**): run `d0a01943d403c7af`. An
approval card was raised and denied (`rejected`); the `approvePeerComms` peer
card "@Sudo wants to contact @Sage" was allowed once and Sage answered PONG;
a working bot was interrupted (`interrupted: true`, idle within 1 s, the turn
recorded `ok: false`); a background `watch --max-seconds 570` returned after
60 s at the next terminal state while a foreground watch ran concurrently, and
both checkpointed; `report --md` closed the run `passed` and `report --run last`
appended exactly one `reanalysis` without changing the original result. Only
Sudo and Sage have event files. No delegation occurred.

Two documented claims did not survive the test. `docs/evidence.md:22-24` says
`up` names the sandbox cause in its hint; on a real sandboxed failure it does
not, because `logTail`'s 12-line window cuts the `listen EPERM` line
(`oml-nqo.28`). `docs/evidence.md:62` says Codex ran `status` from inside
workspace-write; it cannot — `status` exits 3 there, and the driver reports a
blocked network as an identity failure (`oml-nqo.30`).

## Repository and runtime

Work is on `main`; no push was performed and none is authorized without the
user's explicit permission for that push (Decision 0005, `.beads/PRIME.md`).
Local Git operations and tested Conventional Commits are authorized.
`AGENTS.md` and `CLAUDE.md` were not changed.

No OpenMausBot server is running. Every server this review started was stopped
with `down` and verified: pids 617810/617817 (main, port 8893), 620924/620931
(Grok, 8901), 625770/625777 (Codex, 8903) and 618776/618783 (the key-strip
check, 8897) are all absent, health refuses on every port including the
webhook port 8894, and no process has a cwd under the fixture.

The temporary fixture `/tmp/oml-review-t2-CGG7JR` holds the raw driver logs,
host transcripts and the server data dir; the same files are copied into the
session scratchpad under `tier2/` and `tier3/` and are referenced by SHA-256
from `docs/validation/2026-09-08-m1-review.json`. `/tmp/oml-m1-hostcheck-VslL6s`
is the earlier M1 evidence root and must be kept. The stray
`codex-linux-sandbox` pid 426150 is still alive; it sits outside `.worktrees/`
so `cleanup` ignores it by design (`oml-nqo.19`) — report it, do not kill it
without the user.

The external test input
`~/Documents/agent-team-devpack/packages/dev-team/dev-team.openmaus.json`
hashes `48e4ac63…3255949`, unchanged before, during and after. No file under
that repository was written; this pass validated the launcher, not the pack.

## Key evidence

- `docs/review/2026-09-08-m1-review.md`: the review, the 26 findings, the fix order.
- `docs/evidence.md`: two new sections, "M1 review, tier 2" and "M1 review,
  tier 3", the latter containing the run's `report --md` block.
- `docs/validation/2026-09-08-m1-review.json`: server identity, team and bot
  ids, the four approval requests and their outcomes, six bot turns with their
  turn ids, per-thread event sources, incidents, cleanup proof, log hashes.
- `.project-steward/VERIFY.md`: all four tiers with exit codes and deviations.
- `bd show oml-nqo` and its children: 26 open findings plus four closed tiers.

## Preserved constraints

Bot turns cost the user's subscriptions, and so do native host CLI sessions:
count both and keep real runs bounded. Never answer "Always allow" on an
approval card. Always `watch` before `answer`.

A lead's prose is not evidence that a tool ran. In this run Sudo wrote "Sage
contact denied" in a turn whose native log shows no `ask_bot` call at all; read
`<dataDir>/native/<thread>.ndjson` before believing a closing report.

A Codex bot under approval mode `ask` raises a separate MCP card for each tool
before any peer gate is reached, so a peer contact costs two approvals, not
one. Peer decisions do not appear in `/api/decisions`.

`up --port N` also occupies N+1 for webhook ingress: space concurrent servers
at least two ports apart. An adopted project needs `bind` before it can
dispatch a task.

`dev-team.openmaus.json` is an external test input, never a required or
hardcoded launcher configuration. T12 retains its original incomplete report
and 8/9 package score. The devpack gate `atw-07l.27` — one more real full-team
run — stays unmet by this pass, by the user's choice.

For a legacy `.omb/lock` refusal, stop every launcher command and automation,
update every installed copy, then remove only that legacy path. Never unlink or
rotate `lock.sqlite`; stop a hung live writer explicitly. `checkpointed:false`
means an observation was not saved. Unknown evidence cannot authorize done or
report pass; dry-run reports execute no tests.
