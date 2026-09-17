// Several projects on one server (design, "Several projects"): the folder
// vocabulary every guard compares with, which bots are this team's, and what
// `down` can observe of other work. These are best-effort guards for
// independently imported teams; a configured folder is evidence of
// configuration, not of ownership or activity.
import fs from "node:fs";
import path from "node:path";
import { migrate } from "./state.mjs";
import { openRuns, runLabel } from "./runs.mjs";

export const LIST_MAX = 10;
export const cap = (list) => list.slice(0, LIST_MAX);
const MAX_STATE_BYTES = 8 * 1024 * 1024;

/**
 * A folder as it is compared: its `realpath` when that resolves, else the
 * resolved spelling with what stopped it. `ENOENT` is a missing folder, any
 * other error an unreadable one; neither lexical fallback is evidence that the
 * folder exists.
 */
export function canonical(dir) {
  const resolved = path.resolve(dir);
  try { return { folder: fs.realpathSync(resolved), state: "exists" }; }
  catch (e) { return { folder: resolved, state: e.code === "ENOENT" ? "missing" : "unreadable" }; }
}

/** Equal folders, whole components only: a descendant, a nested project and a
 * linked worktree are other folders, and no comparison is a string prefix. */
export function sameFolder(a, b, { canonicalise = true } = {}) {
  if (typeof a !== "string" || !a || typeof b !== "string" || !b) return false;
  if (!canonicalise) return path.resolve(a) === path.resolve(b);
  return canonical(a).folder === canonical(b).folder;
}

/** The configured folder for new tasks when it is set and is not this
 * project's, else null. A remote observer never tests a server path against
 * its own filesystem, so it reports the folder without an existence state. */
export function configuredOutside(cwd, projectDir, { canonicalise = true } = {}) {
  if (typeof cwd !== "string" || !cwd.trim()) return null;
  if (sameFolder(cwd, projectDir, { canonicalise })) return null;
  return canonicalise ? { folder: cwd, state: canonical(cwd).state } : { folder: cwd };
}

/** The bounded list a guard prints: `{name, cwd}` entries that are configured elsewhere. */
export function outsideFolders(entries, projectDir, opts) {
  const out = [];
  for (const e of entries) {
    const outside = configuredOutside(e.cwd, projectDir, opts);
    if (outside) out.push({ name: e.name, ...outside });
  }
  return out;
}

/** Ten entries and the count of the rest. */
export function describeFolders(list) {
  const shown = cap(list).map((e) => `${e.name} → ${e.folder}${e.state ? ` (${e.state})` : ""}`).join(", ");
  return list.length > LIST_MAX ? `${shown}, and ${list.length - LIST_MAX} more` : shown;
}

/**
 * This team on the verified server: the recorded ids plus every bot in the
 * recorded section, matched exactly (upstream numbers a colliding section, so
 * "X" and "X 2" are different teams, index.ts:9217-9228). A team recorded for
 * another environment, or no team at all, makes no bot this team's.
 */
export function membership(state, environmentId) {
  const team = state?.team;
  const bound = Boolean(team && environmentId && team.environmentId === environmentId);
  const ids = new Set(bound ? [team.lead?.id, ...(team.bots ?? []).map((b) => b.id)].filter(Boolean) : []);
  const section = bound && typeof team.section === "string" && team.section !== "" ? team.section : null;
  const rooms = new Set(bound ? (team.rooms ?? []).map((r) => r.id).filter(Boolean) : []);
  return {
    ours: (bot) => ids.has(bot.id) || (section !== null && bot.section === section),
    ourRoom: (group) => rooms.has(group.id),
  };
}

/** The distinct folders foreign bots are configured for, this project's excluded. */
export function foreignFolders(fleet, { projectDir, ours }) {
  const seen = new Set();
  for (const bot of fleet?.bots ?? []) {
    if (ours(bot)) continue;
    const outside = configuredOutside(bot.cwd, projectDir);
    if (outside) seen.add(canonical(outside.folder).folder);
  }
  return [...seen];
}

/** Another project's state file, read without following a symlink and bounded
 * on the descriptor it is read from. That project's lock is never taken. */
function readForeignState(file) {
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
  catch (e) {
    if (e.code === "ENOENT") return { absent: true };
    return { why: e.code === "ELOOP" ? "the state file is a symlink" : `the state file could not be opened (${e.code ?? e.message})` };
  }
  let text;
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return { why: "the state path is not a regular file" };
    if (stat.size > MAX_STATE_BYTES) return { why: `the state file is larger than ${MAX_STATE_BYTES} bytes` };
    text = fs.readFileSync(fd, "utf8");
  } catch (e) { return { why: `the state file could not be read (${e.code ?? e.message})` }; }
  finally { fs.closeSync(fd); }
  let doc;
  try { doc = JSON.parse(text); } catch { return { why: "the state file is not valid JSON" }; }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { why: "the state file is not a state document" };
  // Each version is validated in its own shape before the pure in-memory
  // migration: version 1 holds one `task`, version 2 holds `runs` (state.mjs:24).
  const object = (v) => v && typeof v === "object" && !Array.isArray(v);
  if (doc.version === 1) { if (doc.task !== undefined && !object(doc.task)) return { why: "the version 1 task is not an object" }; }
  else if (doc.version === 2) {
    if (doc.runs !== undefined && !object(doc.runs)) return { why: "the runs are not an object" };
    if (Object.values(doc.runs ?? {}).some((r) => !object(r))) return { why: "a recorded run is not an object" };
  } else return { why: `state file version ${doc.version} is not one this launcher reads` };
  return { doc: migrate(doc) };
}

/** The open runs a foreign state records on this environment. A run's own
 * saved context decides, else the file's current server; two null ids are never
 * equal, and identity nobody supplies is unknown rather than absent. */
function recordedOpenRuns(doc, environmentId) {
  const labels = []; const unknown = [];
  for (const run of openRuns(doc)) {
    const context = run?.context?.server?.environmentId;
    const id = typeof context === "string" && context ? context
      : typeof doc.server?.environmentId === "string" && doc.server.environmentId ? doc.server.environmentId : null;
    if (id === null) unknown.push(runLabel(run));
    else if (id === environmentId) labels.push(runLabel(run));
  }
  return { labels, unknown };
}

/**
 * What else is running on this server, within an inspection budget of its own.
 * Every source is independent: one that fails or times out keeps every positive
 * the others already found, and says so under `unknown`. Positives are
 * observations of other work, never proof that there is none.
 */
export async function observeOthers({ client, cfg, environmentId, budgetMs = 5_000 }) {
  const deadline = Date.now() + budgetMs;
  const left = () => deadline - Date.now();
  const request = () => ({ timeoutMs: Math.max(1, left()) });
  const { ours, ourRoom } = membership(cfg.state, environmentId);
  const busyBots = []; const waitingBots = []; const delegations = []; const workingRooms = [];
  const projects = []; const sharedConfiguration = []; const unknown = [];
  const spent = (source) => unknown.push({ source, why: "the inspection budget ran out" });

  let fleet = null;
  if (left() <= 0) spent("fleet");
  else try { fleet = await client.get("/api/bots?messages=0", request()); }
  catch (e) { unknown.push({ source: "fleet", why: e.message }); }

  const foreign = (fleet?.bots ?? []).filter((b) => !ours(b));
  for (const bot of foreign) {
    if (bot.activity === "waiting-on-you") waitingBots.push(bot.name);
    else if (bot.busy) busyBots.push(bot.name);
  }
  for (const group of fleet?.groups ?? []) if (group.working && !ourRoom(group)) workingRooms.push(group.name);

  if (!fleet) unknown.push({ source: "team-map", why: "the fleet could not be read, so no delegation has a side" });
  else if (left() <= 0) spent("team-map");
  else {
    try {
      const map = await client.get("/api/team-map", request());
      const byId = new Map((fleet.bots ?? []).map((b) => [b.id, b]));
      for (const [state, list] of [["queued", map.queued ?? []], ["running", map.running ?? []]]) {
        for (const edge of list) {
          const ends = [edge.sourceBotId, edge.targetBotId].map((id) => byId.get(id));
          if (ends.some((b) => !b)) { unknown.push({ source: "team-map", why: `a ${state} delegation names a bot the fleet does not list` }); continue; }
          if (ends.some((b) => !ours(b))) delegations.push({ state, source: ends[0].name, target: ends[1].name });
        }
      }
    } catch (e) { unknown.push({ source: "team-map", why: e.message }); }
  }

  // Only `<folder>/.omb/state.json`, never an ancestor: a state file above a
  // bot's folder says nothing about that bot, and the walk could reach this
  // project's own. A custom --state elsewhere and a bot configured for a
  // sub-folder are documented blind spots.
  const ownProject = canonical(cfg.projectDir).folder;
  const ownState = canonical(cfg.paths.file).folder;
  for (const folder of foreignFolders(fleet, { projectDir: cfg.projectDir, ours })) {
    if (folder === ownProject) continue;
    const file = path.join(folder, ".omb", "state.json");
    if (canonical(file).folder === ownState) continue;
    if (left() <= 0) { spent(folder); continue; }
    const read = readForeignState(file);
    if (read.absent) { sharedConfiguration.push(folder); continue; }
    if (read.why) { unknown.push({ source: folder, why: read.why }); continue; }
    const { labels, unknown: unidentified } = recordedOpenRuns(read.doc, environmentId);
    if (unidentified.length) unknown.push({ source: folder, why: `${unidentified.length} recorded open run(s) name no environment` });
    if (labels.length) projects.push({ folder, runs: cap(labels) });
  }

  const ownOpenRuns = openRuns(cfg.state).map(runLabel);
  const lists = { busyBots, waitingBots, delegations, workingRooms, projects, sharedConfiguration, unknown, ownOpenRuns };
  const others = { counts: Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.length])) };
  for (const [key, list] of Object.entries(lists)) others[key] = cap(list);
  return { others, blocking: busyBots.length + waitingBots.length + delegations.length + workingRooms.length + projects.length > 0 };
}

/** What a refusal or an override says it saw, in words and without a path. */
export function describeOthers(others) {
  const parts = [
    others.counts.busyBots && `${others.counts.busyBots} busy bot(s) that are not this team's`,
    others.counts.waitingBots && `${others.counts.waitingBots} bot(s) waiting on a card`,
    others.counts.delegations && `${others.counts.delegations} delegation(s) with a foreign bot`,
    others.counts.workingRooms && `${others.counts.workingRooms} working room(s)`,
    others.counts.projects && `${others.counts.projects} other project(s) with a recorded open run`,
  ].filter(Boolean);
  return parts.join(", ");
}
