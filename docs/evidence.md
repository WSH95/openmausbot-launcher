# Evidence

Every claim about a real run goes here with the command, the OpenMausBot
version, and the ids involved. Fake-server test runs are not evidence.

## 2026-09-08 — detached-survival spike on the three installed hosts (design step 4)

Question: does a server started by `omb.mjs up` outlive the agent's shell
call on each host, and does ownership verification hold across shells?
Driver at commit after step 3 (`7d822fc`) plus the step-4 lifecycle code.
No bot turns were spent: a server alone costs nothing.

| Host | How `up` ran | Result |
|---|---|---|
| Claude Code 2.1.263 (this session's Bash tool) | real `openmausbot` 0.1.56 (`OMB_BIN=~/.cache/agent-team/openmausbot-cli/node_modules/openmausbot/cli.js`), `up --port 8897 --data-dir ~/.cache/agent-team/omb-launcher-spike/data` | owned: supervisor 333306, server 333313 (PPid 333306), environment `d2ff5834-…`; a later shell call got `{"app":"openmausbot","pid":333313}`; `doctor --server` passed all ten checks (loopback admin, engines grok/claude/codex available, no provider keys in the server's environment, identity matches); `down` stopped both pids |
| Grok Build 1.0.13 (`grok -p … --permission-mode bypassPermissions`) | fake server (`tests/fixtures/fake-omb.mjs`), `up --port 8895` | owned: supervisor 335693, server 335700; health answered from this shell after Grok exited; `down --project …/grok-repo` from this shell stopped it |
| Codex CLI 0.153.4 (`codex exec --sandbox workspace-write`) | fake server, `up --port 8896` | **failed in 236 ms**: the server child died with `listen EPERM: operation not permitted 127.0.0.1:8896` (serve.log); the sandbox denies listening sockets |
| Codex CLI 0.153.4 (`codex exec --sandbox danger-full-access`, modelling an approved escalation) | fake server, `up --port 8894` | owned: supervisor 336607, server 336614; health answered from this shell after Codex exited; `down` from this shell stopped it |

Conclusion: `up` works from Claude Code and Grok Build as is; on Codex it
needs a command run outside the workspace-write sandbox (an escalation
approval), or a server started elsewhere and `up` used to attach. `up`
now reads the server log on a startup failure and names the sandbox cause
in its hint. Logs: `~/.cache/agent-team/omb-launcher-spike/`.
