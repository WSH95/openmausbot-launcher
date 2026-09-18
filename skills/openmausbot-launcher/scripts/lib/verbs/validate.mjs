// validate: judge a team package offline, in the server's own words (design:
// the verb table and "Package validation"). No lock, no state, no request, no
// configuration at all — a bad --project cannot fail a file check.
import fs from "node:fs";
import path from "node:path";
import { verb, EXIT, Fail } from "../cli.mjs";
import { validatePackage, parseJsonFile, renderError, BOTMRR, FORMAT } from "../package.mjs";

verb("validate", {
  allowPositionals: true,
  handler: async ({ positionals }) => {
    const file = positionals[0];
    if (!file) throw new Fail(EXIT.USAGE, "usage: validate <package.json>");
    const resolved = path.resolve(file);
    let text;
    try { text = fs.readFileSync(resolved, "utf8"); } catch (e) { throw new Fail(EXIT.USAGE, `cannot read ${file}: ${e.message}`); }
    // A BotMRR Markdown document is a package the app can import (bot-package.ts:134,
    // 139-162) but `omb import` posts JSON, so it is refused before the parse
    // rather than reported as broken JSON.
    if (BOTMRR.test(text)) {
      throw new Fail(EXIT.USAGE, `${file} is a BotMRR Markdown document; this launcher validates and imports openmaus.package JSON only`,
        { hint: "the OpenMausBot app's Import dialog accepts it; for omb import, write the same package as JSON" });
    }
    let doc;
    // parseJsonFile, never JSON.parse: Node's SyntaxError quotes the input, and
    // the file the user pointed at may be a token or a private note.
    try { doc = parseJsonFile(text); } catch (e) { throw new Fail(EXIT.USAGE, `${file} is ${e.message}`); }
    const base = path.basename(resolved);
    const { ok, errors, warnings, summary } = validatePackage(doc, { fileName: base });
    const counts = `${summary.agents.length} agents, ${summary.rooms.length} room(s), ${summary.playbooks.length} playbook(s)`;
    if (ok) {
      return { code: EXIT.OK, result: { file: resolved, valid: true, errors, warnings, summary },
        brief: `validate · ${base} · ok · ${counts} · chief ${summary.chiefOfStaff ?? "none"} · ${warnings.length} warning(s)` };
    }
    // Returned, not thrown: cli.mjs:48 whitelists the fields a failure may
    // carry, and errors[] is not among them.
    return { code: EXIT.PRECONDITION, ok: false,
      result: { file: resolved, valid: false, error: `${errors.length} error(s) in ${base}: ${renderError(errors[0])}`, errors, warnings, summary,
        // A document whose format is not openmaus.package never reaches this
        // schema on the server: the import route hands it to the backup parser
        // (index.ts:9179) or the legacy team parser (index.ts:9195-9196).
        hint: doc?.format === FORMAT
          ? "fix errors[0] first: it is the one the server would report"
          : `this file's format is not ${FORMAT}, so the server would not judge it by this schema (a backup or legacy team file goes to another parser); write an ${FORMAT} document` },
      brief: `validate · ${base} · ${errors.length} error(s) · ${renderError(errors[0])}` };
  },
});
