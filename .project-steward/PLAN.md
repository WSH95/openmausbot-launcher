# Plan

Milestones only. Beads owns the task list (`bd ready`); M1.1 is epic `oml-t8u`.

## M1: driver, skill, and launcher validation

Complete (`oml-axr`, final evidence in `oml-axr.15`). Claude Code, Codex CLI,
and Grok Build each executed doctor/server-doctor/status/send and observed
the matching leader reply on real OMB 0.1.56. These were operator-authored
user-role sends through each native CLI. All five requested bindings were
configured; only Sudo ran, for three OMB turns. This was not a new full-team
task or execution of the other four models. The standalone-status defect
found during validation is fixed; the full suite passes (`VERIFY.md`). See `docs/evidence.md`
and its structured native command evidence. The server is stopped.

Team packages remain supplied inputs. `dev-team.openmaus.json` is the
unchanged external test configuration; T12's historical 8/9 package checks
remain separate from launcher acceptance (Decisions 0006 and 0007).

## M1.1: correctness review repairs

Complete: 153 tests pass and independent reviews approved; see `VERIFY.md`.
SQLite serialization, mutation-free previews, real card classification,
conservative monitoring, verified server identity, safe cleanup, and offline
historical report evidence. Completion requires focused regression checks,
independent review, integrated tests, archived T12 attribution reanalysis,
and current operator/design/handoff documents. Details and status are in
`oml-t8u`; this pass spends no new bot turns or host validation runs.

## M1 review and fix pass

Complete (`oml-nqo`, closed 2026-09-08): 26 findings filed by the independent
review of `b1a1f77` and fixed test-first in one pass; real OpenMausBot 0.1.56
exercised in three tiers plus the full-team run T13 through the fixed driver
(`docs/review/2026-09-08-m1-review.md`, "Resolution"; `VERIFY.md`, "M1 fix
pass"). The devpack gate `atw-07l.27` is met.

## v2 pass (2026-09-16/17, complete except macOS)

Status on 2026-09-17: every defect named below is fixed and closed, and the
repairs were confirmed on a real server (`docs/evidence.md`, V16/V17). Only
`oml-hou` is open.

Seven beads in one pass, hosts first: OpenClaw, Hermes Agent and DeepSeek
Harness verified (`oml-n2f`, `oml-5bw`); the `pair` verb and a Tailscale
remote run (`oml-xnn`); more than one run per team (`oml-no8`); `answer` for
skill, routine, secret and connector requests (`oml-170`); long SSE inside
Codex's sandbox (`oml-u1j`, closed as a documented restriction); macOS
lifecycle (`oml-hou`) left open for the user's decision. Defects found on the
way: `oml-60s` and `oml-9kp` (fixed), `oml-2rc` (flaky tests, fixed 2026-09-17),
`oml-fg8` (a run that never settles after its sibling closes, fixed
2026-09-17: the cause was watch budgets below the quiet window). The
real session on 2026-09-17 merged T14 and T15 through two overlapping runs;
evidence in `docs/evidence.md` "v2 validation". Progress in `PROGRESS.md`;
every ruling in the SDD ledger under `.superpowers/sdd/`.

A completed portability follow-up (`oml-9mc`, closed) keeps the default Codex
sandbox finding intact while adding an opt-in path: the installed skill
carries a least-privilege loopback permission profile, and the HTTP client preserves
the exact local proxy bypass needed to use it. The repository has a separate
maintainer profile for the fake server. No user configuration is changed
automatically and no bot turns are part of this follow-up.

Operational security follow-up `oml-8v0` is also closed. The screenshot-exposed
Telegram token was revoked, `OpenClaw Laptop` (`@WSHOpenClawLaptopBot`) replaced
the validation bot, and the old bot was deleted after the DM path passed. The
general OpenClaw bot remains pairing-only for DMs with OpenClaw group processing
disabled; BotFather group joining stays enabled for later topic work. No
OpenMausBot server or OMB bot turn was used.

## Explicit invocation and the in-skill README (2026-09-18, complete)

`oml-c37` closed at `e49db12`: every host that reads the switch requires an
explicit invocation, SKILL.md refuses an uninvoked arrival, the skill carries a
README for the installer, and every host including the OpenClaw phone form was
checked with 0 bot turns (`docs/evidence.md`). Open: `oml-hou`, `oml-xml`.

## Later

Done on 2026-09-17: `oml-fg8`, the two report attribution gaps of `oml-j4r`,
`oml-2rc`, and three beads found on the way (`oml-jc1`, `oml-47p`, `oml-507`);
record in `docs/review/2026-09-17-watch-budget-report-attribution.md`.

macOS lifecycle when a Mac or a decision turns up. Any proposed package
changes belong to the dev pack's project and are not launcher prerequisites.
