---
updated_at: 2026-09-18T20:25:55Z
updated_by: cli
session_status: closed
branch: main
---
# Handoff

## Now

The explicit-invocation change is complete and committed on `main`
(`7a87b1b` … `e49db12`, seven commits after `ff2b7dd`); bead `oml-c37` is
closed and nothing was pushed. The skill's SKILL.md frontmatter carries
`disable-model-invocation: true` and `agents/openai.yaml` carries
`policy.allow_implicit_invocation: false`, so Claude Code, Grok Build, OpenClaw,
DeepSeek Harness and Codex no longer hand the skill to the model on an
ordinary message; Hermes Agent does not read the key and stays implicit.
SKILL.md §1 acts only when the host delivered the file for the user's
invocation and runs no verb otherwise. The skill directory has a README for
the person installing it; SKILL.md never references it. Every host was checked
with zero OpenMausBot bot turns, including DeepSeek Harness (key read by a
wrapper from `~/.config/dsh/api_key`, 0600, never printed) and the OpenClaw
phone form from the user's Telegram (fresh-session ordinary message ran
nothing; `/openmausbot_launcher status` with and without `--project` ran one
`status` each; a follow-up worked without the command). Records, ids and hashes
are in `docs/evidence.md`, section "2026-09-18 — Explicit invocation on every
host that reads the switch". `npm test` passes 520/520. Two gpt-5.6-sol
review rounds, a gpt-6-astra Codex rescue and an Opus 5 completeness review
went into the last commit. Open beads: `oml-hou` (macOS lifecycle) and
`oml-xml` (a lifecycle test port collision seen once).

## In flight

Nothing. The working tree is clean after the steward commit that carries this
handoff; every earlier dirty file was committed in `e49db12`.

## Next steps

1. Optional third review, per the user's instruction of 2026-09-18: run
   `/grok-build:delegate` with grok-4.6 at xhigh effort and an Opus 5 (max)
   reviewer over `git diff ff2b7dd..HEAD`; expect no required changes.
2. `oml-xml`: reproduce the port collision in `tests/lifecycle.test.mjs:525`
   (assertion at line 545, "port … is in use" instead of the lease refusal)
   by looping `node --test tests/lifecycle.test.mjs` twenty times; fix the
   port reservation in the test, not the driver.
3. `oml-hou`: macOS `up`/`down`/`cleanup --kill` without `/proc`, only when a
   Mac or an explicit decision is available.
4. Any `git push` needs the user's explicit permission for that push.

## Blockers

None.

## Key files

- `skills/openmausbot-launcher/SKILL.md`: line 4 the switch; §1 the
  invocation guard and routing rules (verb → run and stop; task → §2 only on
  `no team is recorded for this project`, else follow `error`/`hint`).
- `skills/openmausbot-launcher/agents/openai.yaml`: the Codex policy.
- `skills/openmausbot-launcher/README.md`: human entry point; prerequisites,
  install, invocation forms.
- `skills/openmausbot-launcher/references/hosts.md`: Invoke column per host;
  phone-mode steps 3 and 5 (`/new` must be confirmed before the first message).
- `docs/design.md`: "## SKILL.md" preamble (frontmatter nonconforming to the
  agentskills.io spec by design), host table, phone flow, host checks.
- `docs/evidence.md`: the 2026-09-18 section, all invocation probes.
- `tests/docs.test.mjs`, `tests/size.test.mjs`: the guards (switch values,
  design/SKILL frontmatter byte-identical, routing outcomes, README facts,
  exactly one extension key).
- `.project-steward/DECISIONS.md` 0019; `VERIFY.md` for the mutation checks.

## Tried and rejected

- Putting the key under `metadata`: the hosts read it only at top level.
- Narrowing the description instead of the switch: Hermes relies on it.
- `openclaw sessions archive agent:main:main`: refused, "Cannot archive an
  agent's main session"; use `/new` in the chat and wait for its confirmation.
- Launching the Codex rescue with `codex exec --full-auto` or the
  `codex:rescue` subagent: blocked by the auto-mode classifier; the plain
  `codex exec` form ran and completed.

## Warnings

- The frontmatter fails the agentskills.io reference validator because of the
  one extension key; that is accepted in Decision 0019. Do not remove the key.
- `docs/design.md`'s yaml block must stay byte-identical to the SKILL.md
  frontmatter; a test enforces it.
- The guard's refusal branch (an uninvoked model reading SKILL.md and stopping)
  has not been exercised in a host session; only its text is tested.
- `nohup setsid codex exec …` returns at once while Codex keeps running; wait
  on the pid or a done-marker. This session had Codex and an Opus subagent
  editing the tree at the same time for half an hour; avoid that.
- Every real bot turn costs the user's subscriptions. This session spent 0
  OpenMausBot turns and about 22 host inference sessions.
