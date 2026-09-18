// The OpenMausBot 0.1.56 team-package contract, offline. Pure: this module
// imports nothing, so the driver, the tests and any reader can use it without
// a server, a project or a state file.
//
// Every constant and every message below is transcribed from the pinned source
// (`~/.cache/agent-team/openmausbot-src`, 0.1.56) with its `file:line`:
// `server/bot-package.ts` for the schema and the cross-references,
// `server/schema.ts:14-19` for how the server renders one issue into its 400,
// and zod 4.4.3 (`package.json:98`) for the default messages, read off
// `node_modules/zod/v4/locales/en.js:50-107` and `core/checks.js:97-190`.
// zod is never imported: a dependency-free driver encodes the contract it
// was read from, and the tests pin every word of it.

export const FORMAT = "openmaus.package"; // bot-package.ts:8
export const VERSION = 1; // bot-package.ts:9
export const BOTMRR = /^---\r?\n[\s\S]*?\bbotmrr:\s*1\b/m; // bot-package.ts:134 (isBotPackage on a string)
export const COLORS = ["green", "blue", "red", "orange", "purple", "cyan", "pink", "yellow", "teal", "coral"]; // bot-package.ts:12-23
export const KEY = /^[a-z0-9][a-z0-9_-]*$/; // bot-package.ts:35 "may only contain lowercase letters, numbers, - and _"
export const SLUG = /^[a-z0-9][a-z0-9-]*$/; // bot-package.ts:44 "must be a lowercase slug"
export const SEMVER = /^\d+\.\d+\.\d+$/; // bot-package.ts:45 "must be semantic versioning"
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/; // bot-package.ts:100 "must use HH:MM"

/** Character and item limits, `[min, max]` where the schema sets both. bot-package.ts:35-124. */
export const LIMITS = {
  key: 64, // :35
  id: 80, release: 30, name: 100, tagline: 160, summary: 2000, category: 80, // :44-49
  authorName: 100, authorUrl: 500, license: 80, // :50-51
  tag: 80, tags: 30, // :53
  outcome: 240, outcomes: [1, 12], setupMinutes: [1, 240], // :54-55
  apps: 30, appLabel: 100, appReason: 240, capability: 80, capabilities: 20, platform: 80, platforms: 10, // :57-64
  agents: [1, 200], agentName: 100, agentTitle: 200, agentDescription: 4000, // :66-70, :77
  mascotExpression: 80, mascotBody: 40, agentPlaybooks: 40, // :73-76
  rooms: 30, roomName: 100, roomMembers: [1, 200], bulletin: 12000, // :79-83, :89
  routines: 50, routineName: 80, prompt: 20000, // :92, :94, :112
  time: 5, weekdays: [1, 7], weekday: [0, 6], everyMinutes: [5, 1440], // :100-105
  anchorAt: [0, 8_640_000_000_000_000], // :106, MAX_DATE_MS at :38
  durationMinutes: [5, 240], timeoutMinutes: [5, 240], // :109-110
  playbooks: 80, playbookName: 100, playbookSummary: 300, triggers: [1, 30], trigger: 100, instructions: 24000, // :115-119
  examples: 12, exampleTitle: 120, exampleInput: 4000, exampleOutput: 8000, // :121-124
};
// `schedule.at` (:97) is `z.number().int()` alone: it carries no range, so only
// zod's own safe-integer bounds apply to it, and they name the origin `int`.
export const SAFE_INT = [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]; // zod v4 core/checks.js:97-170

/** Limits nobody enforces on a package, but that decide whether its text survives. */
export const ADVISORY = {
  createBotInstructions: 1000, // index.ts:8201-8203 (create_bot refuses longer instructions)
  leadDescriptionBudget: 3900, // agent-team-devpack scripts/check-pack.mjs:13; facts refuses at 4000 (verbs/team.mjs:262)
  descriptionCap: 4000, // shared/bot-profile.ts:5
  playbookMountPerBot: 24000, // installed-playbooks.ts:3 (three matching playbooks), :4 (the instruction budget)
  fileSuffix: ".openmaus.json",
};
/** The same value as team.mjs:30; duplicated so this module imports nothing. */
export const FACTS_MARKER = "Project facts";

/** JSON.parse whose refusal never quotes the file. Node 24 puts a snippet of the
 * input in its SyntaxError (`Unexpected token 's', "sk-…"`), and the file the
 * user pointed at may be the wrong one — a token, a key, a private note. */
export function parseJsonFile(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const at = /position (\d+)/.exec(e.message);
    throw new SyntaxError(at ? `not JSON (SyntaxError at position ${at[1]})` : "not JSON");
  }
}

// --- the schema walk --------------------------------------------------------
// Issues are collected in zod's own order, so `errors[0]` is the single issue
// `schema.ts:14-19` would render into the server's 400: object keys in shape
// order, arrays depth first with the elements before the array's own size
// checks, and every check of one field run even after an earlier one failed.

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const join = (p, k) => (p ? `${p}.${k}` : String(k));
/** zod's `util.parsedType`, with the locale's `nan -> NaN` display (locales/en.js:45-47). */
const received = (v) => {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number" && Number.isNaN(v)) return "NaN";
  return typeof v;
};
const quote = (v) => (typeof v === "string" ? `"${v}"` : String(v)); // zod util.stringifyPrimitive
/** What a size check would measure on a value of the wrong type, or null when
 * there is nothing to measure and zod pushes no size issue at all. */
const lengthOf = (v) => (typeof v?.length === "number" ? v.length : null);

class Walk {
  constructor() { this.errors = []; this.unknown = []; }
  bad(path, message) { this.errors.push({ path, message, kind: "schema" }); }

  /** An object of the declared shape. Keys the schema does not declare are not
   * an error: the server strips them (bot-package.ts:164-166), which is why the
   * launcher reports them as a warning instead. */
  obj(v, p, keys) {
    if (!isObject(v)) { this.bad(p, `Invalid input: expected object, received ${received(v)}`); return false; }
    for (const k of Object.keys(v)) if (!keys.includes(k)) this.unknown.push(join(p, k));
    return true;
  }

  /** `requiredText(max)` (bot-package.ts:25-26), with an optional trailing regex.
   * A failed type check does not end the field: zod runs the length checks on
   * whatever `.length` the value has, so `[]` is "must be text" and then "is
   * required". Only the regex check needs a real string. */
  text(v, p, max, re, reMessage) {
    const t = typeof v === "string" ? v.trim() : null;
    if (t === null) this.bad(p, "must be text");
    const length = t === null ? lengthOf(v) : t.length;
    if (length !== null) {
      if (length < 1) this.bad(p, "is required");
      if (length > max) this.bad(p, "is too long");
    }
    if (t !== null && re && !re.test(t)) this.bad(p, reMessage);
    return t ?? undefined;
  }

  /** `optionalText(max)` (bot-package.ts:28-33): null and undefined pass, a
   * blank string becomes undefined, anything else fails the union. */
  optText(v, p, max) {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "string") { this.bad(p, "Invalid input"); return undefined; }
    const t = v.trim() || undefined;
    if (t !== undefined && t.length > max) this.bad(p, "is too long");
    return t;
  }

  key(v, p) { return this.text(v, p, LIMITS.key, KEY, "may only contain lowercase letters, numbers, - and _"); }

  /** `z.number().int()` with an optional range. The safe-integer bound is the
   * number-format check and runs first; it does not abort the range checks. */
  int(v, p, range) {
    if (typeof v !== "number" || Number.isNaN(v)) { this.bad(p, `Invalid input: expected number, received ${received(v)}`); return; }
    if (!Number.isInteger(v)) { this.bad(p, "Invalid input: expected int, received number"); return; }
    if (!Number.isSafeInteger(v)) this.bad(p, v > 0 ? `Too big: expected int to be <=${SAFE_INT[1]}` : `Too small: expected int to be >=${SAFE_INT[0]}`);
    if (!range) return;
    const [min, max] = range;
    if (v < min) this.bad(p, `Too small: expected number to be >=${min}`);
    if (v > max) this.bad(p, `Too big: expected number to be <=${max}`);
  }

  bool(v, p, { optional = false } = {}) {
    if (optional && v === undefined) return;
    if (typeof v !== "boolean") this.bad(p, `Invalid input: expected boolean, received ${received(v)}`);
  }

  literal(v, p, expected, message) {
    if (v !== expected) this.bad(p, message ?? `Invalid input: expected ${quote(expected)}`);
  }

  oneOf(v, p, values, message) {
    if (!values.includes(v)) this.bad(p, message ?? `Invalid option: expected one of ${values.map(quote).join("|")}`);
  }

  /** Elements first, then the array's own size checks (zod core/schemas.js $ZodArray).
   * A value that is not an array is never walked, but its `.length`, if it has
   * one, still meets the size checks, under its own origin (util.js:583-589). */
  arr(v, p, range, each) {
    const array = Array.isArray(v);
    if (!array) this.bad(p, `Invalid input: expected array, received ${received(v)}`);
    else v.forEach((item, i) => each(item, join(p, i), i));
    if (!range) return;
    const length = array ? v.length : lengthOf(v);
    if (length === null) return;
    const [min, max] = range;
    const origin = array ? "array" : typeof v === "string" ? "string" : "unknown";
    const unit = origin === "array" ? " items" : origin === "string" ? " characters" : null;
    const size = (adjective, bound) => (unit === null ? `expected ${origin} to be ${adjective}${bound}` : `expected ${origin} to have ${adjective}${bound}${unit}`);
    if (min !== undefined && length < min) this.bad(p, `Too small: ${size(">=", min)}`);
    if (max !== undefined && length > max) this.bad(p, `Too big: ${size("<=", max)}`);
  }

  /** `z.discriminatedUnion(key, …)`: a value that is not an object fails at the
   * union's own path, an unknown discriminator at `<path>.<key>`. */
  discriminated(v, p, k, variants) {
    if (!isObject(v)) { this.bad(p, `Invalid input: expected object, received ${received(v)}`); return; }
    const variant = variants.find((x) => x.value === v[k]);
    if (!variant) { this.bad(join(p, k), `Invalid discriminator value. Expected ${variants.map((x) => `'${x.value}'`).join(" | ")}`); return; }
    variant.walk(v, p);
  }
}

const AGENT_KEYS = ["key", "name", "title", "description", "appearance", "playbooks"];
const ROOM_KEYS = ["key", "name", "members", "bulletin", "defaultResponder"];
const ROUTINE_KEYS = ["key", "name", "agent", "prompt", "runOn", "schedule", "durationMinutes", "timeoutMinutes", "enabledAfterInstall"];
const PLAYBOOK_KEYS = ["key", "name", "summary", "triggers", "instructions"];
const PACKAGE_KEYS = ["id", "release", "name", "tagline", "summary", "category", "author", "license", "featured", "tags", "outcomes",
  "setupMinutes", "requirements", "agents", "chiefOfStaff", "rooms", "routines", "playbooks", "examples"];

/** bot-package.ts:40-126, key by key, in the shape's own order. */
function walkPackage(w, doc) {
  if (!w.obj(doc, "", ["format", "version", "package"])) return;
  w.literal(doc.format, "format", FORMAT, "This is not an OpenMaus package"); // :41
  w.literal(doc.version, "version", VERSION, "Package version is not supported"); // :42
  const pkg = doc.package;
  if (!w.obj(pkg, "package", PACKAGE_KEYS)) return; // :43
  w.text(pkg.id, "package.id", LIMITS.id, SLUG, "must be a lowercase slug");
  w.text(pkg.release, "package.release", LIMITS.release, SEMVER, "must be semantic versioning");
  w.text(pkg.name, "package.name", LIMITS.name);
  w.text(pkg.tagline, "package.tagline", LIMITS.tagline);
  w.text(pkg.summary, "package.summary", LIMITS.summary);
  w.text(pkg.category, "package.category", LIMITS.category);
  if (w.obj(pkg.author, "package.author", ["name", "url"])) {
    w.text(pkg.author.name, "package.author.name", LIMITS.authorName);
    w.optText(pkg.author.url, "package.author.url", LIMITS.authorUrl);
  }
  w.text(pkg.license, "package.license", LIMITS.license);
  w.bool(pkg.featured, "package.featured", { optional: true });
  if (pkg.tags !== undefined) w.arr(pkg.tags, "package.tags", [undefined, LIMITS.tags], (v, p) => w.text(v, p, LIMITS.tag));
  w.arr(pkg.outcomes, "package.outcomes", LIMITS.outcomes, (v, p) => w.text(v, p, LIMITS.outcome));
  w.int(pkg.setupMinutes, "package.setupMinutes", LIMITS.setupMinutes);
  if (w.obj(pkg.requirements, "package.requirements", ["apps", "capabilities", "platforms"])) {
    w.arr(pkg.requirements.apps, "package.requirements.apps", [undefined, LIMITS.apps], (app, p) => {
      if (!w.obj(app, p, ["slug", "label", "reason", "optional"])) return;
      w.key(app.slug, join(p, "slug"));
      w.text(app.label, join(p, "label"), LIMITS.appLabel);
      w.text(app.reason, join(p, "reason"), LIMITS.appReason);
      w.bool(app.optional, join(p, "optional"), { optional: true });
    });
    w.arr(pkg.requirements.capabilities, "package.requirements.capabilities", [undefined, LIMITS.capabilities], (v, p) => w.text(v, p, LIMITS.capability));
    if (pkg.requirements.platforms !== undefined) w.arr(pkg.requirements.platforms, "package.requirements.platforms", [undefined, LIMITS.platforms], (v, p) => w.text(v, p, LIMITS.platform));
  }
  w.arr(pkg.agents, "package.agents", LIMITS.agents, (agent, p) => {
    if (!w.obj(agent, p, AGENT_KEYS)) return;
    w.key(agent.key, join(p, "key"));
    w.text(agent.name, join(p, "name"), LIMITS.agentName);
    w.optText(agent.title, join(p, "title"), LIMITS.agentTitle);
    w.optText(agent.description, join(p, "description"), LIMITS.agentDescription);
    const a = join(p, "appearance");
    if (w.obj(agent.appearance, a, ["color", "mascotExpression", "mascotBody"])) {
      w.oneOf(agent.appearance.color, join(a, "color"), COLORS, "is not supported");
      w.optText(agent.appearance.mascotExpression, join(a, "mascotExpression"), LIMITS.mascotExpression);
      w.optText(agent.appearance.mascotBody, join(a, "mascotBody"), LIMITS.mascotBody);
    }
    if (agent.playbooks !== undefined) w.arr(agent.playbooks, join(p, "playbooks"), [undefined, LIMITS.agentPlaybooks], (v, q) => w.key(v, q));
  });
  if (pkg.chiefOfStaff !== undefined) w.key(pkg.chiefOfStaff, "package.chiefOfStaff");
  if (pkg.rooms !== undefined) {
    w.arr(pkg.rooms, "package.rooms", [undefined, LIMITS.rooms], (room, p) => {
      if (!w.obj(room, p, ROOM_KEYS)) return;
      w.key(room.key, join(p, "key"));
      w.text(room.name, join(p, "name"), LIMITS.roomName);
      w.arr(room.members, join(p, "members"), LIMITS.roomMembers, (v, q) => w.key(v, q));
      w.optText(room.bulletin, join(p, "bulletin"), LIMITS.bulletin);
      w.discriminated(room.defaultResponder, join(p, "defaultResponder"), "kind", [
        { value: "agent", walk: (v, q) => { w.obj(v, q, ["kind", "agent"]); w.key(v.agent, join(q, "agent")); } },
        { value: "everyone", walk: (v, q) => w.obj(v, q, ["kind"]) },
        { value: "mentions", walk: (v, q) => w.obj(v, q, ["kind"]) },
      ]);
    });
  }
  if (pkg.routines !== undefined) {
    w.arr(pkg.routines, "package.routines", [undefined, LIMITS.routines], (routine, p) => {
      if (!w.obj(routine, p, ROUTINE_KEYS)) return;
      w.key(routine.key, join(p, "key"));
      w.text(routine.name, join(p, "name"), LIMITS.routineName);
      w.key(routine.agent, join(p, "agent"));
      w.text(routine.prompt, join(p, "prompt"), LIMITS.prompt);
      w.oneOf(routine.runOn, join(p, "runOn"), ["maus", "cloud"]);
      w.discriminated(routine.schedule, join(p, "schedule"), "type", [
        { value: "once", walk: (v, q) => { w.obj(v, q, ["type", "at"]); w.int(v.at, join(q, "at")); } },
        { value: "daily", walk: (v, q) => {
          w.obj(v, q, ["type", "time", "weekdays"]);
          w.text(v.time, join(q, "time"), LIMITS.time, HHMM, "must use HH:MM");
          w.arr(v.weekdays, join(q, "weekdays"), LIMITS.weekdays, (d, r) => w.int(d, r, LIMITS.weekday));
        } },
        { value: "interval", walk: (v, q) => {
          w.obj(v, q, ["type", "everyMinutes", "anchorAt"]);
          w.int(v.everyMinutes, join(q, "everyMinutes"), LIMITS.everyMinutes);
          w.int(v.anchorAt, join(q, "anchorAt"), LIMITS.anchorAt);
        } },
      ]);
      w.int(routine.durationMinutes, join(p, "durationMinutes"), LIMITS.durationMinutes);
      if (routine.timeoutMinutes !== undefined) w.int(routine.timeoutMinutes, join(p, "timeoutMinutes"), LIMITS.timeoutMinutes);
      w.literal(routine.enabledAfterInstall, join(p, "enabledAfterInstall"), false);
    });
  }
  if (pkg.playbooks !== undefined) {
    w.arr(pkg.playbooks, "package.playbooks", [undefined, LIMITS.playbooks], (book, p) => {
      if (!w.obj(book, p, PLAYBOOK_KEYS)) return;
      w.key(book.key, join(p, "key"));
      w.text(book.name, join(p, "name"), LIMITS.playbookName);
      w.text(book.summary, join(p, "summary"), LIMITS.playbookSummary);
      w.arr(book.triggers, join(p, "triggers"), LIMITS.triggers, (v, q) => w.text(v, q, LIMITS.trigger));
      w.text(book.instructions, join(p, "instructions"), LIMITS.instructions);
    });
  }
  if (pkg.examples !== undefined) {
    w.arr(pkg.examples, "package.examples", [undefined, LIMITS.examples], (ex, p) => {
      if (!w.obj(ex, p, ["title", "input", "output"])) return;
      w.text(ex.title, join(p, "title"), LIMITS.exampleTitle);
      w.text(ex.input, join(p, "input"), LIMITS.exampleInput);
      w.text(ex.output, join(p, "output"), LIMITS.exampleOutput);
    });
  }
}

// --- cross-references -------------------------------------------------------
// bot-package.ts:173-205. The server throws the first violation, so the order
// here is its order; the path is the launcher's own addition, since the server
// renders these messages alone (`schema.ts` is not involved).

const trimmed = (v) => String(v).trim();

function crossReference(pkg, errors) {
  const add = (path, message) => errors.push({ path, message, kind: "reference" });
  const uniqueKeys = (items, label, pathOf) => {
    const seen = new Set();
    items.forEach((item, i) => {
      const k = trimmed(item);
      if (seen.has(k)) add(pathOf(i), `Duplicate ${label} key: ${k}`);
      else seen.add(k);
    });
    return seen;
  };
  const agents = uniqueKeys(pkg.agents.map((a) => a.key), "agent", (i) => `package.agents.${i}.key`); // :181
  const playbooks = uniqueKeys((pkg.playbooks ?? []).map((p) => p.key), "playbook", (i) => `package.playbooks.${i}.key`); // :182
  uniqueKeys((pkg.rooms ?? []).map((r) => r.key), "room", (i) => `package.rooms.${i}.key`); // :183
  uniqueKeys((pkg.routines ?? []).map((r) => r.key), "routine", (i) => `package.routines.${i}.key`); // :184
  const chief = pkg.chiefOfStaff === undefined ? undefined : trimmed(pkg.chiefOfStaff);
  if (chief && !agents.has(chief)) add("package.chiefOfStaff", `Unknown Chief of Staff: ${chief}`); // :186-188
  pkg.agents.forEach((agent, i) => (agent.playbooks ?? []).forEach((book, j) => { // :189-193
    if (!playbooks.has(trimmed(book))) add(`package.agents.${i}.playbooks.${j}`, `Agent ${trimmed(agent.key)} references unknown playbook: ${trimmed(book)}`);
  }));
  (pkg.rooms ?? []).forEach((room, i) => { // :194-202
    const key = trimmed(room.key);
    // The server dedupes first and then walks the deduplicated set, so every
    // duplicate is reported before any unknown member of the same room.
    const members = uniqueKeys(room.members, `member in room ${key}`, (j) => `package.rooms.${i}.members.${j}`);
    for (const member of members) {
      if (!agents.has(member)) add(`package.rooms.${i}.members.${room.members.findIndex((m) => trimmed(m) === member)}`, `Room ${key} references unknown agent: ${member}`);
    }
    if (room.defaultResponder.kind === "agent" && !members.has(trimmed(room.defaultResponder.agent))) {
      add(`package.rooms.${i}.defaultResponder.agent`, `Room ${key} has an unknown default responder`);
    }
  });
  (pkg.routines ?? []).forEach((routine, i) => { // :203-205
    if (!agents.has(trimmed(routine.agent))) add(`package.routines.${i}.agent`, `Routine ${trimmed(routine.key)} references unknown agent: ${trimmed(routine.agent)}`);
  });
}

// --- the launcher's own advice ----------------------------------------------

const asText = (v) => (typeof v === "string" ? v.trim() : "");

function advise(doc, unknown, fileName) {
  const warnings = [];
  const add = (path, message) => warnings.push({ path, message });
  for (const path of unknown) add(path, `${path} is not a package field; the server drops unknown fields`);
  const pkg = isObject(doc) && isObject(doc.package) ? doc.package : null;
  const agents = pkg && Array.isArray(pkg.agents) ? pkg.agents.filter(isObject) : [];
  if (pkg) {
    const chief = typeof pkg.chiefOfStaff === "string" ? pkg.chiefOfStaff.trim() : null;
    if (!chief) add("package.chiefOfStaff", "no chiefOfStaff: import will need --lead <name>"); // verbs/team.mjs:62
    const books = new Map((Array.isArray(pkg.playbooks) ? pkg.playbooks : []).filter(isObject).map((b) => [asText(b.key), asText(b.instructions).length]));
    agents.forEach((agent, i) => {
      const key = asText(agent.key);
      const description = asText(agent.description);
      const path = `package.agents.${i}.description`;
      if (chief && key === chief) {
        const marker = description.indexOf(FACTS_MARKER);
        if (marker < 0) add(path, `the chief's description has no "${FACTS_MARKER}" marker; facts will refuse (exit 3) unless run with --append, which adds the block after the text`); // team.mjs:55-57
        else if (description.length > ADVISORY.leadDescriptionBudget) add(path, `the chief's description is ${description.length} characters (${marker} before the "${FACTS_MARKER}" marker); facts replaces the block from the marker and refuses at ${ADVISORY.descriptionCap}, so keep the description at ${ADVISORY.leadDescriptionBudget}`); // verbs/team.mjs:262
      } else if (description.length > ADVISORY.createBotInstructions) {
        add(path, `agent ${key}'s description is ${description.length} characters, over create_bot's ${ADVISORY.createBotInstructions}-character instructions limit; only matters if the lead re-creates this specialist with create_bot`); // index.ts:8201-8203
      }
      const mounted = (Array.isArray(agent.playbooks) ? agent.playbooks : []).reduce((sum, b) => sum + (books.get(asText(b)) ?? 0), 0);
      if (mounted > ADVISORY.playbookMountPerBot) add(`package.agents.${i}.playbooks`, `agent ${key}'s playbooks total ${mounted} instruction characters; a turn mounts at most three matching playbooks within ${ADVISORY.playbookMountPerBot}, so some may be cut`); // installed-playbooks.ts:3-4
    });
  }
  if (fileName && !fileName.endsWith(ADVISORY.fileSuffix)) add("", `${fileName} does not end in ${ADVISORY.fileSuffix} (convention only)`);
  return warnings;
}

/** Keys, names, titles, counts and lengths. Never a prose field: the summary is
 * printed, and the file may hold text the user would not put on a terminal. */
function summarize(doc) {
  const pkg = isObject(doc) && isObject(doc.package) ? doc.package : null;
  const name = (v) => (typeof v === "string" ? v.trim() : null);
  const agents = pkg && Array.isArray(pkg.agents) ? pkg.agents.filter(isObject) : [];
  const books = pkg && Array.isArray(pkg.playbooks) ? pkg.playbooks.filter(isObject) : [];
  return {
    id: name(pkg?.id), release: name(pkg?.release), name: name(pkg?.name),
    agents: agents.map((a) => ({ key: name(a.key), name: name(a.name), title: name(a.title), descriptionLength: asText(a.description).length })),
    chiefOfStaff: name(pkg?.chiefOfStaff),
    rooms: (pkg && Array.isArray(pkg.rooms) ? pkg.rooms.filter(isObject) : []).map((r) => name(r.key)),
    playbooks: books.map((b) => name(b.key)),
    playbookChars: books.reduce((sum, b) => sum + asText(b.instructions).length, 0),
  };
}

/**
 * Judge one parsed JSON document as an `openmaus.package`.
 * `errors[0]` rendered as `<path> <message>` (kind `schema`) or as the message
 * alone (kind `reference`) is the text the server's 400 would carry.
 * `warnings` are the launcher's own advice and never make a package invalid.
 */
export function validatePackage(doc, { fileName } = {}) {
  const w = new Walk();
  walkPackage(w, doc);
  const errors = w.errors;
  // The server cross-references only what the schema already accepted
  // (bot-package.ts:169-171), so neither does this.
  if (!errors.length) crossReference(doc.package, errors);
  return { ok: errors.length === 0, errors, warnings: advise(doc, w.unknown, fileName), summary: summarize(doc) };
}

/** How the server turns one issue into the text of its 400 (schema.ts:14-19). */
export const renderError = (e) => (e.kind === "schema" && e.path ? `${e.path} ${e.message}` : e.message);
