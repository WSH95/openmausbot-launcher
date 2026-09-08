# Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Codex's workspace-write sandbox denies listening sockets (`listen EPERM`, spike 2026-09-08) | certain | medium | `up` names the cause in its hint; on Codex run `up` with an escalation or attach to a server started elsewhere; loopback HTTP reads from inside the sandbox work (`status` verified 2026-09-08); long SSE from inside the sandbox is still unverified |
| OpenClaw `--announce` on empty output and allowlist argument syntax unverified | high | low | Documented as unverified; follow-up bead once OpenClaw is installed |
| The lead omits the run marker | low | low | `attention` after quiet; the agent reads the closing report |
| OpenMausBot churn (daily releases) | high | medium | Pin 0.1.56 in `compatibility` and `metadata.omb-version`; `references/api.md` carries source lines; routes read from the pinned clone only |
| Lifecycle is Linux-only (`/proc` ancestry and start times) | certain | low | macOS gets `attached` mode; Windows unsupported |
| Long tasks need many `watch` calls under host exec limits | certain | low | Cursor and watermarks make each call cheap; each call observes its own 30 s quiet window |
| Numbered names after re-import ("Sudo 2") | medium | low | Ids everywhere; `--adopt` by name must name the team |
| Bot turns on the user's subscriptions | certain | medium | One real run, counted and recorded |
