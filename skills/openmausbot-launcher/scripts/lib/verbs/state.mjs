// state --show: the state file exactly as the driver reads it. No lock, no
// request, works remote (design: the verb table and "Modes").
import { verb, EXIT, Fail } from "../cli.mjs";
import { resolveConfig } from "../config.mjs";

verb("state", {
  options: { show: { type: "boolean" } },
  handler: async ({ flags }) => {
    const cfg = resolveConfig(flags);
    const doc = cfg.state;
    if (!doc) throw new Fail(EXIT.PRECONDITION, `no state at ${cfg.paths.file}`, { hint: "import a team or run up to create it" });
    const server = doc.server ? `${doc.server.url} (${doc.server.owned ? "owned" : "attached"})` : "none";
    const task = doc.task ? `${doc.task.title} ${doc.task.status}` : "none";
    return { result: { path: cfg.paths.file, state: doc }, brief: `state · ${cfg.paths.file} · rev ${doc.rev} · server ${server} · team ${doc.team?.section ?? "none"} · task ${task}` };
  },
});
