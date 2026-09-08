# Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Codex's workspace-write sandbox blocks listening sockets and loopback HTTP | certain in the recorded configuration | medium | Evidenced on real OMB 0.1.56 (M1 review, tier 2): `up` exits 1 with `listen EPERM` and names the sandbox in its hint (finding 24 fixed); `status` exits 1 with a network error naming the URL (finding 26 fixed). Run network commands with escalation or under `danger-full-access`, or attach `up` to a user-started server. Long SSE inside the sandbox remains unverified |
| OpenClaw `--announce` on empty output and allowlist argument syntax unverified | high | low | Documented as unverified; follow-up bead once OpenClaw is installed |
| The lead omits the run marker | low | low | `attention` after quiet; the agent reads the closing report |
| OpenMausBot churn (daily releases) | high | medium | Pin 0.1.56 in `compatibility` and `metadata.omb-version`; `references/api.md` carries source lines; routes read from the pinned clone only |
| Lifecycle is Linux-only (`/proc` ancestry and start times) | certain | low | macOS gets `attached` mode; Windows unsupported |
| Long tasks need many `watch` calls under host exec limits | certain | low | Each call rehydrates under a bounded deadline and observes its own quiet window; reserve one extra second for checkpoint contention |
| Numbered names after re-import ("Sudo 2") | medium | low | Ids everywhere; `--adopt` by name must name the team |
| Bot turns on the user's subscriptions | certain | medium | Keep real runs bounded and record their counts; T12, the three leader acknowledgment turns, the review's 6 turns and T13's 9 turns each have separate evidence. Native host CLI sessions also consume the user's subscriptions |
| Mixed old/new launcher installations bypass the SQLite mutex | medium | high | Refuse any legacy lock; stop commands and automations, update every copy, then remove only the legacy path; never unlink lock.sqlite |
| A hung writer holds SQLite indefinitely | low | medium | Bounded waits fail without stealing ownership; identify and stop the writer before retrying |
| Node SQLite remains experimental | certain | low | Node 24 supported; lazy import for writes, stderr warning preserved, state JSON format unchanged |
| Unknown server ownership blocks a replacement | low | medium | Fail closed; verify or stop the recorded process before changing the selected server |
| Startup proof fails after spawning the server | low | medium | Refuse success and include URL, log and spawned PIDs in the error; inspect identity before manual recovery |
| `report --check-042` depends on the native-log parser recognising the lead's engine | low | medium | `nativeCalls` reads Claude-SDK blocks and Codex JSON-RPC `item/*` entries (finding 6 fixed; T13's `--check-042` scored a Codex lead 8/9 from a 1.25 MB `codex.app-server` log). A Grok lead's log shape is still unread and would return `unknown`; an `unknown` check is never a pass |
| An identical `send` in one run is a server-side no-op | low | low | `send` reports `duplicate: true` when the server returns the canonical receipt for an already-used `sendId` (finding 8 fixed); `--again` delivers the same text once more |
| The facts test command lives in the lead's description, which a bot can edit | low | medium | `facts` takes the test and setup commands only from the operator's flags or stored facts, never from the lead's block, and `beadStatus` is bounded (finding 10 fixed). Still set `facts --test` explicitly and read `facts` output before `report` |
| `up --port N` also occupies N+1 for OMB's webhook ingress | certain | low | `up` checks N+1 before spawning, reports `ports`, and explains a `404 Unknown webhook endpoint` as a webhook-port collision (finding 23 fixed). Space concurrent servers two ports apart |
