// Argument parsing, the verb table, and output shaping.
import { parseArgs } from "node:util";

export const EXIT = { OK: 0, ERROR: 1, USAGE: 2, PRECONDITION: 3, TIMEOUT: 4, NEEDS_USER: 5, STALLED: 6 };

const GLOBAL_OPTIONS = {
  project: { type: "string" }, url: { type: "string" }, "data-dir": { type: "string" }, state: { type: "string" },
  brief: { type: "boolean" }, "dry-run": { type: "boolean" }, verbose: { type: "boolean" }, remote: { type: "boolean" },
  "allow-insecure-http": { type: "boolean" },
};

export const VERBS = new Map();

/** Register a verb: `options` in parseArgs form, `handler(ctx) -> {code, result, brief?}`. */
export function verb(name, { options = {}, allowPositionals = false, handler }) {
  VERBS.set(name, { options, allowPositionals, handler });
}

export function usage() {
  const names = [...VERBS.keys()].sort().join(", ") || "(no verbs registered yet)";
  return { ok: false, error: "usage: omb.mjs <verb> [options]", hint: `verbs: ${names}` };
}

export async function run(argv) {
  const name = argv[0];
  const def = name ? VERBS.get(name) : undefined;
  if (!def) return { code: EXIT.USAGE, output: JSON.stringify({ ...usage(), ...(name ? { error: `unknown verb ${name}` } : {}) }) };
  let parsed;
  try {
    parsed = parseArgs({ args: argv.slice(1), options: { ...GLOBAL_OPTIONS, ...def.options }, allowPositionals: def.allowPositionals, strict: true });
  } catch (e) {
    return { code: EXIT.USAGE, output: JSON.stringify({ ok: false, verb: name, error: e.message }) };
  }
  const flags = parsed.values;
  try {
    const out = await def.handler({ flags, positionals: parsed.positionals, verb: name });
    const code = out.code ?? EXIT.OK;
    if ((flags.brief || flags.md) && out.brief !== undefined) return { code, output: out.brief };
    if (out.result?.silent) return { code, output: "" };
    return { code, output: JSON.stringify({ ok: code === EXIT.OK || out.ok === true, verb: name, ...out.result }) };
  } catch (e) {
    if (flags.verbose) process.stderr.write(`${e.stack}\n`);
    return { code: e.code ?? EXIT.ERROR, output: JSON.stringify({ ok: false, verb: name, error: e.message, ...(e.status ? { status: e.status } : {}), ...(e.hint ? { hint: e.hint } : {}), ...(e.log ? { log: e.log } : {}) }) };
  }
}

/** A failure the verb wants reported with a specific exit code. */
export class Fail extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}
