# Writing a team package

The format, limits, interview, summary template and skeleton for writing a
team package with the user — the file `omb import` sends and `omb validate`
checks. The user may call it a team profile, a roster or a new team.

Source lines point at the pinned read-only clone
(`~/.cache/agent-team/openmausbot-src`, `server/` unless another directory
is named), OpenMausBot 0.1.56. Operating advice comes from this repository's
`docs/evidence.md` and the dev pack; it is named where it is used and kept
apart from what the server enforces (section 4).

## 1. What a package is

One JSON document: `{"format": "openmaus.package", "version": 1, "package":
{…}}` (`bot-package.ts:8-9,41-42`). The convention is to name the file
`<id>.openmaus.json`, but the server decides by the `format` field alone
(`bot-package.ts:133-137`), so the name is for the user, not for the import.

What the import does with it (`index.ts:9192-9328`):

- Every agent becomes a **new** bot with a fresh id; a name already taken is
  numbered ("Atlas 2"), hidden bots counted (`index.ts:9209-9212`).
- The bots' section is the package `name`, itself numbered on a collision
  (`index.ts:9217-9228`), which is what `import --adopt "<section>"` later
  names.
- `agents[].description` becomes the bot's instructions and
  `agents[].title` its role line (`bot-package.ts:272-284`).
- `chiefOfStaff` names a package key, and that bot becomes the chief — the
  lead the launcher talks to (`index.ts:9299-9301`).
- Rooms are created from package-local keys normalised to the fresh ids,
  with the bulletin and the default responder applied
  (`index.ts:9271-9284`); routines are created **disabled**
  (`index.ts:9285-9291`).
- A bot's playbooks are installed in that same pass (`index.ts:9248-9254`)
  and no bot route writes them afterwards: an installed playbook cannot be
  edited, so a rule that may change belongs in a bot's instructions, and a
  playbook change means a new release and a new import.

What it cannot carry: unknown fields are stripped, and the parser says why —
"ids, grants, credentials, paths, model selections, and runtime state
therefore cannot ride through the package boundary"
(`bot-package.ts:164-166`). So no engine, model, effort, approval level,
working folder or peer setting is ever in the file; they are `omb bind` and
`omb facts` flags after the import (section 7). A field under the wrong key
is dropped just as silently, which is why `validate` warns about every key
the schema does not declare.

Import is additive: a second import of the same file is a **second team**,
with new ids, its own numbered section and none of the first team's
conversations or memory (`index.ts:9152-9156`). Writing the file costs
nothing; importing it is the user's call.

## 2. The format, field by field

Text fields are trimmed before they are measured; a required one refuses an
empty or whitespace-only value ("is required") and an over-long one says "is
too long" (`bot-package.ts:25-26`). An optional text field accepts `null` or
a missing key, and a blank string means the same as absent
(`bot-package.ts:28-33`). A key is `^[a-z0-9][a-z0-9_-]*$`
(`bot-package.ts:35-37`).

**Root**

| Field | Required | Type | Limit | Source |
|---|---|---|---|---|
| `format` | yes | the literal `openmaus.package` | — | `bot-package.ts:41` |
| `version` | yes | the literal `1` | — | `bot-package.ts:42` |
| `package` | yes | object | — | `bot-package.ts:43` |

**`package`**

| Field | Required | Type | Limit | Source |
|---|---|---|---|---|
| `id` | yes | lowercase slug `^[a-z0-9][a-z0-9-]*$` | ≤ 80 | `bot-package.ts:44` |
| `release` | yes | `MAJOR.MINOR.PATCH` | ≤ 30 | `bot-package.ts:45` |
| `name` | yes | text; becomes the section | ≤ 100 | `bot-package.ts:46` |
| `tagline` | yes | text, one line | ≤ 160 | `bot-package.ts:47` |
| `summary` | yes | text, a paragraph | ≤ 2000 | `bot-package.ts:48` |
| `category` | yes | text | ≤ 80 | `bot-package.ts:49` |
| `author` | yes | `{name, url?}` | name ≤ 100, url ≤ 500 | `bot-package.ts:50` |
| `license` | yes | text | ≤ 80 | `bot-package.ts:51` |
| `featured` | no | boolean | — | `bot-package.ts:52` |
| `tags` | no | text[] | ≤ 30 entries, each ≤ 80 | `bot-package.ts:53` |
| `outcomes` | yes | text[]: what the team finishes | 1–12 entries, each ≤ 240 | `bot-package.ts:54` |
| `setupMinutes` | yes | integer | 1–240 | `bot-package.ts:55` |
| `requirements` | yes | `{apps, capabilities, platforms?}` | apps ≤ 30, capabilities ≤ 20 each ≤ 80, platforms ≤ 10 each ≤ 80 | `bot-package.ts:56-64` |
| `agents` | yes | object[] | 1–200 | `bot-package.ts:66-77` |
| `chiefOfStaff` | no | one `agents[].key` | ≤ 64 | `bot-package.ts:78` |
| `rooms` | no | object[] | ≤ 30 | `bot-package.ts:79-89` |
| `routines` | no | object[] | ≤ 50 | `bot-package.ts:90-112` |
| `playbooks` | no | object[] | ≤ 80 | `bot-package.ts:113-119` |
| `examples` | no | object[] | ≤ 12 | `bot-package.ts:120-124` |

**`requirements.apps[]`** — the connected apps the team needs, for the
user's eyes; the import records them on each bot and grants nothing.

| Field | Required | Type | Limit | Source |
|---|---|---|---|---|
| `slug` | yes | key | ≤ 64 | `bot-package.ts:58` |
| `label` | yes | text | ≤ 100 | `bot-package.ts:59` |
| `reason` | yes | text | ≤ 240 | `bot-package.ts:60` |
| `optional` | no | boolean | — | `bot-package.ts:61` |

**`agents[]`** — one entry per bot.

| Field | Required | Type | Limit | Source |
|---|---|---|---|---|
| `key` | yes | key, unique in the package | ≤ 64 | `bot-package.ts:35,67` |
| `name` | yes | the bot's display name | ≤ 100 | `bot-package.ts:68` |
| `title` | no | free text; the only role concept the format has | ≤ 200 | `bot-package.ts:69` |
| `description` | no | the bot's instructions | ≤ 4000 | `bot-package.ts:70` |
| `appearance.color` | yes | one of green, blue, red, orange, purple, cyan, pink, yellow, teal, coral | — | `bot-package.ts:12-23,72` |
| `appearance.mascotExpression` | no | text | ≤ 80 | `bot-package.ts:73` |
| `appearance.mascotBody` | no | text; one of cursor, blob, circle, squircle, capsule, drop, shield, hexagon, diamond, star | ≤ 40 | `bot-package.ts:74` |
| `playbooks` | no | `playbooks[].key`[] | ≤ 40 entries | `bot-package.ts:76` |

`description` is optional to the schema and is the whole of what the bot
knows about its job, so a bot whose text sits under another key — say
`instructions` — imports mute: the key is stripped and nothing says so
(`bot-package.ts:164-166`). `mascotBody` is validated here as text of any
content; at import a value outside the ten body ids silently becomes
`cursor` rather than failing the import (`shared/mascot-bodies.ts:20,41,128`,
`server/team-manifest.ts:256-261`).

**`rooms[]`** — a shared log, not where work starts.

| Field | Required | Type | Limit | Source |
|---|---|---|---|---|
| `key` | yes | key, unique | ≤ 64 | `bot-package.ts:80` |
| `name` | yes | text | ≤ 100 | `bot-package.ts:81` |
| `members` | yes | `agents[].key`[], no duplicates | 1–200 entries | `bot-package.ts:82` |
| `bulletin` | no | text pinned in the room | ≤ 12000 | `bot-package.ts:83` |
| `defaultResponder` | yes | `{"kind":"agent","agent":<key>}`, `{"kind":"everyone"}` or `{"kind":"mentions"}` | — | `bot-package.ts:84-88` |

**`playbooks[]`** — reviewed process text mounted into a matching turn.

| Field | Required | Type | Limit | Source |
|---|---|---|---|---|
| `key` | yes | key, unique | ≤ 64 | `bot-package.ts:114` |
| `name` | yes | text | ≤ 100 | `bot-package.ts:115` |
| `summary` | yes | text | ≤ 300 | `bot-package.ts:116` |
| `triggers` | yes | the words that mount it, matched in the job text | 1–30 entries, each ≤ 100 | `bot-package.ts:117` |
| `instructions` | yes | the playbook body | ≤ 24000 | `bot-package.ts:118` |

**`routines[]`** — scheduled prompts, created disabled.

| Field | Required | Type | Limit | Source |
|---|---|---|---|---|
| `key` | yes | key, unique | ≤ 64 | `bot-package.ts:91` |
| `name` | yes | text | ≤ 80 | `bot-package.ts:92` |
| `agent` | yes | one `agents[].key` | ≤ 64 | `bot-package.ts:93` |
| `prompt` | yes | what the bot is asked | ≤ 20000 | `bot-package.ts:94` |
| `runOn` | yes | `maus` or `cloud` | — | `bot-package.ts:95` |
| `schedule` | yes | one of the three shapes below | — | `bot-package.ts:96-108` |
| `durationMinutes` | yes | integer | 5–240 | `bot-package.ts:109` |
| `timeoutMinutes` | no | integer | 5–240 | `bot-package.ts:110` |
| `enabledAfterInstall` | yes | the literal `false` | — | `bot-package.ts:111` |

| Schedule | Fields | Source |
|---|---|---|
| `{"type":"once", …}` | `at`: an integer epoch in milliseconds, with no range of its own — only JavaScript's safe-integer bound applies | `bot-package.ts:97` |
| `{"type":"daily", …}` | `time`: `HH:MM` (≤ 5 characters); `weekdays`: 1–7 integers, each 0–6 | `bot-package.ts:99-101` |
| `{"type":"interval", …}` | `everyMinutes`: 5–1440; `anchorAt`: an epoch 0–8640000000000000 | `bot-package.ts:104-106` |

**`examples[]`**

| Field | Required | Type | Limit | Source |
|---|---|---|---|---|
| `title` | yes | text | ≤ 120 | `bot-package.ts:121` |
| `input` | yes | text | ≤ 4000 | `bot-package.ts:122` |
| `output` | yes | text | ≤ 8000 | `bot-package.ts:123` |

**Cross-references.** They run only after the schema accepted the whole
document, and the server throws the first one it reaches
(`bot-package.ts:169-205`), in this order: duplicate keys among agents, then
playbooks, rooms and routines (`Duplicate agent key: sudo`); an unknown
chief (`Unknown Chief of Staff: nobody`); an agent's unknown playbook
(`Agent sudo references unknown playbook: missing`); per room, a duplicate
member (`Duplicate member in room dev-room key: sudo`), an unknown member
(`Room dev-room references unknown agent: ghost`) and a default responder
who is not a member (`Room dev-room has an unknown default responder`); and
a routine's unknown agent (`Routine r references unknown agent: ghost`).

A schema failure is reported as one issue, `<path> <message>`
(`schema.ts:14-19`) — `package.agents.0.key may only contain lowercase
letters, numbers, - and _`. `omb validate` prints every issue it finds and
puts the server's one first (section 7).

## 3. The interview

One question per message, in this order. Each names why it matters and what
it decides; offer the options with a recommendation, and keep the user's own
words for the summary and the file.

1. **What work should this team do, and who is it for?** Everything else
   follows from the answer. Decides `summary`, `tagline`, `category` and the
   audience the instructions are written for. Ask for an example task the
   user would hand the team tomorrow.
2. **What does finished look like?** Decides `outcomes` (1–12 lines) and the
   lead's closing report. "A merged pull request with a review", "a release
   note checked against the commits", "a weekly digest in my inbox".
3. **Which roles does the work need?** Decides how many `agents[]` entries
   and each `title`. Offer the shape the work implies — for review work a
   planner, an implementer and a reviewer; for writing work a writer and a
   checker — and recommend the smallest roster that covers the loop, since
   every bot is a subscription turn.
4. **Which bot do you talk to?** Decides `chiefOfStaff` and how the team is
   driven: one lead the user talks to, and every other bot reached only by
   that lead. Recommend a dedicated lead that does no production work
   itself.
5. **When should the team stop and ask you?** Decides the lead's stop rules,
   written into its instructions in plain words ("ask me before a dependency
   is added"), and, outside the file, `bind --approval auto|ask`. Recommend
   `auto` with explicit stop rules for routine work and `ask` while the user
   is still learning what the team does.
6. **What may the bots touch?** Decides `requirements.capabilities` and
   `requirements.apps` inside the file, and the working folder outside it
   (`bind --project <dir>`). Name the repository or folder the team will
   work in.
7. **What already exists?** Decides whether to write a package at all. A
   software team is usually the dev-team pack (`references/dev-team.md`) —
   import it rather than rewrite it. An existing package the user wants
   changed is a copy with a new `id` and `release`, not an edit of an
   imported team. Otherwise start clean.
8. **Which engine CLIs are installed and logged in?** Decides the `bind`
   commands you hand back, and warns the user that a Grok bot has no auto
   approval level and will raise a card per tool call.
9. **Where should the file live, and what is the team called?** Decides the
   path (default `<project>/<id>.openmaus.json`), `name`, `id` and
   `release` (`0.1.0` for a new team).

Rules: one question per message; on a phone at most three short options;
stop as soon as nothing load-bearing is open; never guess a load-bearing
answer; never ask what this reference already decides (the keys, the ten
colours, the JSON shape).

## 4. What the server enforces, and what the evidence recommends

Keep these apart when you talk to the user: the first list is the format and
the runtime, the second is advice that a user may refuse.

**Enforced.**

- Chains are one hop (`MAX_COMMS_DEPTH = 1`, `index.ts:569`,
  `references/limits-and-pitfalls.md`): a specialist running a delegated
  turn has no peer tools, so the roster is a star around one lead and every
  answer returns to it.
- An installed playbook cannot be edited: the import is the only writer
  (`index.ts:9248-9254`) and no bot route takes `playbooks`. A rule change
  is a new release and a new import.
- A bot's question card dies with its turn (`contracts.ts:162`,
  `index.ts:2116-2126`), so a bot that must ask the user asks in plain text
  in the lead's chat, and the instructions say so.
- A turn mounts at most three matching playbooks, within 24,000 rendered
  instruction characters (`installed-playbooks.ts:3-4`); anything past that
  is cut.
- The room is a log with a budget of two unanswered bot posts per five
  minutes (`room-post-budget.ts:89-90`). A task never starts there.
- The lead is woken at most three times in five minutes and a fourth
  delegation outcome in that window is dropped (`delegations.ts:680-681`).
- A Grok bot has no auto approval level (`store.ts:1303-1335`): `bind`
  leaves it on `ask` and every tool call raises a card.
- Routines ship disabled (`index.ts:9285-9291`); the user enables them.
- A description over 4,000 characters is a 400 at import, not a truncation
  (`bot-package.ts:70`).

**Recommended, with the reason and the cost.** Offer these; do not impose
them.

- Give each bot a title that carries its role word. The lead picks
  teammates by title, and `bind --reviewers` applies the reviewer model to
  every bot whose title or name matches `/review/i`
  (`scripts/lib/team.mjs:21`). Cost: none.
- Put a rule in a bot's instructions rather than in a playbook when it may
  change, because instructions can be patched later and an installed
  playbook cannot. Cost: the rule is in every turn, not only matching ones.
- Keep the lead's description at 3,900 characters or less **when the
  launcher's `facts` verb will fill its `Project facts` block**, which
  replaces everything from the marker to the end and refuses at 4,000
  (`scripts/lib/verbs/team.mjs:262`). Without that block the whole 4,000 is
  available.
- Keep a specialist's instructions under 1,000 characters **only when the
  agreed workflow has the lead recreating specialists with `create_bot`**,
  which refuses longer instructions (`index.ts:8201-8203`). Otherwise the
  4,000 of an imported bot is the budget.
- One implementer per task the user wants to run at the same time: an open
  run claims an idle implementer, and a second parallel run needs a second
  one.
- Reviewers on the strongest model available, and the planner and the plan
  reviewer on different engines. Evidence: `references/dev-team.md` — on
  2026-09-07 a Codex reviewer at xhigh reproduced two real P1 bugs where
  four earlier Sonnet reviews had found nothing. Cost: about six times the
  wall time.
- The user's installed engines and budget decide all of this, and none of it
  is in the file: model bindings come from the caller (`docs/design.md`,
  Decision 4), so they land in the `bind` line you hand back.

## 5. The understanding summary

Send this before anything is written, filled in, in plain language, under a
screen. Anything but a clear yes is a change request: fix that part, send
the summary again, and wait.

```
Team: <name> — <one line: what it is for>

Purpose, in your words: "<the user's own sentence>"

It does: <two or three lines>
It does not: <the boundaries the user drew>

Roster
| Bot | Title | What it does | Reports to |
|---|---|---|---|
| <name> | <title> | <one line> | you / <the lead> |

How the lead works
1. <step>
2. <step>
(at most six lines)

It stops and asks you when: <the stop rules, in the user's words>

Rooms and playbooks: <the room and who answers in it; the playbooks, or none>

Outside the file, as flags after the import:
- engine, model, effort per bot → omb bind --default … --reviewers …
- approval level → --approval auto | --approval-for <bot>=ask
- the project folder → omb bind --project <dir>
- the test command and the other facts → omb facts --test "…" …

Assumptions I made: <each one, or "none">
Open points: <what is still undecided, or "none">

Reply yes to write it, or tell me what to change.
```

## 6. Writing the file

- `id` is a lowercase slug and names the file: `<id>.openmaus.json`.
  `release` starts at `0.1.0`. Keys are short and lowercase (`lead`,
  `writer`); `name` is what the user will type at the bot ("Atlas");
  `title` is the role word.
- Colours are one of green, blue, red, orange, purple, cyan, pink, yellow,
  teal and coral. Give the lead one colour and the specialists others; no
  two bots the user must tell apart share one.
- Each bot's `description` is its whole job, in five parts: the role in one
  line; what it receives; what it produces; when to stop and report; what it
  must never do. Up to 4,000 characters — and under 1,000 only when the
  agreed workflow has the lead recreating specialists with `create_bot`.
- The lead's `description` adds the loop (read the request, delegate one
  step at a time, collect the result, report) and ends with the facts block
  the launcher fills:
  `Project facts (edit me): default branch: main. Test command: <fill in>. …`
  Everything from `Project facts` to the end is replaced by `omb facts`, so
  nothing the bot needs goes after it.
- Rooms: one, with every bot as a member and the lead as
  `defaultResponder`, so a stray message in the room reaches the lead
  instead of waking everybody.
- Playbooks: none unless the same process text is needed by several bots and
  will not change.

A complete minimal package — a lead, two specialists, one room, no playbook
— that `omb validate` accepts with no errors and no warnings:

```json
{
  "format": "openmaus.package",
  "version": 1,
  "package": {
    "id": "release-notes-team",
    "release": "0.1.0",
    "name": "Release notes team",
    "tagline": "A lead who turns merged work into release notes, with a writer and a checker",
    "summary": "Three bots for one job: the lead reads the merged commits since the last tag, hands the writer a list of user-visible changes, has the checker verify every line against the repository, and reports the finished notes in its own chat.",
    "category": "engineering",
    "author": { "name": "wsh" },
    "license": "MIT",
    "outcomes": ["Release notes for one milestone, every line checked against the merged commits"],
    "setupMinutes": 5,
    "requirements": {
      "apps": [],
      "capabilities": ["shell", "git", "files"],
      "platforms": ["ubuntu"]
    },
    "agents": [
      {
        "key": "lead",
        "name": "Atlas",
        "title": "Team Lead",
        "description": "You are the user's only point of contact for release notes.\n\nLoop, one task at a time: read the request; check the repository is on its default branch and clean; collect the merged commits since the last tag with git log; delegate the draft to the Notes Writer with that list, the milestone name and the audience verbatim; delegate the finished draft to the Notes Reviewer; send one round back when the review asks for changes, at most two; then write the notes to the file the user named and report in this chat.\n\nStop and ask the user in plain text, never with a question tool, when: the commit list is empty or does not reach the last tag; a change is user-visible but nobody can say what it does; the reviewer and the writer disagree twice; or the user asked for a file that already exists. Say what you found and what you would do.\n\nNever push, never tag, never edit code. One teammate at a time; every hand-off comes back to you.\n\nProject facts (edit me): default branch: main. Test command: <fill in>. Setup command (run once in each new worktree): none. Merge policy: ask. Task log: none. Task tracker: none. Plan review: ask.",
        "appearance": { "color": "blue" }
      },
      {
        "key": "writer",
        "name": "Juno",
        "title": "Notes Writer",
        "description": "You draft release notes from a commit list the Team Lead hands you.\n\nInput: the milestone, the audience, and the merged commits. Output: one Markdown section per user-visible change, in the audience's words, with the commit it came from in brackets. Leave out refactors, test-only changes and dependency bumps unless the lead marked them user-visible.\n\nRead the repository to check what a commit actually changed; never invent a feature a commit does not show. Stop and report to the lead when a commit's effect cannot be read from the repository.",
        "appearance": { "color": "green" }
      },
      {
        "key": "checker",
        "name": "Cairn",
        "title": "Notes Reviewer",
        "description": "You check a release-notes draft against the repository, read-only.\n\nFor each line: the change exists in the named commit, the description matches what the code does, and the wording suits the audience. Report one verdict — ready, or needs work with the lines to fix and why. Never rewrite the draft yourself and never change a file; the verdict goes back to the Team Lead.",
        "appearance": { "color": "purple" }
      }
    ],
    "chiefOfStaff": "lead",
    "rooms": [
      {
        "key": "notes-room",
        "name": "Notes Room",
        "members": ["lead", "writer", "checker"],
        "bulletin": "One closing report per milestone. Tasks start in the lead's own chat, never here.",
        "defaultResponder": { "kind": "agent", "agent": "lead" }
      }
    ]
  }
}
```

## 7. After the file

```
omb validate <file>
```

No server, no project, no state, no lock: it reads the file and judges it as
an `openmaus.package`. Exit 0 with `valid: true`, `errors: []`, the
`warnings` and a `summary` of keys, names, titles and lengths — never a
prose field, since the output is printed. Exit 3 when the document parses
but the server would refuse it: `errors[]` in the server's own order, with
`errors[0]` the one its 400 would carry, rendered `<path> <message>` for a
schema issue and as the message alone for a cross-reference. Exit 2 for a
missing argument, an unreadable path, a BotMRR Markdown document (the app
imports those; this launcher imports JSON), or a file that is not JSON —
reported without quoting the file, because it may be the wrong one. Fix
`errors[0]` first, then validate again.

`warnings[]` never changes the exit code and is the launcher's own advice:
a key the schema does not declare (the server drops it, so the text is
lost), no `chiefOfStaff`, a chief whose description has no `Project facts`
marker or is over 3,900 characters with one, a specialist's description over
`create_bot`'s 1,000 characters, playbooks assigned to one bot that total
more than 24,000 instruction characters, and a file name that does not end
in `.openmaus.json`. Treat a dropped-field warning as an error: it is text
the user will lose.

Then hand the user the path and the commands their answers imply, and let
them decide when to import:

```
omb import <file> --project <dir>
omb bind --project <dir> --default <engine/model[/effort]> [--reviewers <engine/model/effort>] [--approval auto]
omb facts --project <dir> --test "<test command>" --setup none --merge ask
```

`import` creates the bots and is the only irreversible step; a re-import of
a changed file is a new numbered team, so a change after the import means a
new `release` and a fresh import, and retiring the old team is the user's
own step — the launcher never deletes a bot. `bind` gives the team this
project's folder, the engines and the approval level, and refuses while a
bot is working; `facts` fills the lead's `Project facts` block.
