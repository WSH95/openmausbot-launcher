import test from "node:test";
import assert from "node:assert/strict";
import { Fail } from "../skills/openmausbot-launcher/scripts/lib/cli.mjs";
import { openRuns, findRun, selectRun, runLabel } from "../skills/openmausbot-launcher/scripts/lib/runs.mjs";

const run = (over) => ({ status: "dispatched", createdAt: "2026-09-16T00:00:00.000Z", threads: {}, ...over });
const doc = {
  runs: {
    aaaaaaaa11111111: run({ runId: "aaaaaaaa11111111", slug: "t10-parser", title: "T10 the parser", tag: "oml:aaaaaaaa", createdAt: "2026-09-16T01:00:00.000Z" }),
    bbbbbbbb22222222: run({ runId: "bbbbbbbb22222222", slug: "t11-loader", title: "T11 the loader", tag: "oml:bbbbbbbb", createdAt: "2026-09-16T02:00:00.000Z" }),
    cccccccc33333333: run({ runId: "cccccccc33333333", slug: "t09-old", title: "T09", tag: "oml:cccccccc", status: "closed" }),
  },
  history: [
    run({ runId: "dddddddd44444444", slug: "t08-done", title: "T08", tag: "oml:dddddddd", status: "closed", result: "passed" }),
    run({ runId: "eeeeeeee55555555", slug: "t09-gone", title: "T09 abandoned", tag: "oml:eeeeeeee", status: "closed", result: "abandoned" }),
  ],
};

test("openRuns lists only the runs that are not closed, oldest first", () => {
  assert.deepEqual(openRuns(doc).map((r) => r.slug), ["t10-parser", "t11-loader"]);
  assert.deepEqual(openRuns({ runs: {} }), []);
  assert.deepEqual(openRuns(null), []);
});

test("findRun resolves a run id, its eight-character prefix, a slug, a title and a tag", () => {
  assert.equal(findRun(doc, "aaaaaaaa11111111").slug, "t10-parser");
  assert.equal(findRun(doc, "aaaaaaaa").slug, "t10-parser");
  assert.equal(findRun(doc, "t11-loader").slug, "t11-loader");
  assert.equal(findRun(doc, "T10 the parser").slug, "t10-parser");
  assert.equal(findRun(doc, "oml:bbbbbbbb").slug, "t11-loader");
  assert.equal(findRun(doc, "nothing"), null);
  assert.equal(findRun(doc, null), null);
});

test("findRun prefers an open run, then the history, and `last` is the newest closed run", () => {
  assert.equal(findRun(doc, "last").slug, "t09-gone", "the newest history entry, abandoned or not");
  assert.equal(findRun(doc, "dddddddd").slug, "t08-done");
  assert.equal(findRun(doc, "t09-old").status, "closed", "a closed run left in runs is still addressable");
  const shadowed = { ...doc, history: [...doc.history, run({ runId: "aaaaaaaa99999999", slug: "t10-parser", status: "closed" })] };
  assert.equal(findRun(shadowed, "t10-parser").runId, "aaaaaaaa11111111", "the open run wins over a closed namesake");
});

test("an ambiguous reference is a precondition failure naming the candidates", () => {
  const twins = { runs: { a1: run({ runId: "a1", slug: "same" }), a2: run({ runId: "a2", slug: "same" }) }, history: [] };
  assert.throws(() => findRun(twins, "same"), (e) => e instanceof Fail && e.code === 3 && /2 runs match same/.test(e.message) && /same \(a1, dispatched\)/.test(e.hint));
});

test("selectRun defaults to the only open run and demands --run when several are open", () => {
  const one = { runs: { [doc.runs.aaaaaaaa11111111.runId]: doc.runs.aaaaaaaa11111111 }, history: [] };
  assert.equal(selectRun(one).slug, "t10-parser");
  assert.equal(selectRun(doc, "t11-loader").slug, "t11-loader");
  assert.throws(() => selectRun(doc), (e) => e instanceof Fail && e.code === 3 && /2 runs are open; pass --run/.test(e.message)
    && /t10-parser \(aaaaaaaa, dispatched\)/.test(e.hint) && /t11-loader \(bbbbbbbb, dispatched\)/.test(e.hint));
  assert.throws(() => selectRun({ runs: {}, history: [] }), (e) => e instanceof Fail && e.code === 3 && /no open run/.test(e.message));
  assert.throws(() => selectRun(doc, "t99"), (e) => e instanceof Fail && e.code === 3 && /no run t99/.test(e.message) && /t10-parser/.test(e.hint));
});

test("runLabel names a run the way the selectors list it", () => {
  assert.equal(runLabel(doc.runs.aaaaaaaa11111111), "t10-parser (aaaaaaaa, dispatched)");
  assert.equal(runLabel({ runId: "ff00ff00ff00ff00", status: "preparing" }), "ff00ff00 (ff00ff00, preparing)");
});
