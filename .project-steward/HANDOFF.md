---
updated_at: 2026-09-17
updated_by: codex
session_status: closed
branch: main
---
# Handoff

## Now

The OpenClaw Telegram token rotation is integrated into `main`. The user chose a
local merge, so `main` fast-forwarded from `5940e89` to `581188e`. The merged tree
passed all 404 tests under `omb-loopback-dev` in 88.498 s. The clean feature
worktree was removed and its fully merged branch was deleted. Nothing was pushed.

The earlier screenshot-exposed token was independently confirmed revoked before
the replacement for `OpenClaw Laptop` (`@WSHOpenClawLaptopBot`, id `8904072141`)
was privately staged, token-safely validated and atomically installed in the 0600
token file. The gateway is active. `dmPolicy=pairing` and
`groupPolicy=disabled` remain in force. BotFather group joining is enabled by the
user's choice, but OpenClaw still refuses group processing. The existing approved
sender remains valid under the default account. The previous validation bot,
`@OMBLauncherCheckBot`, was deleted after the replacement passed the DM gate.
Bead `oml-8v0` is closed. No secret is stored in the repository or handoff. No
OpenMausBot server was started, and no OMB bot turn was used.

## In flight

Nothing is in flight. `main` is the only registered worktree. The token file
remains outside the repository and was not read here. Existing unrelated ready
Beads remain preserved for future work.

## Next steps

1. Claim `oml-fg8` with `bd update oml-fg8 --claim`, reproduce the two-run
   settlement failure against the fake server, and fix it test-first.
2. Claim `oml-j4r` and add report regressions for task-log headings that omit
   the run name and for `merged into main as <sha>` commit text.
3. Claim `oml-2rc` and use its preserved 2026-09-17 recurrence to replace the
   fixed timing assumption with a condition-based wait; keep the focused and
   full-suite evidence together.
4. Leave `oml-hou` open until macOS work is requested and a Mac or an explicit
   implementation decision is available.

## Blockers

None for the launcher. The macOS lifecycle task needs a Mac or a user decision.

## Key files

- `docs/evidence.md`: historical phone validation and the dated token-rotation
  remediation note.
- `.project-steward/VERIFY.md`, `DECISIONS.md` 0018, and `RISKS.md`: safe
  checks, gateway-boundary decision and screenshot/UI-capture mitigation.
- Bead `oml-2rc`: the pre-merge timing failure, focused pass and two subsequent
  full-suite passes.
- `skills/openmausbot-launcher/assets/codex/omb-loopback.config.toml` and
  `skills/openmausbot-launcher/references/hosts.md`: the completed, unrelated
  Codex loopback profile work.

## Tried and rejected

- The default `workspace-write` sandbox cannot run the launcher's loopback
  listener or client. Broad `danger-full-access` remains a fallback, not the
  portable default; the opt-in profile is the least-privilege path.
- The Codex skill-creator quick validator rejects the pre-existing
  `compatibility` frontmatter key. The repository's Agentskills contract tests
  accept it, so deleting the cross-host declaration was rejected.
- The first pre-merge full test run hit the existing timing-shaped watch flake.
  The focused test and both subsequent full runs passed, so changing production
  code during this documentation-only task was rejected. Bead `oml-2rc` retains
  the failure for a condition-based repair.

## Warnings

Treat every token shown in a screenshot or UI capture as compromised. Keep it out
of browser automation, argv and transcripts; revoke it before replacement and use
a user-owned 0600 token file. The default `workspace-write` sandbox cannot run
the loopback-dependent tests; select `omb-loopback-dev` for repository testing.
Every push still requires explicit user permission.
