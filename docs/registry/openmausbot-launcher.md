## Skills

- [openmausbot-launcher](#openmausbot-launcher-use-case) - operate a headless OpenMausBot bot team from your agent host: start and stop the server, import or write a team package, bind engines, brief the lead bot, watch the delegation chain, relay its questions and your answers, reconcile the repository, clean up, report.

### Use Case

#### openmausbot-launcher Use Case

Use openmausbot-launcher when you have, or want, an OpenMausBot bot team and would rather drive it from your agent host - Claude Code, Codex CLI, Grok Build, OpenClaw, Hermes Agent or DeepSeek Harness - than from the desktop app. The skill is user-invoked: it runs only when you ask for it by name. It needs a separately installed `openmausbot` 0.1.56 (the headless server, on `PATH` or named by `OMB_BIN`), Node 24, and a git project with a test command; every bot turn runs a real coding CLI on your own subscriptions. Setting a project up starts with `doctor`; the operator's own instructions are the skill's `SKILL.md`, and `README.md` inside the skill is the entry point for the person installing it.

Example interactions:

- `/openmausbot-launcher do T10 in ~/proj` - on first use it sets the project up (doctor, server, import, bind, facts), then briefs the lead and watches the chain until it settles or needs you.
- `/openmausbot-launcher write a team package for reviewing pull requests` - an interview, one question at a time; a summary you confirm; then the `.openmaus.json` file, validated offline before you import it.
- `/openmausbot-launcher status --project ~/proj` - one snapshot of the team and its open runs, no bot turn spent.
- `/openmausbot_launcher status` in an OpenClaw Telegram chat - the same from a phone; `$openmausbot-launcher <request>` in Codex.
