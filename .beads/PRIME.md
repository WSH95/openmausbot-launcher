# Beads workflow context

Read `AGENTS.md` and `.project-steward/HANDOFF.md` for project context.
This project override replaces Beads' blanket Git restriction for a
repository without a remote. It does not change Beads task storage.

## Git authority

- Local Git operations are permitted as part of authorized work: inspection,
  staging, commits, branches, worktrees, rebases, and local merges.
- Create Conventional Commits at tested semantic checkpoints, including
  `.project-steward/`. Separate permission for local commits is not needed.
- Every `git push` requires the user's explicit permission for that push.
  This includes force-pushes and pushes by agents, automation, or helpers.
  Permission to implement, commit, merge, or finish a task is not permission
  to push. Never push automatically during session close.
- A missing remote limits where changes can be pushed; it does not prohibit
  local Git operations. Beads' conservative/minimal defaults do not replace
  this explicit project policy.

## Task workflow

- Use `bd` for all task tracking; do not create parallel markdown task lists.
- Start with `bd ready` and `bd show <id>`. Create new work with
  `bd create "title" --description="scope" --type=task --priority=2`, then
  claim it with `bd update <id> --claim` before implementation.
- Use `bd update` for status, notes, and scope; `bd dep add` for dependencies.
- At session start or after compaction, read `bd memories --json`
  for current persistent knowledge. Store updates with `bd remember`;
  do not create MEMORY.md files.
- Before completion, run the relevant checks and `bd close <id>` for finished
  work. Track remaining work, review and commit the verified local checkpoint,
  and update the handoff. Obtain explicit user permission before any push.
- Use `bd <command> --help` for command details. Do not use interactive `bd edit`.
