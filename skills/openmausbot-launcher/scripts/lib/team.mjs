// Team helpers shared by the verbs: engine specs, bot lookup, Project facts.
import { EXIT, Fail } from "./cli.mjs";

/** "eng/model[/effort]" -> { instanceId, model, effort? } */
export function parseEngineSpec(spec) {
  const m = /^([\w.-]+)\/([^/]+?)(?:\/([\w-]+))?$/.exec(String(spec).trim());
  if (!m) throw new Fail(EXIT.USAGE, `bad engine spec "${spec}"`, { hint: "use <engine>/<model>[/<effort>], e.g. claude/claude-sonnet-5/high" });
  return { instanceId: m[1], model: m[2], ...(m[3] ? { effort: m[3] } : {}) };
}

export const specString = (s) => (s ? `${s.instanceId}/${s.model}${s.effort ? `/${s.effort}` : ""}` : null);
export const sameSelection = (a, b) => Boolean(a && b) && a.instanceId === b.instanceId && a.model === b.model && (a.effort ?? null) === (b.effort ?? null);

/** Find a team bot by id, name, key, or title (case-insensitive for name and title). */
export function findBot(team, ref) {
  const bots = team?.bots ?? [];
  const r = String(ref).trim().toLowerCase();
  return bots.find((b) => b.id === ref) ?? bots.find((b) => b.key === r) ?? bots.find((b) => (b.name ?? "").toLowerCase() === r) ?? bots.find((b) => (b.title ?? "").toLowerCase() === r) ?? null;
}

export const isReviewer = (bot) => /review/i.test(bot.title ?? "") || /review/i.test(bot.name ?? "");

/** A numbered copy of a name: "Sudo 2" matches "Sudo". */
export const sameName = (returned, wanted) => returned === wanted || new RegExp(`^${wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\d+$`).test(returned);

export const FACT_FIELDS = [
  ["defaultBranch", "default branch"], ["test", "Test command"], ["setup", "Setup command (run once in each new worktree)"],
  ["merge", "Merge policy"], ["taskLog", "Task log"], ["tracker", "Task tracker"], ["planReview", "Plan review"],
];
export const FACTS_MARKER = "Project facts";

/** Parse the fields out of an existing "Project facts" block: values run from a label's colon to the next label. */
export function parseFacts(block) {
  const lower = block.toLowerCase();
  const found = [];
  for (const [key, label] of FACT_FIELDS) {
    const i = lower.indexOf(`${label.toLowerCase()}:`);
    if (i >= 0) found.push({ key, start: i, valueStart: i + label.length + 1 });
  }
  found.sort((a, b) => a.start - b.start);
  const out = {};
  found.forEach((f, n) => {
    const end = n + 1 < found.length ? found[n + 1].start : block.length;
    out[f.key] = block.slice(f.valueStart, end).trim().replace(/\.$/, "").trim();
  });
  return out;
}

export function renderFacts(f) {
  return `${FACTS_MARKER}: default branch: ${f.defaultBranch}. Test command: ${f.test}. Setup command (run once in each new worktree): ${f.setup}. Merge policy: ${f.merge}. Task log: ${f.taskLog}. Task tracker: ${f.tracker}. Plan review: ${f.planReview}.`;
}

/** Replace the block from the marker to the end of the description. */
export function replaceFactsBlock(description, block, { append = false } = {}) {
  const i = description.indexOf(FACTS_MARKER);
  if (i < 0) {
    if (!append) throw new Fail(EXIT.PRECONDITION, `the lead's description has no "${FACTS_MARKER}" marker`, { hint: "pass --append to add the block at the end" });
    return `${description.trimEnd()}\n${block}`;
  }
  return `${description.slice(0, i)}${block}`;
}
