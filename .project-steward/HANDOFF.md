---
updated_at: 2026-09-18T21:34:40Z
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
went into that commit. `oml-xml` is closed at `6d772d3`: test ports now come
from outside the kernel's ephemeral range (`portBand` in `tests/helpers.mjs`),
which removes the port collision that once replaced the lease refusal in
`tests/lifecycle.test.mjs:525`; the suite is 523/523. The only open bead is
`oml-hou` (macOS lifecycle).

## In flight

Nothing. The working tree is clean after the steward commit that carries this
handoff; every earlier dirty file was committed in `e49db12`.

## Next steps

1. `oml-hou`: macOS `up`/`down`/`cleanup --kill` without `/proc`, only when a
   Mac or an explicit decision is available.
2. Code reviews from now on, per the user's instruction of 2026-09-18: run
   `/grok-build:review` with grok-4.6 at xhigh effort and a Fable 5.1 reviewer
   at xhigh effort; Opus 5 (max) still implements approved plans.
3. Any `git push` needs the user's explicit permission for that push.

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
- `tests/helpers.mjs` `portBand`, `freePort`, `freePortPair`: the test port
  band and why it avoids `listen(0)`; `tests/helpers.test.mjs` pins it.

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
- In a shell wait loop, `pgrep -f "node --test"` matches the loop's own
  command line and waits forever; match on something the loop does not
  contain, or wait on a pid. The same self-match applies to `pkill -f`.
