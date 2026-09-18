---
updated_at: 2026-09-18T23:59:01Z
updated_by: cli
session_status: closed
branch: main
---
# Handoff

## Now

Team package authoring is implemented, reviewed and committed on `main`
(`a04b6fd` … `79ea8ad`, five commits after `2ae69b7`); bead `oml-i13` stays
open for host acceptance only, and nothing was pushed. SKILL.md §3 "Writing a
team package" takes any request to design, write or change a team package (a
team profile, a roster, a new team) through an interview: one question per
message with a recommended option, a proposal with a reason per choice, a
fixed-shape understanding summary that needs an explicit yes, then the file,
`omb validate`, and a read-back of the file against the summary; import only
when the user asks. `references/team-authoring.md` (465 lines) carries the
format field by field with `bot-package.ts` lines, the nine questions, the
server's limits kept apart from the evidence's recommendations, the summary
template, a skeleton the suite validates, and what follows the file. The
driver has an eighteenth verb, `validate <file>`: offline, no project, no
lock, no request; `errors[0]` rendered as the server's 400 text, checked on a
real OpenMausBot 0.1.56 with four broken packages (all byte-equal) and the
skeleton imported (`docs/evidence.md`, "`validate` agrees with the server on a
written package", 0 bot turns). `import` now parses its file through the same
content-free JSON error. `npm test` passes 590/590. The plan was reviewed
twice by gpt-6-astra before implementation; the code by a Fable 5.1 reviewer
at xhigh (approve with changes, applied in `784115e`) and by Grok Build on
grok-4.6 at high (no correctness bug; five items applied in `79ea8ad`). The
grok-build bridge rejects `--effort xhigh`, so `high` was used.

## In flight

Nothing. The working tree is clean at `79ea8ad` (checked with `git status`
before this handoff); the steward commit that carries this file follows.

## Next steps

1. Host acceptance of the interview, the user's step (`oml-i13` stays open
   until it is run or waived): in Claude Code run
   `/openmausbot-launcher write a team package for <something small>`.
   Expect the first reply to be a question and no verb; a proposal with a
   reason per choice; the understanding summary before any file; a change
   asked at the summary reflected and the summary sent again; after the yes,
   a file that `omb validate <file>` passes and whose roster matches the
   summary. Then `bd close oml-i13 --reason "host acceptance passed"` (or
   `--reason "waived by the user"`).
2. Two `--fresh` data directories from the parity check sit in the home
   directory: `/home/wsh/.openmausbot-20260918T233400-ttDip9` (an aborted
   first attempt with no import) and
   `/home/wsh/.openmausbot-20260918T233400-ttDip9-20260918T233455-2ItQID`
   (the recorded run; the evidence entry names its log). Delete them only
   when the user says so.
3. `oml-hou`: macOS `up`/`down`/`cleanup --kill` without `/proc`, unchanged,
   only when a Mac or an explicit decision is available.
4. Reviews from now on (user instructions of 2026-09-18): `/grok-build:review`
   on grok-4.6 (`high`, the bridge's maximum) plus a Fable 5.1 reviewer at
   xhigh; after two rounds without completion, a Fable 5.1 xhigh rescue and
   then an Opus 5 (max) completeness review. Opus 5 (max) implements; Fable
   plans; gpt-6-astra reviews plans.
5. Any `git push` needs the user's explicit permission for that push.

## Blockers

None.

## Key files

- `skills/openmausbot-launcher/SKILL.md`: §1 routing sentence (an authoring
  request means §3 and runs no verb before the user approves the summary)
  with the third worked example; §3 the four steps; §4–§10 renumbered with
  their cross-references; §10 lists the reference. 463 lines of a 500 cap.
- `skills/openmausbot-launcher/references/team-authoring.md`: sections 1–7.
  The field tables' numbers are asserted against `LIMITS`; the skeleton is
  the file's first fenced `json` block and must keep validating with no
  errors and no warnings.
- `skills/openmausbot-launcher/scripts/lib/package.mjs`: `LIMITS`, `COLORS`,
  `ADVISORY`, `parseJsonFile`, `validatePackage`, `renderError`; every limit
  and message cites `bot-package.ts` or zod 4.4.3.
- `skills/openmausbot-launcher/scripts/lib/verbs/validate.mjs`: exit 0/2/3,
  the invalid result returned rather than thrown (the error serializer would
  drop `errors[]`), the hint scoped to `format: openmaus.package`.
- `tests/validate.test.mjs` (the `CASES` table with a `kind` per row, the
  warnings, the leak tests, the skeleton test), `tests/docs.test.mjs` (the
  routing phrases, the authoring section, the `§N` guard, the reference's
  limit rows), `tests/team.test.mjs` (import's content-free parse error).
- `docs/design.md`: the byte-identical frontmatter mirror, Decision 4, the
  "Package validation (`validate`)" subsection with the parity claim and its
  two limits, the verb-table row, the layout tree, the Sections paragraph.
- `docs/evidence.md`, the 2026-09-18 `validate` section;
  `.project-steward/DECISIONS.md` 0020 (which names the AGENTS.md Layout-line
  edit as the approved exception); `VERIFY.md` "Team package authoring".

## Tried and rejected

- A `validation` field on `import --dry-run`: `verbs/team.mjs:60` reads
  `package.agents` before the dry-run return, so a malformed file throws
  first. Dropped; `validate` is the tool.
- Summing every assigned playbook for the mount advisory: a turn mounts at
  most three matching playbooks (`installed-playbooks.ts:3`), so the three
  longest are the bound (Grok review).
- `--effort xhigh` on the grok-build bridge: refused with "Use one of: low,
  medium, high".
- Echoing Node's JSON parse message: it quotes the file's bytes, so a wrong
  file (a token file) would reach stdout. `parseJsonFile` replaces it.

## Warnings

- The frontmatter must stay byte-identical to the yaml block in
  `docs/design.md`, the SKILL.md body must never contain "README", and the
  description is 879 of 1,024 characters.
- The validator's default messages are transcribed from zod 4.4.3, and a
  file whose `format` is not `openmaus.package` is judged by this schema
  although the server sends it to another parser; both are stated in
  `docs/design.md` "Package validation". A future zod bump upstream can
  reword defaults, never paths.
- Never call `JSON.parse` on a user-named file in a verb; use
  `parseJsonFile`.
- `LIMITS` and the reference's field tables are pinned to each other by a
  test; change them together.
- Every real bot turn costs the user's subscriptions. This session spent 0
  OpenMausBot bot turns and, in host inference, two Codex plan reviews, two
  Opus implementation subagents, one Fable reviewer and one Grok Build
  review.
- A background `codex exec` under the Bash tool is capped at ten minutes;
  wait on a done marker or a monitor, and never `pgrep -f` a pattern the
  waiting loop's own command line contains.
