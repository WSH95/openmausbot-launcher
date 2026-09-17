---
updated_at: 2026-09-17
updated_by: codex
session_status: closed
branch: codex/rotate-openclaw-telegram-bot
---
# Handoff

## Now

The OpenClaw Telegram token rotation is complete on
`codex/rotate-openclaw-telegram-bot`. The earlier screenshot-exposed token was
independently confirmed revoked before the replacement token for `OpenClaw
Laptop` (`@WSHOpenClawLaptopBot`, id `8904072141`) was privately staged,
token-safely validated and atomically installed in the 0600 token file. No secret
is stored in this repository or handoff.

The gateway is active. `dmPolicy=pairing` and `groupPolicy=disabled` remain in
force; BotFather group joining is enabled by the user's choice, but OpenClaw still
refuses group processing. The existing approved sender remains valid under the
default account. The previous validation bot, `@OMBLauncherCheckBot`, was deleted
after the replacement passed the DM gate. Bead `oml-8v0` is closed. This was
OpenClaw infrastructure validation with zero OpenMausBot server starts and zero
OMB bot turns.

## In flight

Nothing is in flight for this rotation. The token file remains outside the
repository and was not read here. Existing unrelated ready Beads remain
preserved for future work.

## Next steps

1. Claim `oml-fg8` with `bd update oml-fg8 --claim`, reproduce the two-run
   settlement failure against the fake server, and fix it test-first.
2. Claim `oml-j4r` and add report regressions for task-log headings that omit
   the run name and for `merged into main as <sha>` commit text.
3. Investigate `oml-2rc` if the two timing-shaped tests flake again under
   full-suite parallelism; preserve the failing output before changing them.
4. Leave `oml-hou` open until macOS work is requested and a Mac or an explicit
   implementation decision is available.

## Blockers

None for the launcher. The macOS lifecycle task needs a Mac or a user decision.

## Key files

- `docs/evidence.md`: historical phone validation and the dated token-rotation
  remediation note.
- `.project-steward/VERIFY.md`, `DECISIONS.md` 0018, and `RISKS.md`: safe
  checks, gateway-boundary decision and screenshot/UI-capture mitigation.
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

## Warnings

Treat every token shown in a screenshot or UI capture as compromised. Keep it out
of browser automation, argv and transcripts; revoke it before replacement and use
a user-owned 0600 token file. Every push still requires explicit user permission.
