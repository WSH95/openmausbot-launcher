// The runs a state document holds and how a verb picks one (design, "State").
// One brief per run; several runs may be open at once, so every run-scoped
// verb needs a selector and an unambiguous way to name the candidates.
import { EXIT, Fail } from "./cli.mjs";

export const shortId = (runId) => String(runId ?? "").slice(0, 8);

/** How a run is named in a list the user has to choose from. */
export const runLabel = (run) => `${run?.slug ?? run?.title ?? shortId(run?.runId)} (${shortId(run?.runId)}, ${run?.status ?? "unknown"})`;

/** Every run that is not closed, oldest first. */
export function openRuns(doc) {
  return Object.values(doc?.runs ?? {})
    .filter((r) => r && r.status !== "closed")
    .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")) || String(a.runId).localeCompare(String(b.runId)));
}

const listed = (doc) => [...openRuns(doc), ...(doc?.history ?? [])];

/** A reference is a run id or an unambiguous prefix of one, a slug, a title, or the run's tag. */
const matches = (run, ref) => run.runId === ref || (typeof run.runId === "string" && ref.length >= 4 && run.runId.startsWith(ref)) || run.slug === ref || run.title === ref || run.tag === ref;

/** Open runs first, then the history; `last` is the newest closed run. Null when nothing matches. */
export function findRun(doc, ref) {
  if (!ref) return null;
  if (ref === "last") return (doc?.history ?? []).at(-1) ?? null;
  for (const list of [openRuns(doc), Object.values(doc?.runs ?? {}).filter((r) => r?.status === "closed"), doc?.history ?? []]) {
    const hits = list.filter((r) => r && matches(r, ref));
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) throw new Fail(EXIT.PRECONDITION, `${hits.length} runs match ${ref}`, { hint: hits.map(runLabel).join(", ") });
  }
  return null;
}

const known = (doc) => {
  const open = openRuns(doc);
  if (open.length) return `open: ${open.map(runLabel).join(", ")}`;
  const history = doc?.history ?? [];
  return history.length ? `no run is open; --run last re-reads ${runLabel(history.at(-1))}` : "no run is open and the history is empty";
};

/**
 * The run a verb acts on: the named one, else the only open one. Several open
 * runs without a reference is a question for the user, never a guess.
 */
export function selectRun(doc, ref) {
  if (ref) {
    const run = findRun(doc, ref);
    if (!run) throw new Fail(EXIT.PRECONDITION, `no run ${ref}`, { hint: known(doc) });
    return run;
  }
  const open = openRuns(doc);
  if (open.length === 1) return open[0];
  if (!open.length) throw new Fail(EXIT.PRECONDITION, "no open run", { hint: known(doc) });
  throw new Fail(EXIT.PRECONDITION, `${open.length} runs are open; pass --run`, { hint: open.map(runLabel).join(", ") });
}
