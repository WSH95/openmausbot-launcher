# OpenMausBot 0.1.56 API used by the launcher

Every `file:line` below points at the pinned read-only source clone
(`~/.cache/agent-team/openmausbot-src`, `server/` unless another directory is
named). The npm package the driver runs is `openmausbot` 0.1.56. A claim
without a citation is a driver convention or is marked unverified.

## Trust model

On a headless server, a request that arrives on loopback with no proxy header
and an allowed Origin is the owner: it holds both the `admin` and `client`
scopes over plain HTTP JSON, with no token
(`request-auth.ts:29,351-372`). A presented session credential wins over the
loopback rule, so a bearer token on a loopback URL downgrades the caller to
that session's scopes (`request-auth.ts:324-326,342-350`) — which is why
`doctor` warns when `OMB_TOKEN` is set against `127.0.0.1`. Client scope is a
default-deny allow-list (`request-auth.ts:185-250,252-258`): a client session
may read `/api/bots`, `/api/team-map`, thread messages and the event stream,
send messages, interrupt, open tasks, answer cards, and PATCH a bot's or a
room's *display* fields only (`request-auth.ts:213,230,263-281`); everything
else needs `admin` — team import, `PATCH /api/bots/:id/model`,
`GET /api/instances`, `GET /api/decisions`. No route emits any
`access-control-allow-*` header (no CORS anywhere in `server/`), the server
binds loopback, and remote reach is `--tailscale`, `--tunnel`, a reverse
proxy behind `--public-url`, or an SSH tunnel (`cli.ts:113-136`); a proxied
request without a session is refused 403 (`request-auth.ts:381`). The four
refusals the driver reports verbatim: 403 `forbidden: this session lacks the
admin scope` (`request-auth.ts:346`); 401 `unauthorized: this session has
expired or was revoked; pair this device again` for an unknown or expired
bearer (`:375`); 403 `forbidden: this request came through a proxy (pair this
device to use the server remotely)` (`:378`); 403 `forbidden: loopback host
required (pair this device to use the server remotely)` (`:381`). On the
packaged desktop build every mutating public route from outside the app is
refused 403 `forbidden: this change must come from the desktop app or a
paired device` (`request-auth.ts:293-309,364-370`); reads still work.

## Routes the driver uses

| Method and path | Request | Response | Refusals, and when |
|---|---|---|---|
| `GET /api/health` | — | `{app:"openmausbot", pid, static}` (`index.ts:11363-11365`) | — |
| `GET /.well-known/openmausbot/environment` | — (public, no auth: `index.ts:7315`) | `{environmentId, label, platform, version, capabilities{remoteSessions, selfUpdate}}` (`environment.ts:116-128`) | — |
| `GET /api/auth/session` | — | loopback: `{kind:"loopback", scopes, environmentId}`; paired: `{kind:"session", id, label, scopes, expiresAt, via, environmentId}` (`index.ts:7362-7378`) | — |
| `POST /api/auth/pair` | `{code, label?, attemptId?, cookie?}` — **public, before the auth gate** (`index.ts:7318-7341`) | 200 `{token, session{id,label,scopes,createdAt,lastSeenAt,expiresAt}, environment}`; the token is `omb_sess_` + 43 base64url characters and only its sha256 is stored (`sessions.ts:288`) | 415 `send the pairing code as JSON (content-type: application/json)` for any other content type, so a cross-site form cannot plant a session (`index.ts:7322-7324`); 401 `pairing code is wrong or has expired; create a new one on the server`, which also counts toward the lockout (`sessions.ts:283-286`); 429 `too many failed pairing attempts from your address; try again in ${seconds}s` after 10 failures from one source in 60 s, locked for 60 s (`sessions.ts:29,240-262,278-281`) |
| `POST /api/auth/pairing` | `{label?, scopes?: ("admin"\|"client")[]}`; no scopes means both (`sessions.ts:209`) | 200 `{id, code, expiresAt, url\|null, hint\|null}`; the code is 12 symbols from a 32-symbol alphabet with no `0O1I`, presented `XXXX-XXXX-XXXX` and normalized on receipt, so it may be typed as read out (`sessions.ts:19-20,110-121`) | admin only |
| `GET /api/auth/pairing` | — | 200 `{pairings:[{id,label,scopes,createdAt,expiresAt}]}` — open codes, never the codes themselves (`index.ts:7406`, `sessions.ts:223-226`) | admin only |
| `DELETE /api/auth/pairing/:id` | — | 200 `{ok:true}` (`index.ts:7407-7411`) | 404 `no such pairing code`; admin only |
| `GET /api/auth/sessions` | — | 200 `{sessions:[{id,label,scopes,createdAt,lastSeenAt,expiresAt}], current}` (`index.ts:7412-7414`) | admin only |
| `DELETE /api/auth/sessions/:id` | — | 200 `{ok:true}`; the token stops authenticating at once (`index.ts:7415-7420`, `sessions.ts:334-340`) | 404 `no such session`; admin only |
| `GET /api/instances` | — | `{instances:[{instanceId, driverKind, displayName, snapshot, models{default, options}, capabilities{effortLevels}, access}]}` (`index.ts:11408-11414`) | admin only |
| `GET /api/bots?messages=0` | — | `{bots, groups, computerControl}`; each bot: id, name, title, description, section, threadId, busy, activity, cwd, approvalMode, modelSelection, chiefOfStaff, hidden, notifications, `tasks[]`, plus a message page (`index.ts:8623-8636`, `1456-1461`, `1157-1169`) | 400 `messages must be a non-negative whole number` |
| `GET /api/team-map` | — | `{collaborations, queued:[{sourceBotId,targetBotId,reason}], running:[{sourceBotId,targetBotId,threadId,groupId?}]}`; hidden bots omitted (`index.ts:8407-8435`) | — |
| `GET /api/threads/:id/messages` | `limit` (default 50, clamped to 200: `pageSize()`, `index.ts:1937-1946`), `before` | `{messages, hasMore}` (`index.ts:1937-1946,1957-1964,8639-8661`) | 404 `no such conversation`; 404 `no such message` for an unknown `before`; 400 `limit must be a non-negative whole number`; 400 `before and around cannot be combined` |
| `GET /api/events` | `screens=off`, `since` | SSE, see below (`index.ts:8553-8619`) | — |
| `POST /api/teams/import?mode=add` | an `openmaus.package` document | 201 `{name, bots[], group, groups[], routines[]}` (`index.ts:9151-9337`) | 400 on `mode=replace`; 400 on a schema violation; 403 without admin |
| `POST /api/bots/:id/tasks` | `{title?}` | 201 `{bot, task{threadId,title,createdAt}}` (`index.ts:11105-11119`) | 409 `this bot is working — let it finish before starting a task`; 409 `this bot is securely saving a credential — try again when it finishes` |
| `POST /api/bots/:id/tasks/:threadId` | — | 200 `{bot}`, that task is now the bot's active one (`index.ts:11120-11140`) | 404 `no such bot`; 404 `no such task`; 409 `this bot is working — stop it before switching tasks` — switching mid-turn would lose ownership of the process; 409 `this bot is securely saving a credential…`. Client scope may call it (`request-auth.ts:210-211`) |
| `POST /api/bots/:id/messages` | `{text, threadId?, sendId?}` | 202 receipt, see below (`index.ts:10738-10870`) | 400 `text required`; 400 `threadId must be a task id`; 409 `the bot switched tasks before it could receive the message` (`10756,10794,10826`); 409 `the target task no longer exists`; 409 `sendId already belongs to another message` (`10767,10782`); 409 `the running turn ended before the steered message could be recorded` — a late steer whose turn settled first (`10832-10835`) |
| `POST /api/threads/:id/respond` | `{requestId, behavior, message?, reviewedSha256?}` | 200 `{ok:true, outcome}`, outcome ∈ `allowed-once` \| `rejected` \| `answered` \| `unavailable` (`contracts.ts:162`, `index.ts:10972-11033`); a settled skill or routine card answers `{ok:true, outcome, alreadySettled:true}` (`:6458-6468`, `:4811-4818`); a confirmed routine adds `routineAction` and `resultId` (`:4823-4829`) | 400 `behavior must be allow, deny, or answer`. Skill cards (`:6438-6597`): 403 `this skill request belongs to a different bot`; 409 `this proposal was created by an older build — deny it and ask the bot to create it again`; 409 `reviewedSha256 must match the skill shown on the approval card`; 422 `the skill preview changed after review — deny and recreate it`; 422 `the staged skill no longer matches this approval card`; 409 `the learned-skill approval card is no longer available`; an apply failure is 422 and lands on `card.held`. Routine cards (`routine-requests.ts:800-930`): 400 `Routine confirmations must be confirmed or cancelled`; 400 `This routine request id does not match its confirmation card`; 403 `This routine request belongs to another conversation`; 404 `That routine no longer exists`; 409 `That routine changed after this confirmation card was prepared. Ask the bot to review it and propose the action again.`; 409 `That one-time schedule is now in the past. Ask the bot to propose a new time.`; 409 `This routine confirmation card is no longer available` — revalidation failures write `held` (`:896-908`); text-mode, request-id and ownership refusals need not (`:812-855`), and mismatched payloads can still be cancelled |
| `GET /api/routines` | `from?`, `to?` | 200 `{routines, runs}` (`index.ts:8438-8447`) — how a confirmed proposal is verified; `DELETE /api/routines/:id` removes one. Client scope (`request-auth.ts:241-243`) | — |
| `POST /api/bots/:id/connector-cards/:messageId/authorize` | `{threadId}` | 200 `{url}` — the browser link, returned to this caller only and never stored in the transcript (`index.ts:12231-12244`); the card becomes `authorizing` | 404 `no such connection request`; 400 `Add an account alias so the existing connection is not replaced`; 409 `<toolkit> already has the maximum of N accounts` (`composio.ts:348-350,928-935`); an authorization error leaves the card `failed` (`index.ts:12245-12250`); admin only |
| `GET /api/bots/:id/connector-cards/:messageId/status` | `?threadId=` | 200 `{connected, pending, status}` (`index.ts:12255-12276`). **This read mutates**: it refreshes the stored card from the provider and resumes the bot itself when the last app in the request is live | 404 `no such connection request`; client scope |
| `POST /api/bots/:id/connector-cards/:messageId/(resume\|dismiss)` | `{threadId}` | `resume` 200 `{resumed:true}` once every card sharing the `resumeKey` is connected and undismissed (`:6687-6697`); `dismiss` 200 `{dismissed:true}` and the bot is **not** woken (`:12284-12287`) | `resume` 409 `finish connecting every requested app first`; 404 `no such connection request`; client scope |
| `POST /api/bots/:id/secret-cards/:messageId/provided` | `{threadId}` | 200 `{provided:true, resumed}` and the bot is woken with `OpenMausBot credential update: the user securely provided …` (`index.ts:12196-12206`, `:6778-6780`). **It carries no value**: it only checks that the credential is configured and then resumes, and resuming an already-resumed card returns at once (`:6838-6842`), so a lost answer is recovered by calling it again | 404 `no such credential request`; 409 `this credential is currently being saved from a phone`; 409 `this credential request was dismissed`; 409 `<label> was not saved yet` unless the value is already in the config; 409 `this credential request is no longer available`; **admin only** (`request-auth.ts:218` lists only `resume` and `dismiss`) |
| `POST /api/bots/:id/secret-cards/:messageId/(resume\|dismiss)` | `{threadId}` | `dismiss` 200 `{dismissed:true, resumed}` and wakes the bot with `… the user declined …` (`:6781`); `resume` 200 `{resumed}` (`:12208-12222`) — for a card whose `provided` or `dismissed` flag is already set but whose wake failed, which leaves `resumed:false` and an `error` on the card (`markSecretResumeFailed`, `:6767-6773`) | `resume` 409 `this credential request is not ready to resume` on a card with neither flag set; 409 `<label> is no longer configured`; client scope (`request-auth.ts:218`) |
| `POST /api/bots/:id/secret-cards/:messageId/provide` | an HPKE envelope | the paired phone's route; the headless server has no private key for it (`phone-secret.ts:393-403`) | 403 `Secure phone entry must come from a paired phone` for anything else (`index.ts:12158-12160`) — never used from here |
| `PUT /api/config` | `{xai{key}\|box{token}\|opencodeGo{apiKey}\|tts{key}\|imageGen{key}\|features{…}\|…}` | 200 `configStatus()` — configured-or-not booleans and non-secret settings, never a value (`index.ts:7125-7157`, `11675-12059`). `saveConfig` writes the server's own `config.json`, then `syncCredentialEnv` and a reload make the credential live at once (`:11962-11968`) | 400 from `parseConfigPatch` (the path and zod's text); 400 `nothing to save`; 409 `provider settings are already being updated`; a `box.token` change first inventories the cloud computers on that account and can answer 503 (`:11752-11790`); admin only |
| `GET /api/config` | — | 200 the same booleans; a client session loses the SSH alias, the email and browser partition ids (`index.ts:11661-11673`) | client scope |
| `POST /api/bots/:id/interrupt` | `{threadId?}` | 200 `{ok:true}` (`index.ts:11035-11091`) | 409 `this bot is running a routine in another conversation`; 409 `this bot is working in channel <name>`; 409 `the bot switched tasks before it could be interrupted` |
| `PATCH /api/bots/:id` | `{cwd\|description\|approvalMode\|approvePeerComms\|…}` | 200 `{bot}` (`index.ts:9986-10321`) | 400 `description must be at most 4000 characters` (`bot-profile.ts:50`); 409 `stop this bot's turn before changing its approval level` — busy **and** the level actually changes (`10160-10163`); 403 `This approval-level change can only be made from the packaged desktop app` for `full` or `custom` (`10186-10190`); 409 `wait for the approval-level change to finish before changing this setting` (`10016`); 403 for a client session touching anything but display fields (`9992-9994`). `cwd` has no busy guard (`10127-10131`); a never-PATCHed bot carries no `approvalMode` field (`store.ts:1303-1335`) and runs as `ask` (`shared/approval-mode.ts:32-43`); `approvePeerComms` is read back on `GET /api/bots` (`index.ts:1159-1168`); 400 `approvePeerComms must be true or false` (`10212-10217`) |
| `PATCH /api/bots/:id/model` | `{instanceId, model, effort?}` | 200 `{bot}` (`index.ts:9919-9953`) | 409 `the bot is working — stop it before changing models` — only when the selection actually changes (`1050-1057`); 409 `wait for the approval-level change to finish before changing models` (`9930-9932`); 400 `unsupported model field: …`; 400 `effort "…" is not recognized`; admin only |
| `PATCH /api/groups/:id` | `{cwd\|name\|memberIds\|…}` | 200 `{group}` (`index.ts:9493-9595`) | 409 `the room's working folder is fixed after its first turn` once `pinnedCwd` is set — **even when the new `cwd` equals the old one** (`9564-9568`); 400 `direct-message channels cannot have a working folder` |
| `GET /api/decisions` | `limit` (default 200) | 200 `{decisions}`, read back from the data dir (`index.ts:11398-11405`) | 400 on a non-positive limit. This is a log of resolved requests, never a pending queue |
| `GET /health` on `port + 1` | — | `{app:"openmausbot-webhooks", ready:true}` (`webhook-ingress.ts:94-96`): the webhook receiver that `serve` binds next to the API port, loopback only (`index.ts:319-320`, `cli.ts:438`, `webhook-ingress.ts:161-186`) | every other path, `/api/health` included, is 404 `Unknown webhook endpoint` (`webhook-ingress.ts:98`); a taken `port + 1` is logged `openmausbot webhook receiver unavailable` and the server keeps running (`index.ts:4874-4880`) |

## Receipts and the `sendId` rule

`POST /api/bots/:id/messages` always answers 202 with one of three shapes
(`index.ts:10763-10871`):

| Shape | Meaning |
|---|---|
| `{ok:true, threadId, message}` | a turn started, or the text was appended |
| `{ok:true, steered:true, threadId, message}` | accepted into the turn already running |
| `{ok:true, queued:true, queueId, threadId}` | held in the server-side queue for the next turn |

**A message reaches only the bot's active task.** `threadId` must name one of
the bot's tasks (`index.ts:10755`), and the send is refused again inside the
sequencer when the bot has moved on (`index.ts:10788-10797`). Nothing is ever
retargeted; the only way to deliver to another task is to make it active with
`POST /api/bots/:id/tasks/:threadId` first, which the server refuses while the
bot is working. The replay check comes **before** that active-task check
(`index.ts:10764-10777`), so retrying a send with the same `sendId` returns
the canonical receipt without moving the bot at all.

Idempotency is keyed `bot:<botId>:<threadId>:<sendId>` (`index.ts:10761`). A
repeat with the same text and reply target returns the canonical receipt; a
repeat with different text is 409 `sendId already belongs to another message`
(`index.ts:10767,10782`). The driver therefore retries a send by resending
the identical thread, text and `sendId`, and never rewrites any of the three.
The canonical receipt is the original message — its `id` and `at`, with no
replay marker (`send-idempotency.ts:21-40`) — so the driver flags
`duplicate: true` when `message.at` predates the request's start; on loopback
that is one clock, over a remote URL it assumes the server's clock agrees.

## The event stream

- `GET /api/events?screens=off` opens `text/event-stream` with
  `cache-control: no-cache` and `x-accel-buffering: no`
  (`index.ts:8555-8563`). A bearer token authenticates the stream like any
  other route (`request-auth.ts:326,342-350`); a stream ticket is only for
  cookie-less browser clients.
- The first frame is
  `data: {"kind":"hello","cursor":"<streamId>:<seq>","resumed":<bool>}`
  (`index.ts:8582-8596`). `cursor` is the head *before* replay, so the
  checkpoint must be the `id:` of the last frame actually applied.
- Every non-heartbeat frame carries `id: <streamId>:<seq>` and a `data:` JSON
  body repeating `seq` (`index.ts:2036-2040`).
- Resume with `?since=<cursor>` or the `Last-Event-ID` header; the header
  wins when both are present (`index.ts:8567-8570`). A cursor whose stream id
  belongs to an earlier server run is rejected (`index.ts:2028-2035`).
- `resumed:false` means "I could not give you what you missed — hydrate". A
  cold start that offered no cursor gets `false` too, by design
  (`index.ts:8578-8595`), so a full REST snapshot always follows it.
- Replay buffer: 500 frames (`index.ts:2014`). A cursor that fell off the end
  yields `resumed:false` rather than a partial replay.
- Keepalive every `SSE_HEARTBEAT_MS` (15 s default, `index.ts:2016-2020`): a
  `: keepalive` comment plus `data: {"kind":"ping"}`. Heartbeats carry no
  `id:` and never advance replay (`index.ts:8604-8615`).
- Frame `kind` values the server broadcasts: `bot`, `bot.deleted`, `group`,
  `group.deleted`, `message`, `message.patch`, `thread`, `notify`, `runtime`,
  `computer`, `config`, `screen`. `screen` is the only kind a client may
  decline, with `?screens=off` (`index.ts:2024-2025`).
- `notify` frames carry `{kind, botId, botName, threadId, title, body,
  groupId?}` with kind ∈ `approval` \| `question` \| `done` \|
  `routine-failed` \| `turn-failed` \| `takeover` (`notify.ts:18,109`). A bot
  whose notifications are off produces none (`notify.ts:85`), so a
  notification is a wake-up, never the truth.

## Team package import

- Additive only. `mode=replace` is 400; the accepted modes are `add` and
  `project` (`index.ts:9157-9163`). `project` opens a caller-owned room only
  for a legacy `openmaus.team` manifest, never for a full package
  (`index.ts:9302`).
- Every agent becomes a **new** bot with a fresh id. A colliding name is
  numbered ("Sudo 2"), counting hidden bots too
  (`index.ts:9209-9212,9241`).
- The section is the package `name`, numbered on collision with any existing
  bot or group section (`index.ts:9217-9228`). The response's `name` field is
  the *unnumbered* package name (`index.ts:9201,9322-9328`), so read the real
  section from a returned bot's `section` field.
- `chiefOfStaff` names a package key; that bot becomes the chief
  (`index.ts:9299-9301`) and its returned record carries `chiefOfStaff: true`.
- Rooms are created from package-local keys normalised to the fresh bot ids,
  with the bulletin and default responder applied (`index.ts:9271-9284`).
  Routines are created disabled (`index.ts:9285-9291`).
- Parse-time limits: tagline ≤ 160 (`bot-package.ts:47`), an agent
  description ≤ 4000 (`bot-package.ts:68`), a playbook's instructions ≤ 24000
  (`bot-package.ts:118`). A violation is 400 with the validation message.
- 201 `{name, bots[], group, groups[], routines[]}`; `group` is the legacy
  single room and `groups[]` the full list.

## Data-dir files

| Path | Contents |
|---|---|
| `environment-id` | The persistent identity, written once and never rotated by the server (`environment.ts:59-70`). A new data dir means a new server identity. |
| `delegation-receipts.json` | `[{id, sourceThreadId, toBotId, toBotName, status, finishedAt, result?}]` — newest first, deduplicated by `id`, capped at 100, pruned after 48 h, `result` truncated to 4000 chars (`delegations.ts:96-129`). Fleet-wide: filter by `sourceThreadId`. |
| `events/<threadId>.ndjson` | Normalised `RuntimeEvent` lines (`thread-events.ts:5-6`): `turn.started`, `turn.completed` with `ok` and `usage{input, output, cachedInput}`, `session.started` with `model`, `item.started/updated/completed`, `request.opened/resolved`, `thread.token-usage.updated`, `runtime.error` (`contracts.ts:95-153`). Only `turn.completed.usage` may be summed; `thread.token-usage.updated` is a live indicator whose meaning differs per driver (`contracts.ts:113-117`). |
| `native/<threadId>.ndjson` | `{at, dir:"in"\|"out", source, msg}`, the provider's own protocol verbatim and secret-redacted (`thread-events.ts:7-9,18-23`; `drivers/native.ts:11-21`). Claude lines carry `message.content[]` with `tool_use` and `tool_result` blocks; Codex lines carry its own thread start and resume protocol. |
| `messages.db` | SQLite message store; archived reports open it read-only and select the run thread's JSON in row order (`message-db.ts:21,119-127`). Legacy `messages-<threadId>.json` is the fallback. |
| `bots.json`, `groups.json`, `messages-<threadId>.json` | The store (`store.ts:562-564`). Alongside them: `sessions.json`, `decisions.ndjson` (`decision-log.ts:68`), `skills/`. |

## Message shapes on a thread

Fields the driver reads (`store.ts:101-183`): `id`, `at`, `role`
(`"bot"`/`"user"`), `kind` (`"text"`, `"activity"`, `"screen"`, …), `text`,
`from{botId,name,color}`, `card`, `connector`, `secret`,
`tool{name, ok, spoken?, setup?}`, `sendId`, `steered`, `queued`/`queueId`,
`turnId`, `via`.

Cards are `kind: "options"` messages, often without a top-level `text`.
The card has `title`, `subtitle`, `options`, `requestId`, and no `kind`.
Permission cards have `tool` and may have `held`, `approvalScope`, or
`allowKey`; question cards omit `tool` (`index.ts:2881-2896,2917-2945`).
Classify `routineRequest` and `skillRequest` before testing `tool`.

Learned-skill cards are `Enable skill "<name>"?` / `Update skill "<name>"?`
with options `["Enable"|"Update","Deny"]` and `tool: "stage_skill"`
(`index.ts:6372-6431`); the payload carries the bot and staged ids, name,
action, gist, source, preview, its sha256 and any warnings. The hash is the
sha256 of the preview text (`skills.ts:1250`) and allowing one requires it
back as `reviewedSha256` (`index.ts:6513-6519`). **Any behaviour other than
allow rejects the staged skill** (`:6470-6504`), so there is no way to
comment on one.

Routine cards use `["Confirm","Cancel"]` with `tool: "schedule_routine"` for
a create and `"manage_routine"` otherwise (`routine-requests.ts:534,581`),
and carry a versioned proposal with request/bot/thread ids, creation time and
a structured `operation` (`:119-157,742-752`). Their response rejects
`answer` with 400; a successful confirmation returns `routineAction` and
`resultId` (`:812-818`, `index.ts:4823-4829`).

Both are intercepted before ordinary adapter answers (`index.ts:10980-11013`).
A thread holds at most 8 open cards of each kind: the ninth proposal is
refused with 429 `confirm or cancel an existing learned-skill card first` or
`… routine proposal first` (`:6303-6339`).

Connection requests are `kind: "connector"` messages, not cards: `connector`
carries `slug`, `label`, `description`, `status` ∈
`required|authorizing|connected|failed`, a `resumeKey` shared by every app in
one request, and an optional account `alias` (`store.ts:69-82`). They have no
`requestId`, so the message id names them. Credential requests are
`kind: "secret"`: `secret` carries the allowlisted `target`, its `label`,
`description`, `placeholder`, `helpUrl` and a `requestKey` (`store.ts:84-99`),
and the message text is the same handoff sentence for every one of them
(`index.ts:6742-6744`). The five targets are `xaiApiKey`, `boxToken`,
`opencodeGoApiKey`, `ttsKey` and `openaiImageApiKey`
(`shared/credential-request.ts:6-38`); the value goes to the config path that
id owns (`:52-65`) and never into the transcript.

- `from` is set only on a bot message in a group thread
  (`index.ts:2731-2732`) and on a delegation echo (`index.ts:3389`). Direct
  turn text on a 1:1 thread carries none — that absence is how the lead's own
  words are told apart from an echo.
- Echo: role `bot`, kind `text`, `from` = the target bot, text
  `@<name> replied to the delegated task:\n\n<reply>` (`index.ts:3383-3390`).
  Names may contain spaces.
- Delegation queued: role `bot`, kind `activity`, `tool.name`
  `Delegated to @X` or `Delegated to @X: <reason>`, ok true, settled at birth
  and never patched (`delegations.ts:302-313`). This chip, on the source
  thread, is the only record that a delegation belongs to this run: the chips
  carry bot **names**, never ids, and team-map edges carry no source thread
  (`index.ts:8422-8433`).
- An `ask_bot` that timed out on a busy peer becomes a delegation and says so:
  `@X is still working — ask converted to a delegation` (`index.ts:7912-7916`).
- Queued delegations lost with their turn:
  `N queued delegation(s) dropped — the turn did not finish`
  (`delegations.ts:438-442`); a failure with no name,
  `error: delegation failed — <why>` (`delegations.ts:377-382`); one that
  could not start, `error: delegation to @X could not start — <why>`
  (`index.ts:3485-3500`).
- Delegation activity: role `bot`, kind `activity`, `tool.name` one of
  `Delegation to @X completed without a text reply` (ok true) or
  `Delegation to @X failed — <reason>` (ok false) (`index.ts:3396-3400`);
  `Delegation to @X waiting — they're busy (retry n/3 when they finish)`
  (`delegations.ts:491,558`);
  `Delegation to @X canceled — still busy after 3 retries`
  (`delegations.ts:506,573`); `Delegation to @X canceled — <reason>`
  (`delegations.ts:632`); `Delegation to @X denied by user`
  (`delegations.ts:535`).
- A pending request (`scripts/mcp-server.ts:652-660`): a `card` with a
  `requestId` that is neither `answered` nor `dismissed`; or a `connector`
  that is not `dismissed`, not `resumed`, and whose `status` is not
  `connected`; or a `secret` that is neither `provided` nor `dismissed`.
- A failed dispatch (`scripts/mcp-server.ts:662-675`): after the last user
  message there is no bot text, and an activity carries `tool.ok === false`
  with a `tool.name` matching `/^error:/i`.

## The CLI

- `openmausbot serve [--port 8799] [--data-dir DIR] [--label NAME]
  [--public-url https://host] [--tailscale | --tunnel] [--no-pair]`
  (`cli.ts:113-136`). Other commands: `pair [--label NAME] [--client]`,
  `sessions [revoke ID]`, `status`, `login`, `logout` (`cli.ts:64,115-127`).
- `--no-pair` suppresses only the pairing link and QR code printed at start
  (`cli.ts:503-508`); `openmausbot pair` still mints codes afterwards. It
  mints on the port it serves, 8799 by default (`cli.ts:73-74`, `223-229`),
  and the launcher's `pair --code …` is what exchanges the code.
- Pairing lifetimes: a code lives 5 minutes and is single use — the exchange
  splices it out (`sessions.ts:21,286`); a session lives 30 days
  (`sessions.ts:22`). A consumed code presented again with the **same**
  `attemptId` (`/^[\w-]{8,64}$/`) inside 60 s returns the identical answer,
  which is how a lost response is recovered without burning a second code
  (`sessions.ts:31-35,273-276,302`).
- Defaults: port `OMB_PORT` or 8799, data dir `OMB_DATA_DIR` or
  `~/.openmausbot` (`cli.ts:73-74`). `OMB_ASK_BOT_TIMEOUT_MS` sets the
  server-wide ask window (`index.ts:2193`).
- `serve` is a supervisor. It spawns the server as a child and forwards its
  **whole environment** (`...process.env`, `cli.ts:434-441`), so a provider
  key present in the launcher's environment reaches the bots unless it is
  removed before the spawn. `/api/health` answers with the child's pid
  (`index.ts:11363-11365`), which is what lets the driver prove ownership by
  ancestry. SIGINT or SIGTERM on the supervisor stops the child
  (`cli.ts:455,462-473`).
- `serve` refuses to start when something already answers on the port
  (`cli.ts:407-409`) and gives the child 60 s to answer (`cli.ts:475-487`).
