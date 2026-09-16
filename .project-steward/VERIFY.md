# Verification

Run the relevant checks before marking work as verified in `HANDOFF.md`.

| Check | Command | Expected |
| --- | --- | --- |
| Build | `none` | exits 0 |
| Tests | `npm test` | all pass |
| Lint | `none` | clean |

## v2 pass, phase 4 (2026-09-16)

Worktree clean at `5b50770`. `npm test`: **221 passed, 0 failed, 0 skipped**
(198 before the phase; 23 new: doctor cause, fake pairing, `pair`, the
environment-id binding, the hints, the lock reservation). `git diff --check`
clean. Codex `gpt-5.6-sol` reviews: one P1 on the first four commits (lock
taken after the exchange) and three P2 on the fix round (lock wait, port
inference, `--allow-insecure-http` hint), all fixed test-first; a final
scoped re-review of `3b6dce0` closed the loop. Real-run checks:
`docs/validation/2026-09-16-remote-tailscale.json` parses; both sessions
revoked; the tailscale serve config is empty; ports 8899/8900 closed.

## v2 pass, phases 0-3 (2026-09-16)

Node v24.11.0, worktree clean at `25fada3`. `npm test`: **198 passed, 0
failed, 0 skipped** (58 s) on both commits of the pass so far (`246ec66`
docs note, `25fada3` host records); `git diff --check` clean; SKILL.md 230
lines (cap 500). Real-run checks: `docs/validation/2026-09-16-hosts-v2.json`
parses; the three OMB turns are in the fixture data dir's
`events/86905161-06df-4cbd-9e6c-89eaadeae032.ndjson`; the fixture server was
stopped with `down` (ports 8899/8900 closed); the package hash is unchanged
(`48e4ac63…3255949`).

## M1 fix pass (2026-09-08)

Node v24.11.0, worktree clean at `02e7945`. `npm test`: **198 passed, 0
failed, 0 skipped** (~52-57 s; 154 before the pass). `node --test
tests/docs.test.mjs tests/size.test.mjs`: 4/4. `git diff --check`: clean.

One flake was observed during the pass and then fixed on the user's
instruction as `oml-oqo` (commit `02e7945`), outside the 26 findings:
`tests/dry-run.test.mjs` "watch --dry-run --nudge neither checkpoints nor
sends" failed in 2 of 6 full-suite runs on a loaded machine with
`error: "observation deadline reached"` instead of `checkpointed: false`.
The cause was a real driver defect: `withinDeadline` floored the remaining
budget, so under a millisecond left already read as spent, while
`watchRun`'s `expired()` compared raw times and still called it live; in
that window the guarded stream wait rethrew and `watch` exited 1 with a
hintless error instead of exit 4. `outOfBudget` is now the single predicate
both ask. A sweep of 19 deadlines across the window reproduces the old
behaviour 12-16 times with no load, and passes 19/19 after the fix.

Fix commits, one per finding (test first, Conventional Commit):

| Finding | Bead | Commit |
|---|---|---|
| 26 | `oml-nqo.30` | `ddcafb5` fix(session): report a blocked network as "cannot reach <url>" with a hint per cause |
| 24 | `oml-nqo.28` | `0da606c` fix(lifecycle): find the sandbox listen signature anywhere in serve.log and name the line |
| 23 | `oml-nqo.27` | `a868593` fix(lifecycle): refuse a port whose webhook neighbour is taken and name a receiver port |
| 25 + 9 | `oml-nqo.29`, `oml-nqo.9` | `f911c9a` fix(state): resolve info/exclude through git and add the entries on import --adopt |
| 1 | `oml-nqo.1` | `967cef3` feat(state): register the state --show verb |
| 22 + 13 | `oml-nqo.26`, `oml-nqo.13` | `c37ad2b` feat(bind): per-bot --approval-for and --peer-approval; roster never prints undefined |
| 11 | `oml-nqo.11` | `221ce8f` fix(run): merge the watch checkpoint over lastEval and drop the interrupt lock |
| 21 | `oml-nqo.25` | `880a8e4` fix(status,report): report the carried flag |
| 8 | `oml-nqo.8` | `d8fa972` feat(send): report duplicate deliveries and add --again |
| 12 | `oml-nqo.12` | `17d692a` fix(down): name the live pids and the manual recovery when the record no longer verifies |
| 14 | `oml-nqo.14` | `f388119`, `aec95ab`, `4aeb9f2`, `e35107d`, `4497f05` (up data dir, defaultBranchSource, receiptsWatched, fsynced state write, project.dir under --state) |
| 6 | `oml-nqo.6` | `aa6e253` feat(report): read a Codex lead's native log for the 0.4.2 checks |
| 7 | `oml-nqo.7` | `10788a2` fix(fake): clamp the message page limit to 200 like pageSize() |
| 10 | `oml-nqo.10` | `406944c` fix(facts): take test and setup commands only from the operator; time out bd show |
| 15 | `oml-nqo.15` | `99ec501` test(helpers): remove temp dirs at exit and strip ambient OMB_* from the driver env |
| 16 | `oml-nqo.16` | `481b79b`, `26b9ed6`, `2c68579`, `d3f8443`, `996b1db`, `7d7838c`, `80e3420` (cli, insecure-http, remote status, SSE, config, git, dead code) |
| 17 | `oml-nqo.17` | `8706b97` docs(lib): refresh stale step comments and the echo-prefix citation |
| 19 | `oml-nqo.19` | `8d699d5` docs(evidence): record the stray codex-linux-sandbox kill |
| 20 | `oml-nqo.20` | `070e274` docs(evidence): M1 fix pass, full-team validation T13 on the slugkit clone |
| 18 | `oml-nqo.18` | `6f0cd58` docs: resolve the M1 review's document drift |

Findings 2, 4 and 5 closed on the tier 2/3 evidence with no code; finding 3
on tier 3 plus T13.

T13 (real OpenMausBot 0.1.56, the user's five-model roster, Codex lead): run
`6b0b7b17800c3d64`, incomplete, 9 turns (Sudo 5, Sage 1, Vale 1, Nova 1,
Quill 2 1), 16 min 38 s dispatch to DONE, 7 Grok cards allowed once,
`--check-042` 8/9 with the native-log checks scored from the Codex JSON-RPC
log (`worktree-after-approval` unknown: the reviewer's verdict line was
ambiguous, not a parser failure), merge `--ff-only` at `0918e0e`, record
commit `d85cae5`, clone tests 85 OK (75 before), `cleanup --kill` found no
orphan, `down` verified (pids gone, 8899 and 8900 refuse), package SHA-256
unchanged. Record: `docs/evidence.md` "M1 fix pass, full-team validation"
and `docs/validation/2026-09-08-fix-pass-t13.json`. Devpack: `EVIDENCE.md`
pointer committed as `ab94d6d`; nothing under `packages/` touched. Stray pid
426150 killed and recorded. No push.

## M1 review checkpoint (2026-09-08)

Independent review and test of M1 at HEAD `b1a1f77` (Beads epic `oml-nqo`,
plan `~/.claude/plans/based-on-the-development-lucky-shell.md`). This section
records all four tiers. Tiers 0 and 1 were free; Tier 2 ran against real
OpenMausBot 0.1.56 with zero bot turns; Tier 3 spent 5 Sudo turns and 1 Sage
turn. No source, test or reference file was changed by any tier. The review
write-up is `docs/review/2026-09-08-m1-review.md`.

### Tier 0 — suite and static checks

Node v24.11.0, worktree clean. `npm test`: **154 passed, 0 failed, 0 skipped**,
`duration_ms 50994.86` (51.2 s wall). `node --test tests/snapshot.test.mjs`:
**5/5**, 3.444 s. `git diff --check`: clean.

Static checks, all as expected: the four usage probes (`omb`, `omb bogus`,
`omb doctor --bogus`, `omb state --show`) each exit 2; the verb list holds
**15** names with no `state` verb, confirming finding 1. The supplied
dev-team package hashes to `48e4ac63…3255949`, unchanged. Both `sha256sum -c`
manifests from `docs/validation/2026-09-08-m1-hosts.json` verify: 2/2 source
files and 6/6 host transcripts under `/tmp/oml-m1-hostcheck-VslL6s/logs` are
byte-identical to their recorded digests. `grep -c '"watch"'` on that file is
**0**, confirming finding 2 (no `watch` invocation was ever evidenced).

Leaked temporary directories (finding 15): **2,864** `/tmp/oml-*` directories
existed before the run — exactly the count the review recorded — and **3,010**
after, so this suite run leaked **146** more. Nothing under `/tmp` that this
session did not create was deleted.

### Tier 1 — scripted end-to-end against the fake server

21 scripted steps, **211 assertions, 209 ok, 2 deviations**, across 78 driver
invocations, with `OMB_BIN` pointing at `tests/fixtures/fake-omb.mjs`,
`OMB_TOKEN` empty and every ambient `OMB_*` variable unset. Fake-server runs
are not evidence, so this stays here and not in `docs/evidence.md`.

Verified end to end: `doctor` (5 checks) and `doctor --server` (10 checks,
engines available, no provider keys in the server's environment, identity ok);
`up` in dry-run, `--fresh`, attach-again and refuse-while-owned forms, with the
health pid proven to be the supervisor's child through `/proc` and
`ANTHROPIC_API_KEY` and `OMB_TOKEN` proven absent from the server's environment;
`import`, `import --dry-run`, `import --adopt` into a second project
(`owned:false`); `bind` (Quill skipped for auto because a grok bot has no auto
approval level, exclude entries added exactly once, a repeat changes nothing);
`facts`; `task` dispatch, refusal while open, and `--resume --dry-run`;
`status` in plain, `--brief` and `--tail` forms; `watch` in its timeout,
`--quiet-if-unchanged`, `--dry-run`, stalled, `--nudge`, needs-user,
polling-only and done paths; `send` dedupe, queueing while busy, the 409
stale-thread refusal that retargets nothing, and the legacy-`.omb/lock`
refusal; `answer` for approval, question, dead and connector requests;
`interrupt` including busy-elsewhere; `reconcile` including `--remove` and its
dry run; `cleanup` including a real `--kill` (SIGTERM) of a genuine orphan;
`report` in `--dry-run`, `--md`, no-open-run and `--run last` forms; and
`down`, restart, and the post-`newEnvironment` refusal. Every `--dry-run`
left the state file's md5 unchanged.

Deviations from the plan's expectations, both reproduced in two independent
runs:

1. `watch --nudge` exits **6** (stalled), not the 4 the plan predicted. This is
   a plan error, not a defect: `lib/watch.mjs:165-172` forces `running` only for
   the iteration that nudges, the loop re-evaluates, the lead is still silent,
   and `:176` breaks on the terminal `stalled` state, whose exit code is 6
   (`lib/snapshot.mjs:261`). The repository's own test (`tests/watch.test.mjs:118-119`)
   asserts only `nudged` and the single `status?` message, never an exit code.
   The substance passed: one nudge, exactly one `status?`, never a second.
2. `status` never emits a `carried` field. The carried verdict itself works —
   `state` is `done` and `reasons[0]` is "from the last watch: done" — but
   `lib/verbs/run.mjs:39` computes `carried: true` and `:42` drops it when
   assembling the result (`lib/verbs/report.mjs:46` does the same). Filed as
   `oml-nqo.25`, severity low.

Findings confirmed by direct observation: 8 (an identical resend returns the
same `messageId` with no `duplicate` flag), 12 (`down` refuses with "the
environment id changed" and names no pid; recovery was a manual kill), and 19
(`cleanup` on the default pattern correctly ignores pid 426150, whose cwd is the
repository root rather than `.worktrees/`).

Fixture cleanup: no `fake-omb` process remained on the port and no process had a
cwd under the fixture root, for both the first and the corrected run; both
fixture directories were removed after their logs were copied out. Raw logs,
`run.sh`, `results.md` and `results.json` live in the session scratchpad.


### Tier 2 — real OpenMausBot 0.1.56, zero bot turns

Node 24.11.0, real `openmausbot` 0.1.56 from
`~/.cache/agent-team/openmausbot-cli/node_modules/openmausbot/cli.js`,
`OMB_TOKEN` empty and every other `OMB_*` variable unset. Fixture
`/tmp/oml-review-t2-CGG7JR` with four git projects at `40bef591` on `main`.
**No bot turn was spent.** Host CLI sessions did consume their own
subscriptions.

Server: `http://127.0.0.1:8893`, supervisor **617810**, server **617817**
(PPid 617810), environment `98b1f9f2-e973-4c16-819f-aed3ba7fe778`, data dir
`/tmp/oml-review-t2-CGG7JR/data-20260908T105019-92irGo`, `askTimeoutMs`
600000. `doctor` passed 5/5 and named `openmausbot 0.1.56, from OMB_BIN`;
`doctor --server` passed **10/10** (health, loopback session with scopes
`admin,client`, engines `grok`, `claude` and `codex` available, no provider
keys, identity ok).

The stripped-environment check was run twice. On the main server,
`/proc/617817/environ` and `/proc/617810/environ` each hold **0** of
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, `OMB_TOKEN`. Because
that only shows absence, a second self-contained check exported all three
decoy keys plus an empty `OMB_TOKEN` in one shell (`env` counted 3), ran `up`
on port 8897 from that same shell, and found **0** in both the supervisor's
and the server's environ; `down` then removed both pids and health refused.

`import` of the supplied package created release 0.4.2, section "Agent Team
dev team", lead Sudo `414ffd78-4cb0-4190-8e88-53db14bbb002`, 5 bots, 1 room;
the package's SHA-256 was `48e4ac63…3255949` before, after import, and at the
end of the tier. `bind` applied all five per-bot selections and read them
back. `facts` rendered a 183-character block. `status --tail 3` returned
`run: null` with `busy` and `pending` empty. `import --adopt` into a second
project returned `package: null`, the identical lead and bot ids and
`owned: false`, and `status` there returned `run: null` — the first time
`--adopt` has run against a real server.

Host survival against the **real** server (the gap finding 4 records; the
earlier spike used the fake from Grok and Codex):

| Host | Invocation | Result |
|---|---|---|
| Grok Build 1.0.13 | `grok -p … --permission-mode bypassPermissions --cwd <grok-project> --max-turns 4 --no-subagents --disable-web-search --output-format streaming-json`, `up --port 8901` | owned: supervisor 620924, server 620931, environment `2777264e-…`; after Grok exited, health answered `{"app":"openmausbot","pid":620931}` from this shell; `down` from this shell stopped both |
| Codex CLI 0.153.4 | `codex exec --sandbox danger-full-access --cd <codex-project> --json --skip-git-repo-check … < /dev/null`, `up --port 8903` | owned: supervisor 625770, server 625777, environment `9606fa72-…`; health answered after Codex exited; `down` from this shell stopped both |
| Codex CLI 0.153.4 | same but `--sandbox workspace-write`, `up --port 8905` | **exit 1** as designed: `{"ok":false,"verb":"up","error":"the server exited during startup",…,"log":"… code: 'EPERM', … syscall: 'listen', … port: 8905"}` |

In both survival cases the server process's parent was its supervisor and the
supervisor's parent was `systemd --user` (pid 1987, itself a child of pid 1),
not the host CLI — the plan predicted PPid 1, which is the same substance on a
systemd user session. Both survival servers were stopped before Tier 3; all
four pids are gone and both ports refuse connections.

Three further host checks:

- Codex `--sandbox read-only` listed its skills without running any command;
  `openmausbot-launcher` is in the list. It read
  `/home/wsh/.agents/skills/openmausbot-launcher/SKILL.md`.
- Codex `--sandbox workspace-write` proved the launcher state file writable
  (`accessSync(state.json, 2)` → `state writable`, exit 0).
- Claude Code 2.1.263, `claude -p "run T10 through the team" --output-format
  stream-json --verbose --max-turns 2 --allowedTools Skill --add-dir <project>`:
  the **first** tool call was `Skill` with input `{"skill":"openmausbot-launcher"}`.
  The trigger phrase works (`docs/design.md:572`). The run ended
  `error_max_turns` after 3 turns and the repository was unchanged.

`${CLAUDE_SKILL_DIR}` (`docs/design.md:572-576`) resolved, by **load-time text
substitution rather than an environment variable**. Observed in the
interactive Claude Code session that invoked the skill: `SKILL.md` line 23
arrived with `${CLAUDE_SKILL_DIR}/scripts/omb.mjs` already rewritten to
`/home/wsh/.claude/skills/openmausbot-launcher/scripts/omb.mjs`, and the
loaded content announced the skill's base directory. In that same session's
Bash tool `echo "${CLAUDE_SKILL_DIR:-unset}"` printed `unset`, so a shell
script cannot rely on the variable — an agent must use the substituted path.
`ls -l` showed the symlinked driver and `node` on it printed the usage JSON
with 15 verbs. No bot turn and no extra host session were spent on this.

Deviations, each with a verdict:

1. The plan's survival ports collided with OpenMausBot's webhook listener.
   `up --port N` also occupies **N+1** (`server/index.ts:320`,
   `server/cli.ts:438`): the 8893 server also listened on 8894 with
   `OMB_WEBHOOK_PORT=8894` in its environ. Grok's first attempt, running the
   plan's command verbatim on 8894, got
   `GET /api/health -> 404: Unknown webhook endpoint` and exit 1. Reproduced
   from a plain shell. **Plan error plus a driver gap** — filed as finding 23
   (`oml-nqo.27`), because the driver neither reserves nor reports N+1 and the
   404 names no cause. Re-run on 8901 it passed.
2. Codex's first invocation hung on stdin ("Reading additional input from
   stdin…") and was killed at 420 s with an empty transcript, no listener, no
   state file and no data dir. **Harness error, not a defect**: adding
   `< /dev/null` fixed it and every later Codex call used that form.
3. `bind`'s roster line for Quill read `grok/grok-4.6/medium (undefined)`
   (`lib/verbs/team.mjs:157` interpolates `approvalMode` with no fallback when
   a bot is skipped for auto). **Driver defect**, finding 22 (`oml-nqo.26`).
4. `up`'s sandbox hint did not fire on the genuine sandboxed failure. The
   serve.log contains `listen EPERM: operation not permitted` twice, but
   `logTail(file, lines = 12)` (`lib/server.mjs:132-133`) returns the last 12
   lines, which start below that line, so the test at
   `lib/verbs/lifecycle.mjs:140` was false and the hint was the generic
   `see <serve.log>`. Confirmed by running `logTail()` directly on the captured
   log: 357 characters, regex false, while the whole file matches.
   **Driver defect**, finding 24 (`oml-nqo.28`); it also makes
   `docs/evidence.md:22-24` inaccurate for this failure shape.
5. `reconcile` in the adopted project exits **3** with `?? .omb/`, because
   `import --adopt` never writes the git exclude entries that `bind` writes.
   The bound project reconciles clean. Since `task` refuses on an unreconciled
   project, an adopted project cannot dispatch until `bind` runs there.
   **Driver defect**, finding 25 (`oml-nqo.29`).
6. `status` inside Codex workspace-write returned exit **3** "the server
   identity could not be verified", not the network error the plan predicted.
   The server was healthy and the same command exits 0 from a plain shell.
   `lib/server.mjs:30,33` swallow `e.network` and return `null`, so
   `lib/session.mjs:56` reports an identity failure and its hint tells the
   operator to "import --adopt or re-import". **Driver defect**, finding 26
   (`oml-nqo.30`). It is also the artifact finding 5 asked for, and it
   disproves `docs/evidence.md:62`'s claim that Codex ran `status` from inside
   workspace-write.
7. The Claude trigger check attempted `Bash` twice (both denied by
   `--allowedTools Skill`) after also loading `project-steward:resume`. The
   plan predicted no Bash. **Plan error**: the nested session's cwd was this
   repository, whose steward hook prompts a resume; `--add-dir` added the
   fixture but did not move cwd. The check's substance — the trigger phrase
   loading `openmausbot-launcher` first — passed.

Eleven `rec`-recorded driver invocations, all exit 0. Raw logs and transcript
SHA-256s are in the session scratchpad under `tier2/`.


### Tier 3 — minimal real run, lead only

Same server, team and fixture as Tier 2. **5 Sudo turns and 1 Sage turn** were
spent, counted from `turn.completed` in the data dir's event files; the budget
was 4–6 Sudo plus at most 1 Sage. No other bot ran and no delegation occurred:
`teamMap.queued` and `teamMap.running` were empty at every snapshot, and only
two event files exist in the whole data dir — the lead's and Sage's.

Setup: `bind --approval ask` set all five bots to ask (every roster line read
`(ask)`), and `PATCH /api/bots/414ffd78-…` with `{"approvePeerComms":true}`
returned **200** and read back `true`. Run `d0a01943d403c7af`, tag
`oml:d0a01943`, lead thread `aec43e24-…`, dispatched 2026-09-08T11:13:41.103Z
from `40bef59`.

Sequence and exit codes: `task` 0 → `watch` **5** (needs-user, 19 s) →
`answer --allow` 0 (`allowed-once`) → `watch` **0** (done, 32 s) → `send` 0 →
`watch` **5** (11 s) → `answer --deny` 0 (**`rejected`**) → `watch` **0**
(done, 33 s) → `send` 0 → `watch` **5** → `answer --allow` 0 → `watch` **5**
(the peer card) → `answer --allow` 0 → `watch` **0** (done, 41 s) → `send` 0 →
`status` 0 → `interrupt` 0 → background `watch` and `send` → `watch` **0** →
`report --dry-run` 0 → `report --md` 0 → `report` **3** → `report --run last
--dry-run` 0 → `report --run last` 0 → `reconcile` 0 → `cleanup --kill` 0 →
`down` 0. Thirty-eight `rec`-recorded invocations across Tiers 2 and 3, plus
`report --md` and the no-open-run `report`, which were run outside `rec` to
capture the markdown and the refusal.

Four approval requests were answered, none with "Always allow":

| Request | Tool | Kind | Answer | Outcome |
|---|---|---|---|---|
| `9dee0033-…` | `list_bots` | MCP tool | allow | `allowed-once` |
| `523623c0-…` | `ask_bot` | MCP tool | deny | **`rejected`** |
| `a89ec38a-…` | `ask_bot` | MCP tool | allow | `allowed-once` |
| `ca82697e-…` | `ask_bot` | **peer contact** | allow | `allowed-once` |

The peer card is the one `approvePeerComms` gates: title "@Sudo wants to
contact @Sage", options Allow / Deny / Always allow, `allowKey`
`ask_bot:fe2bbf47-…`. `/api/decisions` logged the three MCP cards as
`card-shown` then `user-approved`/`user-denied`, but **not** the peer decision.

The done marker appeared every time. After the deny, the lead quoted the tool's
own `{"content":[{"type":"text","text":"user rejected MCP tool call"}],"isError":true}`
and the marker; after the allow it wrote "Sage replied: PONG"; after the
interrupt, "Closing report: `sleep 90` was aborted before completion."

`interrupt` returned 0 with `interrupted: true` and the bot was idle within
1 s; the interrupted turn is recorded in the events with `ok: false`. The
background `watch --max-seconds 570 --brief` exited **0 after 60 s**, not 570 —
it returns at the next terminal state — while a foreground
`watch --max-seconds 100 --brief` ran concurrently and also returned DONE. The
state file's md5 changed across the pair, so both checkpointed; `--brief` does
not print the `checkpointed` field, so the flag itself was read from the state.

`report --md` closed the run `passed` at 11:24:49.645Z. `report --run last`
appended exactly one `reanalysis` entry and left the original result `passed`.
Both dry runs left the state md5 unchanged. `cleanup --kill` found no orphan,
so the kill path was not exercised on a real server; pid 426150 was ignored, as
designed, and is still alive. `down` stopped both pids and both 8893 and its
webhook port 8894 refuse connections; no process has a cwd under the fixture.

Deviations, each with a verdict:

1. The plan expected the first card to be the `ask_bot` peer card. It was an
   MCP approval card for `list_bots`, because a Codex bot under `ask` raises a
   separate MCP card per tool before any peer gate is reached. Allowed once
   under the plan's own escape hatch for a prerequisite card. **Plan error**,
   and a fact worth keeping: reaching a peer card with a Codex lead under `ask`
   costs two extra approvals.
2. In its first turn the lead wrote "Sage contact denied" although the native
   log shows it never called `ask_bot`: its only tool calls were the `date -u`
   shell exec and `list_bots`. The brief's own "if the contact is denied…"
   clause gave it the wording. **Neither a driver defect nor a plan error but a
   caution**: a lead's prose is not evidence that a tool ran, and the `deny`
   path only became testable after a corrective `send` naming Sage's id. That
   send is the reason the tier spent 5 Sudo turns rather than 4.
3. `status` still emits no `carried` field on a real server, confirming
   `oml-nqo.25`; the carried verdict itself works.

## Current M1 completion checkpoint

2026-09-08, Node 24.11.0, `npm test` outside the socket-restricted sandbox:
**154 passed, 0 failed, 0 skipped**, 52.225 s after the source fix.
`node --test tests/snapshot.test.mjs`: **5/5**, 3.441 s. Before the fix,
the new standalone-send regression failed on the missing leader field.
No build or lint command is configured. `git diff --check` passed.

Real OMB 0.1.56: Claude Code 2.1.263, Codex CLI 0.153.4, and Grok Build
1.0.13 each executed local doctor (5/5), server doctor (10/10), status,
one send and reply observation through native shell tools. Codex network
commands required escalation in the recorded configuration. Claude resumed
read-only observation after the fix, without a duplicate send. Native
transcripts and OMB message IDs correlate each command with its reply;
the stored sender role is user, and the operator supplied the text.

All five requested bindings were read back; only Sudo executed (three
successful OMB turns). The other four models, a new full-team task, long
Codex SSE, and OpenClaw/Hermes/DSH remain unverified by this checkpoint.
The supplied package hash is unchanged. Cleanup found a clean main, one
worktree and no orphan candidates. Down succeeded; both recorded PIDs are
absent, health refuses connections, and no process remains with a fixture
cwd. Evidence extraction asserts these checks from native results and
runtime events; see `docs/validation/2026-09-08-m1-hosts.json`.

T12's historical 8/9 package score is unchanged. No pushes occurred.

## Earlier M1.1 repair and policy checkpoints

Full suite for the requested repair commit: 2026-09-08, Node 24.11.0, `npm test` outside the
socket-restricted sandbox: **153 passed, 0 failed, 0 skipped**, 49.324 s
(fresh run before the requested local commit). `git diff --check` passed.
No build or lint command is configured. Skill frontmatter and size checks
are part of that suite.

The first integrated run found three failures (149/152 passed): two old
snapshot fixtures used the ambient data directory, and cleanup could report
failure during a process's exit. Fixtures now use their fake's directory;
a deterministic regression reproduced transient cwd loss during SIGTERM
before the reporting fix. Focused checks passed, then the full suite above.

Independent spec/quality reviews approved state serialization, monitoring,
command safety, cleanup, and reports after fixes. Documentation retrieval
checks cover lock migration, offline dry runs, unsaved checkpoints and
typed cards. Real T12 archive reanalysis confirms the approval at
03:10:22.421Z and the retained ListAgents residual, without HTTP, Git, test
execution, state writes, or bot turns. See `docs/evidence.md` for scope.

Not newly verified during M1.1: the six remaining T12 repository/test checks
and the formal doctor/status/send sequence on all three hosts. Original T12 is 8/9.
No project Git status, commit, or push was run during that repair under its
then-active session hook.

Policy correction (`oml-2d5`, Decision 0005): verified `bd prime --full` and
`bd prime --hook-json` both permit local Git and require explicit user
permission for every push. AGENTS.md and CLAUDE.md agree. Effective settings:
`no-git-ops=false`, `no-push=true`, `backup.git-push=false`; Steward retains
`commit_policy="auto"` and disables automatic pushes. No driver code changed;
the 153-test result above was the full-suite verification for that checkpoint.

Package scope correction (`oml-qh7`, Decision 0006): inspected import's
supplied-path parsing, roster mapping and lead selection, and report's
explicit `check-042` flag branch. No dev-team package path or fixed bot keys
occur in the driver. Ran `node --test tests/team.test.mjs tests/report.test.mjs
tests/report-evidence.test.mjs` outside the socket-restricted sandbox:
**50 passed, 0 failed, 0 skipped**, 7.119 s. `git diff --check` passed.
Only documentation and task scope changed; no new bot runs or package edits.
