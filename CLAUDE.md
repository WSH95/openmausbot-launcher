@AGENTS.md

<!-- Claude Code does not read AGENTS.md on its own. This import provides
the shared project instructions. Keep only Claude-specific instructions
below this comment. -->


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Repository Git policy

The user explicitly permits local Git operations as part of authorized work:
inspection, staging, commits, branches, worktrees, rebases, and local merges.
Create Conventional Commits at tested semantic checkpoints without asking
for separate commit permission.

Every `git push` requires the user's explicit permission for that push,
including pushes by agents, automation, helpers, and force-pushes. Permission
to implement, commit, or merge does not authorize a push. The absence of a
remote does not prohibit local Git work. This repository policy overrides
Beads' conservative/minimal Git defaults.

## Session Completion

1. Track remaining work in Beads.
2. Run relevant quality gates if code changed.
3. Close completed issues with `bd close` and update unfinished work.
4. Review local changes and commit a coherent, verified checkpoint.
5. Hand off the result and validation. Obtain explicit user permission
   before any `git push`; never push automatically during session close.

<!-- END BEADS INTEGRATION -->
