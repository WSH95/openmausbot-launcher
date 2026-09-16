import test from "node:test";
import assert from "node:assert/strict";
import { openDelegations } from "../skills/openmausbot-launcher/scripts/lib/snapshot.mjs";
const chip = (name) => ({ at: 1000, kind: "activity", tool: { name } });
const queued = (name) => chip(`Delegated to @${name}`);
const settled = (name) => chip(`Delegation to @${name} completed without a text reply`);
const drop = (n) => chip(`${n} queued delegations dropped — the turn did not finish`);

test("anonymous drops cannot erase or preserve claims by consuming a later queue", () => {
  const open = openDelegations([queued("Worker"), queued("Other"), drop(1), queued("Next"), settled("Worker")]);
  assert.equal(open.total, 1);
  assert.deepEqual(open.byName, { Next: 1 });
  const late = openDelegations([queued("Worker"), queued("Other"), drop(1), settled("Worker"), queued("Next")]);
  assert.equal(late.total, 1);
  assert.deepEqual(late.byName, { Next: 1 });
});

test("a later queue to the same bot preserves every possible earlier drop owner", () => {
  const open = openDelegations([queued("Worker"), queued("Other"), drop(1), queued("Worker"), settled("Worker")]);
  assert.equal(open.total, 1);
  assert.ok(open.byName.Worker > 0);
  assert.ok(open.byName.Other > 0);
});

test("impossible anonymous drops do not settle a known or future delegation", () => {
  const open = openDelegations([queued("Worker"), drop(2), queued("Next"), settled("Next")]);
  assert.equal(open.total, 1);
  assert.deepEqual(open.byName, { Worker: 1 });
  assert.equal(open.unknown, true);
});

test("drop attribution agrees with every possible short delegation history", () => {
  const events = [queued("Worker"), queued("Other"), queued("Next"), settled("Worker"), settled("Other"), drop(1)];
  for (let code = 0; code < events.length ** 5; code++) {
    let rest = code; const transcript = []; let possible = [[]];
    for (let i = 0; i < 5; i++) {
      const which = rest % events.length; rest = Math.floor(rest / events.length);
      transcript.push(events[which]);
      if (which < 3) possible = possible.map((items) => [...items, ["Worker", "Other", "Next"][which]]);
      else {
        const target = which === 5 ? null : ["Worker", "Other"][which - 3];
        const next = possible.flatMap((items) => items.flatMap((name, j) => target === null || name === target ? [items.filter((_, k) => k !== j)] : []));
        if (next.length) possible = next;
      }
    }
    const actual = openDelegations(transcript);
    assert.equal(actual.total, possible[0].length, JSON.stringify(transcript));
    assert.deepEqual(Object.keys(actual.byName).sort(), [...new Set(possible.flat())].sort(), JSON.stringify(transcript));
  }
});

test("the bounded ambiguity fallback retains outstanding work instead of inventing closure", () => {
  const transcript = Array.from({ length: 600 }, () => queued("Worker"));
  const open = openDelegations([...transcript, drop(600)]);
  assert.equal(open.unknown, true);
  assert.ok(open.total > 0);
  assert.ok(open.byName.Worker > 0);
});
