# Open questions

Record questions that the repository does not answer instead of guessing.
Add the answer to the item when it is resolved.

- [x] Does an OpenClaw automation with `--announce` deliver an empty message
      when the command prints nothing? **No** (verified 2026-09-16 on OpenClaw
      2026.9.4). Job `omb-empty` ran `true` and its run recorded
      `delivered: false`, `deliveryStatus: "not-delivered"`,
      `deliverySuppressionReason: "empty"`; the companion job running
      `status --brief` recorded `delivered: true` with the summary
      `status · no run · team idle`. So `--quiet-if-unchanged` costs no empty
      messages. Record: `docs/evidence.md`, "v2 host verification".
- [x] Does DeepSeek Harness load `~/.agents/skills` in the release the user
      runs? **Yes** (verified 2026-09-16 on dsh 0.1.5-rc.1). The session prompt
      lists `openmausbot-launcher` with its description among the available
      skills, and the skill tool resolves its base directory to
      `/home/wsh/.agents/skills/openmausbot-launcher`, the only install
      location on this machine. The tier numbers third-party posts quote
      (500 for `~/.agents/skills`, 200 for a project's `.agents/skills`) were
      not verified and are not relied on anywhere.
