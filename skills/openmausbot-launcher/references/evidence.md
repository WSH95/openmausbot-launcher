# Evidence section template

## The rule

Every claim about a real run goes into an evidence file with **the command, the OpenMausBot
version, and the ids involved** (`~/Documents/agent-team-devpack/AGENTS.md`, "Spike rules";
`docs/evidence.md` in this repository). Fake-server runs are never evidence: they exercise the
driver, not the bots. Bot turns cost the user's subscriptions, so a run is recorded once, in
enough detail that nobody has to repeat it.

Ids worth naming: the bot ids and the thread ids, the run id and its `oml:` tag, the server pid
and data dir, the commit shas, the bead id, any request id from an approval card.

## What `report --md` emits

`omb report --md` (add `--check-042` on a dev-team pack validation) prints the section ready to
paste (`scripts/lib/report.mjs:100-112`). Its shape, field by field:

```
## <date> — <title> (<result>)

Run <runId>, tag <tag>, OpenMausBot <version>, lead <lead> (<model>), project <dir>,
dispatched <sentAt> from <sha7>; final state <state>.

| Thread | Turns | Bot seconds | Input | Cached | Output |
|---|---|---|---|---|---|
| <bot> | <n> | <n> | <n> | <n> | <n> |

Outcomes: <n> (<kind> <name>, …). Commits since dispatch: <n> (<sha7> <subject>; …).

Record step: task log yes|no|unknown, record commit <sha7>|none, <bead detail>.
Tests: passed in <n> s | FAILED (exit <n>) | <why it did not run>. Root: clean | <problems>.

0.4.2 checks:

- <check id>: yes|no|unknown — <detail>

Closing report from <lead>: "<the lead's last text, whitespace collapsed, first 400 chars>"
```

Where the numbers come from: `date` and `result` from the run's close; the run line from the
state file and `/.well-known/openmausbot/environment`; the table from `events/<thread>.ndjson`
in the data dir, one row per run thread, counted from the dispatch time on
(`scripts/lib/report.mjs:17-33`); outcomes from the lead's thread; commits from `git log
<sentSha>..HEAD`; the record line from the commits, the task log, and `bd show <id> --json`;
the checks from the lead's `native/<thread>.ndjson` plus git and the test run; the closing
quote from the lead's last own message. `result` is `passed`, `incomplete`, or `failed`.

The `0.4.2 checks` block appears only with `--check-042`. A check reading `unknown` is not a
pass: say in prose why the evidence was missing.

## What to add by hand

The driver reports what it can read. Everything below is the operator's:

- **The roster actually bound**: engine, model, and effort per bot, and why. `bind` prints a `roster` line; `report` names only the lead's model. Say when a roster is the user's instruction for a particular test rather than the guide's advice.
- **The task and its bead**: the TODO item or bead id, the repository's baseline (sha, test count, clean tree) before the dispatch, and the data dir and port of the server used.
- **The brief, verbatim**, including the run-marker paragraph the driver appends. It is in the state file under `task.brief`.
- **Wall-clock times**: request to closing report, time spent waiting for the user's answer, the number of wakes and delegation receipts. `report` gives bot seconds, which is a different number.
- **Deviations**: anything the lead or a teammate did that the playbook does not describe, with the time and the actor, and whether it changed the outcome. The 0.4.1 entry's numbered deviations list is the model; three of them became the 0.4.2 wording release.
- **Operator interventions during the run**: a commit on the default branch, a facts patch between tasks, an interrupt, a hook that fired inside a bot's session.
- **What the driver could not verify**: every `unknown` check and its cause, a stopped task's leftover worktree and branch, sandbox process groups found and killed afterwards, and rules that were simply not exercised ("not exercised" rows are worth keeping).
- **A verdict line**: what the run establishes and what it does not.

Match the tone of the existing entry in `docs/evidence.md`: a **Question** line, a setup
paragraph with versions and ids, a table of what happened, a **Conclusion** line, and the path
to the logs. Plain past tense, no adjectives, numbers instead of impressions.

## Where it goes

- **This repository's `docs/evidence.md`**, one `##` section per run, appended in run order (the devpack's `EVIDENCE.md` is ordered the same way). Heading: `## <date> — <what was tested>` with the bead id when a bead drove it.
- **A pointer section in `~/Documents/agent-team-devpack/EVIDENCE.md`** when the run validates the pack — a 0.4.2 validation does. Keep it short: the release, the repository, the roster, the result, and the path to the full record here. The detail lives in one place.
- The dev pack's evidence file is the precedent for both: `~/Documents/agent-team-devpack/EVIDENCE.md`, section "2026-09-07: pack 0.4.1 validation", which pairs a per-task timeline table with a rule-by-rule table and a deviations list.
- The launcher's planned validation run is described in `docs/design.md`, "Real run = the 0.4.2 pack validation" (bead `atw-yyd.9`); its record is the first entry that will carry a `0.4.2 checks` block.

Unverified: no `report --md` section has been written from a real run yet, so the rendered
shape above comes from the renderer's source, not from a published entry.
