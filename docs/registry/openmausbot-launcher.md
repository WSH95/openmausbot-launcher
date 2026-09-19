## Skills

- [openmausbot-launcher](#openmausbot-launcher-use-case) - run an OpenMausBot bot team from your agent host: load a team package (`.openmaus.json`), bind engines, brief the lead bot, watch the delegation chain, relay its questions and your answers, clean up, report.

### Use Case

#### openmausbot-launcher Use Case

Use openmausbot-launcher to drive a headless OpenMausBot bot team from Claude Code, Codex CLI, Grok Build, OpenClaw, Hermes Agent or DeepSeek Harness instead of the desktop app. You need the `openmausbot` 0.1.56 package installed separately (on `PATH` or named by `OMB_BIN`), Node 24, the engine CLIs your team uses, and a git project with a test command. The bots run real coding CLIs on your own subscriptions. The skill is user-invoked: it runs only when you ask for it by name.

A team is a `.openmaus.json` package (`format: "openmaus.package"`: the bots, their titles and instructions, the chief of staff you talk to, rooms). Load it once per project: on your first task the skill asks for the file, the engines and the test command, then runs `doctor`, `up`, `import`, `bind` and `facts` for you; `import` creates the bots on the server. No package yet? The skill writes one with you. Any file can be checked first with `node scripts/omb.mjs validate <file>`, offline, in the server's own words.

Example interactions:

- `/openmausbot-launcher do T10 in ~/proj` - first use loads your package and binds the engines, then briefs the lead and watches until it settles or needs you.
- `/openmausbot-launcher write a team package for reviewing pull requests` - an interview, one question at a time; a summary you confirm; then the file, validated.
- `/openmausbot-launcher status --project ~/proj` - one snapshot of the team and its runs, no bot turn spent.
- `/openmausbot_launcher status` in an OpenClaw Telegram chat - the same from a phone; `$openmausbot-launcher <request>` in Codex.
