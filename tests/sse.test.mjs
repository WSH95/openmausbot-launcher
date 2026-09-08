import test from "node:test";
import assert from "node:assert/strict";
import { readEventStream } from "../skills/openmausbot-launcher/scripts/lib/watch.mjs";

const encoder = new TextEncoder();
/** A response whose body yields `chunks` one every `gapMs`, then closes unless `hold` keeps it open. */
function response(chunks, { gapMs = 5, hold = false } = {}) {
  return { body: new ReadableStream({ start(c) {
    let i = 0;
    const next = () => { try { if (i < chunks.length) { c.enqueue(encoder.encode(chunks[i++])); setTimeout(next, gapMs); } else if (!hold) c.close(); } catch {} };
    setTimeout(next, gapMs);
  } }) };
}

test("frames split across chunks, id before or after data, comments, dataless frames, and bad JSON", async () => {
  const frames = [];
  await readEventStream(response(["id: s:1\nda", "ta: {\"kind\":\"a\"}\n\n: keepalive\n\nid: s:9\n\ndata: {\"kind\":\"b\"}\nid: s:2\n\ndata: not json\n\n", "data: {\"kind\":\"c\"}\n\n"]), { onFrame: (f) => frames.push(f), idleMs: 1000 });
  assert.deepEqual(frames, [{ id: "s:1", data: { kind: "a" } }, { id: "s:2", data: { kind: "b" } }, { id: null, data: { kind: "c" } }]);
});

test("the idle watchdog cancels a silent stream after idleMs", async () => {
  const started = performance.now();
  await readEventStream(response(["data: {\"kind\":\"ping\"}\n\n"], { hold: true }), { onFrame: () => {}, idleMs: 60 });
  const elapsed = performance.now() - started;
  assert.ok(elapsed >= 55 && elapsed < 1000, `${elapsed} ms`);
});

test("an abort signal stops reading even while a read is pending", async () => {
  const ctrl = new AbortController(); const frames = [];
  setTimeout(() => ctrl.abort(), 30);
  const started = performance.now();
  await readEventStream(response(["data: {\"kind\":\"x\"}\n\n"], { hold: true }), { onFrame: (f) => frames.push(f), signal: ctrl.signal, idleMs: 10_000 });
  assert.ok(performance.now() - started < 1000); assert.deepEqual(frames, [{ id: null, data: { kind: "x" } }]);
});

test("the deadline ends the read and no frame is delivered after it", async () => {
  const frames = [];
  const chunks = Array.from({ length: 20 }, (_, i) => `data: {"n":${i}}\n\n`);
  const deadline = performance.now() + 40;
  await readEventStream(response(chunks, { gapMs: 5 }), { onFrame: (f) => frames.push(f), idleMs: 1000, deadline });
  assert.ok(frames.length > 0 && frames.length < 20, String(frames.length));
  assert.ok(performance.now() < deadline + 100);
});
