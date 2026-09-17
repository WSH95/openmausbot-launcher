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
const CHUNK_BYTES = 64 * 1024;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v) => (typeof v === "string" && v !== "" ? v : null);

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

/** The name a list prints for a record whose own name is missing. */
export const botName = (bot) => text(bot?.name) ?? "unnamed bot";

/**
 * The bots and rooms a `/api/bots` answer really carries. An entry that is not
 * an object with an id is dropped and counted rather than trusted: malformed
 * data must not throw past a guard and erase what the same answer proved. A
 * body that is not the documented shape at all is a read that failed.
 */
export function fleetOf(body) {
  if (!isObject(body)) throw new Error("the fleet answer is not an object");
  const list = (value, what) => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error(`the fleet answer's ${what} are not a list`);
    return value;
  };
  const bots = list(body.bots, "bots");
  const groups = list(body.groups, "rooms");
  const usable = (x) => isObject(x) && text(x.id) !== null;
  const kept = { bots: bots.filter(usable), groups: groups.filter(usable) };
  return { ...kept, dropped: bots.length - kept.bots.length + (groups.length - kept.groups.length) };
}

/** The queued and running edges a `/api/team-map` answer carries, by id. */
export function edgesOf(body) {
  if (!isObject(body)) throw new Error("the team map is not an object");
  const edges = []; let dropped = 0;
  for (const state of ["queued", "running"]) {
    const value = body[state];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) throw new Error(`the team map's ${state} work is not a list`);
    for (const edge of value) {
      if (isObject(edge) && text(edge.sourceBotId) && text(edge.targetBotId)) edges.push({ state, source: edge.sourceBotId, target: edge.targetBotId });
      else dropped += 1;
    }
  }
  return { edges, dropped };
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

/**
 * Another project's state file, read without following a symlink and bounded
 * by the read itself: a file that is small when it is opened and grows in place
 * is still refused at the limit, whatever `fstat` said. That project's lock is
 * never taken, and a failed close never escapes this guard. `io` exists so a
 * test can stage a descriptor that outgrows its own stat.
 */
export function readForeignState(file, io = fs) {
  let fd;
  try { fd = io.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
  catch (e) {
    if (e.code === "ENOENT") return { absent: true };
    return { why: e.code === "ELOOP" ? "the state file is a symlink" : `the state file could not be opened (${e.code ?? e.message})` };
  }
  let raw;
  try {
    if (!io.fstatSync(fd).isFile()) return { why: "the state path is not a regular file" };
    const chunks = []; let total = 0;
    for (;;) {
      const buf = Buffer.allocUnsafe(CHUNK_BYTES);
      const read = io.readSync(fd, buf, 0, CHUNK_BYTES, null);
      if (!read) break;
      total += read;
      if (total > MAX_STATE_BYTES) return { why: `the state file is larger than ${MAX_STATE_BYTES} bytes` };
      chunks.push(read === CHUNK_BYTES ? buf : buf.subarray(0, read));
    }
    raw = Buffer.concat(chunks, total).toString("utf8");
  } catch (e) { return { why: `the state file could not be read (${e.code ?? e.message})` }; }
  finally { try { io.closeSync(fd); } catch {} }
  let doc;
  try { doc = JSON.parse(raw); } catch { return { why: "the state file is not valid JSON" }; }
  if (!isObject(doc)) return { why: "the state file is not a state document" };
  // Each version is validated in the shape that version really has, before the
  // pure in-memory migration: version 1 holds one `task`, which older launchers
  // wrote as `null` when nothing was open, and version 2 holds `runs`
  // (state.mjs:24-33). A missing required field is unknown, never a negative.
  if (doc.version === 1) {
    if (!("task" in doc)) return { why: "the version 1 state has no task field" };
    if (doc.task !== null && !isObject(doc.task)) return { why: "the version 1 task is neither null nor an object" };
  } else if (doc.version === 2) {
    if (!isObject(doc.runs)) return { why: "the version 2 state has no runs object" };
    if (Object.values(doc.runs).some((r) => !isObject(r))) return { why: "a recorded run is not an object" };
  } else return { why: `state file version ${doc.version} is not one this launcher reads` };
  return { doc: migrate(doc) };
}

/** The open runs a foreign state records on this environment. A run's own saved
 * context decides, else the file's current server; two null ids are never equal,
 * two present and unequal ids are a contradiction, and identity nobody supplied
 * is unknown rather than absent. */
function recordedOpenRuns(doc, environmentId) {
  const labels = []; const unclear = new Set();
  for (const run of openRuns(doc)) {
    const context = text(run?.context?.server?.environmentId);
    const file = text(doc.server?.environmentId);
    if (context && file && context !== file) { unclear.add("contradictory environment identity"); continue; }
    const id = context ?? file;
    if (!id) { unclear.add("a recorded open run names no environment"); continue; }
    if (id === environmentId) labels.push(runLabel(run));
  }
  return { labels, unclear: [...unclear] };
}

/**
 * What else is running on this server, within an inspection budget of its own,
 * measured on a monotonic clock. Every source is independent: one that fails or
 * times out keeps every positive the others already found, and says so under
 * `unknown`. A budget that runs out stops the loops and is reported once per
 * loop with the number of candidates left. Positives are observations of other
 * work, never proof that there is none; a synchronous filesystem call that
 * stalls is an accepted limitation.
 */
export async function observeOthers({ client, cfg, environmentId, budgetMs = 5_000 }) {
  const deadline = performance.now() + budgetMs;
  const left = () => deadline - performance.now();
  const request = () => ({ timeoutMs: Math.max(1, left()) });
  const { ours, ourRoom } = membership(cfg.state, environmentId);
  const busyBots = []; const waitingBots = []; const delegations = []; const workingRooms = [];
  const projects = []; const sharedConfiguration = []; const unknown = [];
  const note = (source, why) => unknown.push({ source, why });
  const ranOut = (source, count, what) => note(source, `${count} ${what} were not inspected: the inspection budget ran out`);

  let fleet = null;
  if (left() <= 0) note("fleet", "the inspection budget ran out");
  else try { fleet = fleetOf(await client.get("/api/bots?messages=0", request())); }
  catch (e) { note("fleet", e.message); }
  if (fleet?.dropped) note("fleet", `${fleet.dropped} entr${fleet.dropped === 1 ? "y" : "ies"} in the fleet answer could not be read`);

  const byId = new Map();
  const foreign = [];
  if (fleet) {
    let index = 0;
    for (; index < fleet.bots.length; index++) {
      if (left() <= 0) break;
      const bot = fleet.bots[index];
      byId.set(bot.id, bot);
      if (ours(bot)) continue;
      foreign.push(bot);
      if (bot.activity === "waiting-on-you") waitingBots.push(botName(bot));
      else if (bot.busy === true) busyBots.push(botName(bot));
    }
    if (index < fleet.bots.length) ranOut("fleet", fleet.bots.length - index, "bot(s)");
    let room = 0;
    for (; room < fleet.groups.length; room++) {
      if (left() <= 0) break;
      const group = fleet.groups[room];
      if (group.working === true && !ourRoom(group)) workingRooms.push(botName(group));
    }
    if (room < fleet.groups.length) ranOut("fleet", fleet.groups.length - room, "room(s)");
  }

  if (!fleet) note("team-map", "the fleet could not be read, so no delegation has a side");
  else if (left() <= 0) note("team-map", "the inspection budget ran out");
  else {
    try {
      const { edges, dropped } = edgesOf(await client.get("/api/team-map", request()));
      if (dropped) note("team-map", `${dropped} delegation(s) named no source or target`);
      for (const edge of edges) {
        const ends = [byId.get(edge.source) ?? null, byId.get(edge.target) ?? null];
        // A delegation with one known foreign end is observed work whether or
        // not the other end was in the fleet snapshot; only an edge with no
        // known foreign end is merely uncertain.
        if (ends.some((b) => b && !ours(b))) delegations.push({ state: edge.state, source: ends[0] ? botName(ends[0]) : "unknown bot", target: ends[1] ? botName(ends[1]) : "unknown bot" });
        if (ends.some((b) => !b)) note("team-map", `a ${edge.state} delegation names a bot the fleet does not list`);
      }
    } catch (e) { note("team-map", e.message); }
  }

  // Only `<folder>/.omb/state.json`, never an ancestor: a state file above a
  // bot's folder says nothing about that bot, and the walk could reach this
  // project's own. A custom --state elsewhere and a bot configured for a
  // sub-folder are documented blind spots.
  const ownProject = canonical(cfg.projectDir).folder;
  const ownState = canonical(cfg.paths.file).folder;
  const folders = new Set();
  let collected = 0;
  for (; collected < foreign.length; collected++) {
    if (left() <= 0) break;
    const cwd = foreign[collected].cwd;
    if (typeof cwd !== "string" || !cwd.trim()) continue;
    const folder = canonical(cwd).folder;
    if (folder !== ownProject) folders.add(folder);
  }
  if (collected < foreign.length) ranOut("folders", foreign.length - collected, "bot folder(s)");
  const candidates = [...folders];
  let inspected = 0;
  for (; inspected < candidates.length; inspected++) {
    if (left() <= 0) break;
    const folder = candidates[inspected];
    const file = path.join(folder, ".omb", "state.json");
    if (canonical(file).folder === ownState) continue;
    const read = readForeignState(file);
    if (read.absent) { sharedConfiguration.push(folder); continue; }
    if (read.why) { note(folder, read.why); continue; }
    const { labels, unclear } = recordedOpenRuns(read.doc, environmentId);
    for (const why of unclear) note(folder, why);
    if (labels.length) projects.push({ folder, runs: cap(labels) });
  }
  if (inspected < candidates.length) ranOut("folders", candidates.length - inspected, "folder(s)");

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

/** The same observation in counts alone: a brief never prints a folder. */
export function briefOthers(others) {
  const parts = [
    others.counts.busyBots && `${others.counts.busyBots} busy`,
    others.counts.waitingBots && `${others.counts.waitingBots} waiting`,
    others.counts.delegations && `${others.counts.delegations} delegation(s)`,
    others.counts.workingRooms && `${others.counts.workingRooms} working room(s)`,
    others.counts.projects && `${others.counts.projects} other project(s)`,
  ].filter(Boolean);
  return `${parts.join(", ") || "nothing"} · ${others.counts.unknown} unknown`;
}
