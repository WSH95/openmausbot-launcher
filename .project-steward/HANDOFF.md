---
updated_at: 2026-09-08
updated_by: codex
session_status: closed
---
# Handoff

## Now

M1 is complete (`oml-axr`, remaining host evidence `oml-axr.15`). The
earlier M1.1 repairs are in `5cfde51`; supplied-package scope correction
is in `e17de18`. This checkpoint adds real native CLI command evidence,
fixes standalone status visibility, and updates the operator/project docs.
The full `npm test` suite passes 154/154 on Node 24.11.0 in 52.225 s;
focused snapshot tests pass 5/5. `git diff --check` passed.

## What was validated

Claude Code 2.1.263, Codex CLI 0.153.4 and Grok Build 1.0.13 each executed
doctor, server doctor, status, one send and reply observation using real
OMB 0.1.56. The operator authored the messages and gave exact commands to
the native CLI agents; their shell tools executed those commands. OMB
stored the messages as `role: user`. The user corrected imprecise sender
wording; keep command provenance separate from OMB message identity.

All five user-requested bindings were configured and read back:
Sudo `codex/gpt-5.6-luna/high`, Sage `claude/claude-sonnet-5/high`, Vale
`codex/gpt-5.6-terra/high`, Nova `claude/claude-opus-5/high`, Quill
`grok/grok-4.6/medium`. Only Sudo executed: three successful OMB turns.
The other four models and a new full-team delegation workflow were not
exercised. No launcher task was opened. Native host sessions also consumed
subscriptions. The external dev-team package's SHA-256 is unchanged.

The Claude check exposed `status --tail` dropping hydrated leader/user
messages when no task was open. A failing regression reproduced it; the
fix returns that conversation with `run: null` and no task verdict. Claude
resumed read-only checks in the same session without resending. Codex
required per-command escalation for loopback HTTP in workspace-write.
Initial Claude redirection and Codex CLI-flag failures spent no OMB turns.
These failures and the successful tool results are preserved in evidence.

At the user's suggestion, read agent-team-devpack's setup guide and its
evidence for per-engine probes, delegation and T12. The historical team
run used different models; it does not validate this new five-model roster.
No files in that repository were changed.

## Repository and runtime

Work remains on `main`. This is a local completion checkpoint; no push
was performed. Local Git operations and tested Conventional Commits are
authorized; every push requires explicit permission for that push
(Decision 0005 and `.beads/PRIME.md`). AGENTS.md and CLAUDE.md were not
changed in this checkpoint.

The temporary fixture `/tmp/oml-m1-hostcheck-VslL6s/project` is clean on
`main`, with one worktree and no task branches. Cleanup found no orphan
candidates. `down` stopped owned supervisor/server PIDs 534440/534447;
both are absent, health refuses connections, and no process has a cwd
under the fixture. No validation process or server is left running.
The local raw logs and server data remain under that temporary root.
The committed evidence extraction retains commands, IDs, results and
hashes without copying transcript reasoning or credentials.

No M1 implementation is in flight. Later work is in `bd ready`, including
OpenClaw/Hermes/DSH verification, pairing, macOS lifecycle, special request
types, parallel runs and long Codex SSE. M1 completion does not claim these
are verified. No new task is selected automatically.

## Key evidence

- `docs/evidence.md`: historical T12, offline reanalysis and native CLI checks.
- `docs/validation/2026-09-08-m1-hosts.json`: exact commands, native session
  and tool IDs, user/reply IDs, three runtime turns, model bindings and cleanup.
- `.project-steward/VERIFY.md`: test results and coverage limits.
- `tests/snapshot.test.mjs`: standalone-send regression.
- `skills/openmausbot-launcher/references/hosts.md`: actual tested permission
  modes, Codex escalation and remaining host limitations.

## Preserved constraints

`dev-team.openmaus.json` is an external test input, never a required or
hardcoded launcher configuration. T12 retains its original incomplete
report and 8/9 package score. Its ListAgents finding does not block launcher
acceptance, and no package files or archived T12 results were changed.

For legacy `.omb/lock` refusal, stop every launcher command and automation,
update every installed copy, then remove only that legacy path. Never
unlink or rotate `lock.sqlite`; stop a hung live writer explicitly.
`checkpointed:false` means an observation was not saved. Unknown evidence
cannot authorize done or report pass; dry-run reports execute no tests.
