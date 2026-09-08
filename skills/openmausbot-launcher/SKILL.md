---
name: openmausbot-launcher
description: Operate a local OpenMausBot (OMB) multi-bot server as the user's launcher. Starts and stops the headless server, imports a team package (.openmaus.json), binds the team to a project with engines and effort, sends a task brief to the lead bot, watches progress, relays the lead's questions and approval cards to the user and the answers back, reconciles the repository between tasks, cleans up orphaned processes and worktrees, and reports with evidence. Use when the user mentions OpenMausBot, OMB, "the team", "the lead" or Sudo, a team package, running a task (T10, a bead, a TODO item) through the bots, or wants to drive the bots from a phone or Telegram. Drives scripts/omb.mjs over the local HTTP API; never modifies OpenMausBot.
license: MIT
compatibility: Node 24 and the openmausbot npm package 0.1.56 (headless server, not the desktop app) on this Linux machine, or a paired session token for status, watch, send, and answer only; git; the project must be a git repository with a test command.
metadata:
  version: "0.1.0"
  author: wsh
  omb-version: "0.1.56"
---

# OpenMausBot launcher

The body is written in step 12 of `docs/design.md`; the section outline is
fixed here so the size test and the references can be built against it.

## 1. You are the operator

## 2. Setup once per project

## 3. Per task

## 4. Reading `watch`

## 5. Answering

## 6. Finish and clean up

## 7. Guardrails

## 8. Hosts and phone mode

## 9. References

- `references/api.md`
- `references/limits-and-pitfalls.md`
- `references/hosts.md`
- `references/dev-team.md`
- `references/evidence.md`
