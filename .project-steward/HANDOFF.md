---
updated_at: 2026-09-17
updated_by: codex
session_status: closed
branch: codex/codex-loopback-profile
---
# Handoff

## Now

The portable Codex loopback profile follow-up is complete on
`codex/codex-loopback-profile` at `06c28e6` (`feat(codex): add
least-privilege loopback profile`). Bead `oml-9mc` is closed. The installable
skill carries an opt-in profile that extends `:workspace` and allows only
`127.0.0.1` and `localhost`; it never changes user configuration. The
repository-only `omb-loopback-dev` profile adds `127.0.0.2` for the fake
proxy scenario and is not selected by default. The HTTP client merges the
two consumer hosts into both proxy-bypass variables only for loopback URLs.

Codex CLI 0.154.0 loaded the consumer profile from a clean temporary home,
allowed the real HTTP client to listen and connect locally, and blocked an
unlisted public request. The final profile-backed suite passed 404/404; the
focused profile/HTTP contracts passed 14/14; the final documentation and
skill contracts passed 9/9; `git diff --check` was clean. Independent review
fixed legacy sandbox precedence and `workspace_roots` coverage, then reported
no remaining findings and `Ready to merge: Yes`. No OpenMausBot server or bot
turn was used. Nothing was pushed; every push still needs explicit user
permission.

The earlier v2 pass remains complete except its conditional macOS phase.
Its real T14/T15 session, 39-of-50 turn total, and remaining defects are
recorded in `docs/evidence.md`, `.project-steward/PROGRESS.md`, and the beads.

## In flight

No process or test is running. The feature worktree is
`/home/wsh/Documents/openmausbot-launcher/.worktrees/codex-loopback-profile`.
The branch is complete and awaits the user's integration choice. The main
working tree is clean and remains at `c156e59`.

The previous handoff recorded `openclaw-gateway.service` and
`hermes-gateway.service` as installed user services, with Hermes login linger
enabled. Their runtime state was not changed or rechecked in this follow-up.
The OpenClaw Telegram token file remains outside the repository; the previous
session warned that the token appeared in one screenshot and should be
revoked and re-issued if the bot is kept.

## Next steps

1. Choose how to integrate `codex/codex-loopback-profile`: merge it locally
   into `main`, push it and create a pull request, or keep the branch as-is.
   A push requires fresh explicit permission.
2. Fix `oml-fg8`: the last open run can fail to settle after its sibling
   closes when both use shared specialist threads.
3. Address `oml-j4r`: task-log body text can attribute the wrong run, and the
   phrase `merged into main as <sha>` is not parsed as `merged-ancestor`.
4. Decide `oml-hou` only when macOS work is wanted and a Mac or an explicit
   implementation decision is available.

## Blockers

None in the implementation. Integration is waiting only for the user's branch
choice. A managed Codex policy or legacy `sandbox_mode` /
`[sandbox_workspace_write]` setting can still override the opt-in profile;
the host instructions document detection and fallbacks.

## Key files

- `skills/openmausbot-launcher/assets/codex/omb-loopback.config.toml`: the
  consumer profile.
- `skills/openmausbot-launcher/references/hosts.md`: installation, precedence,
  smoke checks, rollback, and fallback guidance.
- `skills/openmausbot-launcher/scripts/lib/http.mjs`: exact loopback proxy
  bypass merge.
- `docs/evidence.md`: the zero-bot-turn Codex profile probe.
- `.project-steward/VERIFY.md`, `DECISIONS.md` 0017, `RISKS.md`: final checks
  and rationale.

## Warnings

The Codex skill-creator quick validator rejects the pre-existing
`compatibility` frontmatter key, while this repository's Agentskills contract
tests accept it; `VERIFY.md` records that tool/spec mismatch. Do not delete the
cross-host declaration merely to satisfy that narrower validator. Bot and
native-host turns consume the user's subscriptions. Use `watch` before
`answer`; never answer a human decision for the user or accept an always-allow
approval. A provider-key write restarts the provider fleet, so the driver
refuses it while any bot is busy. Keep credentials out of commands and
transcripts: use a user-owned 0600 file through `--secret-stdin`, or an
`OMB_SECRET` value exported in the user's own shell. Never push without
explicit permission.
