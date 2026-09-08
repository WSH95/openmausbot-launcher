import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as monitoring from '../skills/openmausbot-launcher/scripts/lib/snapshot.mjs';
import { watchRun } from '../skills/openmausbot-launcher/scripts/lib/watch.mjs';

const team = { lead: { id: 'lead', name: 'Lead' }, bots: [{ id: 'lead', name: 'Lead' }, { id: 'worker', name: 'Worker' }], section: 's' };
const task = { runId: 'r', tag: 'oml:1234', sentAt: 1000, leadThreadId: 'lt', threads: { lead: 'lt', worker: 'wt' } };
const user = { id: 'u', at: 1000, role: 'user', kind: 'text', text: 'do it' };
const done = { id: 'd', at: 2000, role: 'bot', kind: 'text', text: 'finished\nDONE oml:1234' };
const activity = (i) => ({ id: `a${i}`, at: 2100 + i, role: 'bot', kind: 'activity', tool: { name: 'Read', ok: true } });
function scripted({ threads = { lt: [user, done], wt: [] }, bots, beforeGet, stream } = {}) {
  const fleet = bots ?? team.bots.map((b) => ({ ...b, section: 's', busy: false, activity: 'idle', threadId: task.threads[b.id] }));
  return {
    async get(route, opts) {
      await beforeGet?.(route, opts);
      if (route === '/api/bots?messages=0') return { bots: fleet };
      if (route === '/api/team-map') return { queued: [], running: [] };
      const u = new URL(route, 'http://localhost');
      const id = /^\/api\/threads\/(.+)\/messages$/.exec(u.pathname)?.[1];
      if (!Object.hasOwn(threads, id)) throw new Error(`unexpected route ${route}`);
      const all = threads[id];
      const end = u.searchParams.has('before') ? all.findIndex((m) => m.id === u.searchParams.get('before')) : all.length;
      const start = Math.max(0, end - Number(u.searchParams.get('limit') ?? 100));
      return { messages: all.slice(start, end), hasMore: start > 0 };
    },
    stream: stream ?? (async (_url, signal) => ({ status: 200, body: new ReadableStream({ start(c) { signal.addEventListener('abort', () => { try { c.close(); } catch {} }, { once: true }); } }) })),
  };
}
const settled = (snap) => monitoring.evaluate(snap, task, { now: 100_000, quiet: { since: 0 }, quietMs: 1 });

test('idle specialist pending card is found beneath more than ten later messages', async () => {
  const card = { id: 'q', at: 1500, role: 'bot', kind: 'options', text: 'A'.repeat(300), card: { requestId: 'rq', title: 'Choice', subtitle: 'details', options: ['a', 'b'] } };
  const snap = await monitoring.snapshot(scripted({ threads: { lt: [user, done], wt: [card, ...Array.from({ length: 35 }, (_, i) => activity(i))] } }), { team, task });
  assert.equal(settled(snap).state, 'needs-user');
  assert.equal(snap.pending[0].cardKind, 'question');
  assert.equal(snap.pending[0].text.length, 300);
  assert.equal(snap.pending[0].title, 'Choice');
  assert.equal(snap.pending[0].subtitle, 'details');
  assert.deepEqual(snap.pending[0].options, ['a', 'b']);
});

test('card shape classifies skill and routine requests before tool approvals and preserves metadata', async () => {
  const cards = [
    { requestId: 'a', title: 'Approve', tool: 'Bash', held: 'rm file', approvalScope: 'local-computer', allowKey: 'Bash:rm', options: ['yes'] },
    { requestId: 's', title: 'Skill', tool: 'Bash', skillRequest: { name: 'skill' } },
    { requestId: 'r', title: 'Routine', tool: 'Bash', routineRequest: { name: 'routine' } },
  ];
  const snap = await monitoring.snapshot(scripted({ threads: { lt: [user, done], wt: cards.map((card, i) => ({ id: `c${i}`, at: 1500, role: 'bot', kind: 'options', card })) } }), { team, task });
  assert.deepEqual(snap.pending.map((p) => p.cardKind), ['approval', 'skill', 'routine']);
  for (const k of ['tool', 'held', 'approvalScope', 'allowKey', 'options']) assert.deepEqual(snap.pending[0][k], cards[0][k]);
});

test('lead hydration reaches run boundary beyond the old ten page cap', async () => {
  const snap = await monitoring.snapshot(scripted({ threads: { lt: [user, done, ...Array.from({ length: 260 }, (_, i) => activity(i))], wt: [] } }), { team, task });
  assert.equal(snap.complete, true);
  assert.equal(snap.leadText?.id, 'd');
  assert.equal(snap.lastUser?.id, 'u');
  assert.equal(snap.leadTail.length, 262);
});

test('newly discovered team specialist current thread contributes pending input', async () => {
  const bots = [...team.bots.map((b) => ({ ...b, threadId: task.threads[b.id], activity: 'idle' })), { id: 'new', name: 'New', section: 's', activity: 'idle', threadId: 'nt' }];
  const snap = await monitoring.snapshot(scripted({ bots, threads: { lt: [user, done], wt: [], nt: [{ id: 'n', at: 1500, kind: 'options', role: 'bot', card: { requestId: 'new-card', title: 'Question' } }] } }), { team, task });
  assert.equal(settled(snap).state, 'needs-user');
  assert.equal(snap.pending[0].requestId, 'new-card');
});

test('snapshot deadline bounds delayed reads and marks partial hydration incomplete', async () => {
  const started = performance.now();
  const snap = await monitoring.snapshot(scripted({ beforeGet: () => new Promise((r) => setTimeout(r, 250)) }), { team, task }, { deadline: started + 40 });
  assert.equal(snap.complete, false);
  assert.ok(performance.now() - started < 180, 'all reads share the observation deadline');
  assert.equal(settled(snap).state, 'running');
});

test('terminal carry requires canonical evidence and rejects same-ID edits, users, outcomes, activity and incomplete truth', async () => {
  const snap = await monitoring.snapshot(scripted(), { team, task });
  assert.equal(typeof monitoring.carriedVerdict, 'function');
  assert.equal(monitoring.carriedVerdict(snap, { ...task, lastEval: { state: 'done', lastLeadMessageId: 'd', outcomes: [] } }), null);
  const remembered = { ...task, lastEval: { state: 'done', evidence: monitoring.evidenceOf(snap) } };
  assert.equal(monitoring.carriedVerdict(snap, remembered), 'done');
  for (const changed of [
    { leadText: { ...snap.leadText, text: 'changed\nDONE oml:1234' } },
    { lastUser: { id: 'u2', at: 3000, text: 'one more thing' } },
    { complete: false }, { lead: null }, { markerSeen: null },
    { outcomes: [{ id: 'new-outcome', at: 1500, kind: 'receipt', status: 'completed' }] },
    { pending: [{ requestId: 'q' }] },
    { bots: snap.bots.map((b) => ({ ...b, activity: 'working', busy: true })) },
    { teamMap: { queued: [{ id: 'queued' }], running: [] } },
  ]) assert.equal(monitoring.carriedVerdict({ ...snap, ...changed }, remembered), null, JSON.stringify(changed));
  const withOutcome = { ...snap, outcomes: [{ id: 'a', at: 1500, kind: 'receipt', status: 'completed' }] };
  const prior = { ...task, lastEval: { state: 'done', evidence: monitoring.evidenceOf(withOutcome) } };
  assert.equal(monitoring.carriedVerdict({ ...withOutcome, outcomes: [{ id: 'b', at: 1500, kind: 'receipt', status: 'completed' }] }, prior), null);
  assert.equal(monitoring.carriedVerdict({ ...withOutcome, outcomes: [{ id: 'a', at: 1500, kind: 'receipt', status: 'failed' }] }, prior), null);
});

test('same timestamp order is known only within the current hydrated lead thread', async () => {
  const echo = { id: 'echo', at: 2000, role: 'bot', kind: 'text', text: '@Worker replied to the delegated task:\nok', from: { botId: 'worker', name: 'Worker' } };
  let snap = await monitoring.snapshot(scripted({ threads: { lt: [user, echo, done], wt: [] } }), { team, task });
  assert.equal(settled(snap).state, 'done', 'echo before closing text is acknowledged');
  snap = await monitoring.snapshot(scripted({ threads: { lt: [user, done, echo], wt: [] } }), { team, task });
  assert.equal(settled(snap).state, 'running', 'echo after closing text waits');
  snap = await monitoring.snapshot(scripted({ threads: { lt: [{ ...user, at: 2000 }, done], wt: [] } }), { team, task });
  assert.equal(settled(snap).state, 'done', 'same-time user before closing text is answered');
  snap.outcomes = [{ id: 'receipt:x', at: 2000, kind: 'receipt', seq: -1 }];
  assert.equal(settled(snap).state, 'running', 'receipt ordering is unknown, regardless of persisted sequence');
});

test('persisted outcomes survive receipt pruning and never trust slice-relative ordering', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monitoring-')); t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDir, 'delegation-receipts.json'), '[]');
  const persisted = { id: 'receipt:x', at: 2000, kind: 'receipt', status: 'completed', seq: -1 };
  const snap = await monitoring.snapshot(scripted(), { team, task: { ...task, lastEval: { outcomes: [persisted] } } }, { dataDir });
  assert.equal(snap.outcomes.length, 1);
  assert.equal(settled(snap).state, 'running');
  assert.equal(Object.hasOwn(snap.outcomes[0], 'seq'), false);
});

function tickingStream(t, { everyMs = 5, stopAfterMs = 350, kind = 'message', threadId = 'lt' } = {}) {
  const timers = new Set();
  t.after(() => { for (const timer of timers) clearInterval(timer); });
  return async (_url, signal) => ({ status: 200, body: new ReadableStream({
    start(c) {
      let count = 0; let closed = false;
      const close = () => { if (!closed) { closed = true; clearInterval(timer); clearTimeout(end); try { c.close(); } catch {} } };
      const timer = setInterval(() => { if (!closed) c.enqueue(new TextEncoder().encode(`id: cursor:${++count}\ndata: ${JSON.stringify({ kind, threadId })}\n\n`)); }, everyMs);
      const end = setTimeout(close, stopAfterMs);
      timers.add(timer); timers.add(end);
      signal.addEventListener('abort', close, { once: true });
    },
  }) });
}

test('watch wakes at quiet threshold even when the poll interval is thirty seconds', async () => {
  const started = performance.now();
  const result = await watchRun({ stallMs: Infinity, client: scripted(), team, task, maxSeconds: 2, quietMs: 1000, pollMs: 30_000, coalesceMs: 0 });
  assert.equal(result.outcome, 'terminal');
  assert.equal(result.ev.state, 'done');
  assert.ok(performance.now() - started < 1600);
  assert.ok(result.watermarks.evidence);
});

test('constant relevant frames cannot starve the observation deadline during coalescing', async (t) => {
  const started = performance.now();
  const result = await watchRun({ stallMs: Infinity, client: scripted({ stream: tickingStream(t) }), team, task, maxSeconds: 0.08, quietMs: 1000, coalesceMs: 1000, pollMs: 30_000 });
  assert.equal(result.outcome, 'timeout');
  assert.ok(performance.now() - started < 200, 'coalescing and pending frame drains obey deadline');
});

test('identical relevant frames reset quiet even without a REST signature change', async (t) => {
  const result = await watchRun({ stallMs: Infinity, client: scripted({ stream: tickingStream(t) }), team, task, maxSeconds: 0.14, quietMs: 30, coalesceMs: 0, pollMs: 10 });
  assert.equal(result.outcome, 'timeout');
  assert.equal(result.ev.state, 'running');
});

test('watch delayed REST reads share the observation deadline', async () => {
  const started = performance.now();
  const result = await watchRun({ stallMs: Infinity, client: scripted({ beforeGet: () => new Promise((r) => setTimeout(r, 300)) }), team, task, maxSeconds: 0.05, coalesceMs: 0 });
  assert.equal(result.outcome, 'timeout');
  assert.equal(result.snap.complete, false);
  assert.ok(performance.now() - started < 180);
});

test('partial snapshots cannot advance the covered cursor and no frame preserves the previous cursor', async (t) => {
  const resumedTask = { ...task, lastEval: { cursor: 'cursor:old' } };
  const client = scripted({ stream: tickingStream(t), beforeGet(route) { if (route.includes('/messages')) throw new Error('partial read'); } });
  const result = await watchRun({ stallMs: Infinity, client, team, task: resumedTask, maxSeconds: 0.07, coalesceMs: 0, pollMs: 10 });
  assert.equal(result.watermarks.cursor, 'cursor:old');
  assert.equal(result.snap.complete, false);
  const complete = await watchRun({ stallMs: Infinity, client: scripted(), team, task: resumedTask, maxSeconds: 0.05, quietMs: 5, coalesceMs: 0, pollMs: 5 });
  assert.equal(complete.cursor, 'cursor:old');
});

test('watch retains receipt outcomes pruned after the first snapshot and checkpoints their full state', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-receipts-')); t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const file = path.join(dataDir, 'delegation-receipts.json');
  fs.writeFileSync(file, JSON.stringify([{ id: 'x', sourceThreadId: 'lt', finishedAt: Date.now(), status: 'failed', toBotName: 'Worker', error: 'details' }]));
  const timer = setTimeout(() => fs.writeFileSync(file, '[]'), 35); t.after(() => clearTimeout(timer));
  const result = await watchRun({ stallMs: Infinity, client: scripted(), team, task, dataDir, maxSeconds: 0.14, quietMs: 15, dropMs: 1_000_000, coalesceMs: 0, pollMs: 10 });
  assert.equal(result.outcome, 'timeout');
  assert.equal(result.watermarks.outcomes.length, 1);
  assert.equal(result.watermarks.outcomes[0].status, 'failed');
  assert.equal(result.watermarks.outcomes[0].error, 'details');
  assert.equal(result.snap.outcomes.length, 1);
});

test('snapshot keeps the HTTP client request cap within a longer shared observation budget', async () => {
  const timeouts = [];
  const client = scripted({ beforeGet(_route, opts) { timeouts.push(opts.timeoutMs); } });
  client.timeoutMs = 120;
  const snap = await monitoring.snapshot(client, { team, task }, { deadline: performance.now() + 1000 });
  assert.equal(snap.complete, true);
  assert.ok(timeouts.length > 0);
  assert.ok(timeouts.every((ms) => ms > 0 && ms <= 120), `per-request timeouts: ${timeouts}`);
});

test('a deadline during pagination marks hydration incomplete instead of trusting the partial tail', async () => {
  let pages = 0;
  const client = scripted({ threads: { lt: [user, done, ...Array.from({ length: 260 }, (_, i) => activity(i))], wt: [] }, beforeGet(route) {
    if (route.startsWith('/api/threads/lt') && ++pages > 1) return new Promise((r) => setTimeout(r, 100));
  } });
  const snap = await monitoring.snapshot(client, { team, task }, { deadline: performance.now() + 30 });
  assert.equal(snap.complete, false);
  assert.ok(snap.incomplete.some((s) => s.includes('thread lt')));
  assert.equal(settled(snap).state, 'running');
});

test('watch cannot establish quiet before its initial SSE connection and replay', async () => {
  let connected = false;
  const client = scripted({ stream: async (_url, signal) => {
    await new Promise((r) => setTimeout(r, 100));
    connected = true;
    return { status: 200, body: new ReadableStream({ start(c) {
      c.enqueue(new TextEncoder().encode('id: stream:1\ndata: {"kind":"hello","resumed":false}\n\n'));
      c.enqueue(new TextEncoder().encode('id: stream:2\ndata: {"kind":"message","threadId":"lt"}\n\n'));
      signal.addEventListener('abort', () => { try { c.close(); } catch {} }, { once: true });
    } }) };
  } });
  const started = performance.now();
  const r = await watchRun({ client, team, task, maxSeconds: 0.5, quietMs: 30, pollMs: 10, coalesceMs: 0, stallMs: Infinity });
  assert.equal(connected, true, 'SSE must connect before quiet can settle');
  assert.equal(r.ev.state, 'done');
  assert.equal(r.cursor, 'stream:2');
  assert.ok(performance.now() - started >= 125);
});
