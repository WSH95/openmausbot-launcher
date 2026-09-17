---
updated_at: 2026-09-17
updated_by: claude
session_status: closed
branch: main
---
# Handoff

## Now

The v2 pass is complete except the conditional macOS phase. Six of the seven
beads are closed on evidence: the three hosts (`oml-n2f`, `oml-5bw`), the
`pair` verb and the Tailscale remote run (`oml-xnn`), several runs per team
(`oml-no8`), the four request kinds in `answer` (`oml-170`), and the Codex
sandbox question (`oml-u1j`, closed as a documented restriction: inside
workspace-write the driver cannot reach loopback at all). `oml-hou` (macOS
lifecycle without `/proc`) stays open: the plan made it conditional on the
user's confirmation and no Mac is available. The real session on 2026-09-17
ran T14 and T15 as two open runs on real OpenMausBot 0.1.56 and merged both
(`c7554a5`, `11ff1e6` in the slugkit clone); `docs/evidence.md` "v2
validation" and `docs/validation/2026-09-17-parallel-t14-t15.json` hold the
record. The suite is 399 tests. Nothing was pushed; every push still needs
the user's explicit permission.

## In flight

Nothing runs. No OpenMausBot server is up; ports 8899/8900 are free; the
Phase 7 data dir `~/.cache/agent-team/omb-launcher-data-v2run-20260917T050914-…`
is kept as the run's archive. Two host services the pass installed are still
running as user services: `openclaw-gateway.service` and
`hermes-gateway.service` (Hermes enabled `loginctl` linger). The OpenClaw
Telegram bot token file exists under `~/.openclaw/`; the token was visible in
one screenshot during Phase 1 and should be revoked with BotFather's
`/revoke` and re-issued if the bot is kept.

## Next steps

1. Decide `oml-hou` (macOS): implement the `ps`-based backend behind the
   `hasProc()` gate as planned, or leave the bead open.
2. Fix `oml-fg8`: the last open run never settles after its sibling run
   closes when they share specialist threads (real-run evidence in the
   validation JSON; reproduce with a two-run fake scenario, close A, watch B).
3. Consider the two report attribution gaps the run exposed (`oml-j4r`): a task-log
   entry whose heading does not name the run is attributed by body text
   (T14's check matched T15's entry), and the closing phrase "merged into
   `main` as `<sha>`" is not parsed for `merged-ancestor`.
4. Pack observations for the dev pack's own project: the lead posted the run
   marker while the shared reviewer was busy on the other run, and its Codex
   harness refused the record commit without explicit authority.

## Blockers

None in the launcher. The macOS phase needs a Mac or the user's decision.

## Key files

- `docs/evidence.md`: "v2 host verification", "v2 remote run", "v2
  validation" (this session), each with its validation JSON.
- `docs/review/2026-09-16-answer-kinds-rescue.md`,
  `docs/review/2026-09-16-watch-drain-followups.md`: the Phase 6 and Phase 5
  audits.
- `.superpowers/sdd/continue-the-tasks-and-vast-melody/progress.md`
  (git-ignored): the pass's full ledger with every ruling.
- `.project-steward/VERIFY.md`, `RISKS.md`, `DECISIONS.md` (0009–0016).

## Warnings

Bot turns and host CLI turns cost the user's subscriptions: the pass spent
39 OpenMausBot turns (cap 50) and the host and Codex sessions listed per
phase in `docs/evidence.md`. Never answer "Always allow"; never answer a
human decision for the user; `watch` before `answer`. A provider key
(`xaiApiKey`, `opencodeGoApiKey`) saved through `answer --provide` restarts
every provider: the driver refuses while any bot is busy. Never compose a
command that carries a secret: a user-owned 0600 file through
`--secret-stdin <`, or `OMB_SECRET` exported in the user's own shell.
