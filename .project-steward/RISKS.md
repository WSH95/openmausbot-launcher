# Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Codex's workspace-write sandbox denies listening sockets (`listen EPERM`, spike 2026-09-08) | certain | medium | `up` names the cause in its hint; on Codex run `up` with an escalation or attach to a server started elsewhere; loopback HTTP reads from inside the sandbox work (`status` verified 2026-09-08); long SSE from inside the sandbox is still unverified |
| OpenClaw `--announce` on empty output and allowlist argument syntax unverified | high | low | Documented as unverified; follow-up bead once OpenClaw is installed |
| The lead omits the run marker | low | low | `attention` after quiet; the agent reads the closing report |
| OpenMausBot churn (daily releases) | high | medium | Pin 0.1.56 in `compatibility` and `metadata.omb-version`; `references/api.md` carries source lines; routes read from the pinned clone only |
| Lifecycle is Linux-only (`/proc` ancestry and start times) | certain | low | macOS gets `attached` mode; Windows unsupported |
| Long tasks need many `watch` calls under host exec limits | certain | low | Each call rehydrates under a bounded deadline and observes its own quiet window; reserve one extra second for checkpoint contention |
| Numbered names after re-import ("Sudo 2") | medium | low | Ids everywhere; `--adopt` by name must name the team |
| Bot turns on the user's subscriptions | certain | medium | One real run, counted and recorded |
| Mixed old/new launcher installations bypass the SQLite mutex | medium | high | Refuse any legacy lock; stop commands and automations, update every copy, then remove only the legacy path; never unlink lock.sqlite |
| A hung writer holds SQLite indefinitely | low | medium | Bounded waits fail without stealing ownership; identify and stop the writer before retrying |
| Node SQLite remains experimental | certain | low | Node 24 supported; lazy import for writes, stderr warning preserved, state JSON format unchanged |
| Unknown server ownership blocks a replacement | low | medium | Fail closed; verify or stop the recorded process before changing the selected server |
| Startup proof fails after spawning the server | low | medium | Refuse success and include URL, log and spawned PIDs in the error; inspect identity before manual recovery |
