---
updated_at: 2026-09-17
updated_by: codex
session_status: closed
branch: main
---
# Handoff

## Now

The portable Codex loopback profile is integrated into `main`. The user chose
a local merge, so `main` fast-forwarded from `c156e59` to `20ac090`, including
the feature commit `06c28e6` and its stewardship commit. Bead `oml-9mc` is
closed. The merged skill carries an opt-in profile that extends `:workspace`
and allows only `127.0.0.1` and `localhost`; it never changes user
configuration. The repository-only `omb-loopback-dev` profile adds
`127.0.0.2` for the fake proxy scenario and is not selected by default.

The merged `main` passed all 404 tests under `omb-loopback-dev` in 104.512 s.
The feature worktree was clean, then removed; its local branch was fully
merged and deleted with `git branch -d`. Independent review reported no
remaining findings. No OpenMausBot server or bot turn was used, and nothing
was pushed.

The earlier v2 pass remains complete except its conditional macOS phase. Its
real T14/T15 session, 39-of-50 turn total, and remaining defects are recorded
in `docs/evidence.md`, `.project-steward/PROGRESS.md`, and Beads.

## In flight

Nothing is in flight. The main working tree is the only registered worktree.
No real OpenMausBot server was started during this follow-up; the test suite
closed its fake servers. The previous handoff recorded
`openclaw-gateway.service` and `hermes-gateway.service` as installed user
services, with Hermes login linger enabled. Their runtime state was not
changed or rechecked here. The OpenClaw Telegram token file remains outside
the repository; an earlier session warned that the token appeared in one
screenshot and should be revoked and re-issued if the bot is kept.

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

- `skills/openmausbot-launcher/assets/codex/omb-loopback.config.toml`: the
  consumer profile.
- `skills/openmausbot-launcher/references/hosts.md`: installation, precedence,
  smoke checks, rollback, and fallback guidance.
- `skills/openmausbot-launcher/scripts/lib/http.mjs`: exact loopback proxy
  bypass merge.
- `docs/evidence.md`: the zero-bot-turn Codex profile probe and earlier real
  runs.
- `.project-steward/VERIFY.md`, `DECISIONS.md` 0017, and `RISKS.md`: checks,
  rationale, and residual risks.

## Tried and rejected

- The default `workspace-write` sandbox cannot run the launcher's loopback
  listener or client. Broad `danger-full-access` remains a fallback, not the
  portable default; the opt-in profile is the least-privilege path.
- The Codex skill-creator quick validator rejects the pre-existing
  `compatibility` frontmatter key. The repository's Agentskills contract tests
  accept it, so deleting the cross-host declaration was rejected.

## Warnings

A managed Codex policy or a legacy `sandbox_mode` /
`[sandbox_workspace_write]` setting can override the opt-in profile. The host
instructions document detection and fallbacks. Use `watch` before `answer`;
never answer a human decision for the user or accept an always-allow approval.
A provider-key write restarts the provider fleet, so the driver refuses it
while any bot is busy. Keep credentials out of commands and transcripts: use
a user-owned 0600 file through `--secret-stdin`, or an `OMB_SECRET` value
exported in the user's own shell. Every push still requires explicit user
permission.
