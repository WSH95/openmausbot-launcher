import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as monitoring from '../skills/openmausbot-launcher/scripts/lib/snapshot.mjs';
import { watchRun, signatureOf } from '../skills/openmausbot-launcher/scripts/lib/watch.mjs';

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

test('every pending kind carries a handle and a brief that names its own answer command', async () => {
  const sha = 'a'.repeat(64);
  const messages = [
    { id: 'c1', at: 1500, role: 'bot', kind: 'options', card: { requestId: 'sk', title: 'Enable skill "release-notes"?', subtitle: 'Write release notes', options: ['Enable', 'Deny'], tool: 'stage_skill', skillRequest: { name: 'release-notes', action: 'create', preview: '# release-notes\n', sha256: sha } } },
    { id: 'c2', at: 1501, role: 'bot', kind: 'options', card: { requestId: 'rt', title: 'Schedule “Nightly”?', subtitle: 'Action: Create routine\nName: Nightly', options: ['Confirm', 'Cancel'], tool: 'schedule_routine', routineRequest: { version: 1, operation: { action: 'create' } } } },
    { id: 'c3', at: 1502, role: 'bot', kind: 'connector', connector: { slug: 'slack', label: 'Slack', description: 'Connect Slack so the bot can continue', status: 'required', resumeKey: 'rk' } },
    { id: 'c4', at: 1503, role: 'bot', kind: 'secret', text: 'Securely provide the xAI API key from OpenMausBot on your phone or computer. It is never added to chat.', secret: { target: 'xaiApiKey', label: 'xAI API key', description: 'Used by the built-in Grok provider.', placeholder: 'xai-…', helpUrl: 'https://console.x.ai/', requestKey: 'k' } },
  ];
  const snap = await monitoring.snapshot(scripted({ threads: { lt: [user, done], wt: messages } }), { team, task });
  assert.deepEqual(snap.pending.map((p) => p.handle), ['sk', 'rt', 'c3', 'c4'], 'a card is named by its request id, a connection or credential by its message');
  assert.deepEqual(snap.pending.map((p) => p.kind), ['card', 'card', 'connector', 'secret']);
  assert.equal(snap.pending[2].text, 'Connect Slack so the bot can continue', 'a connection request has no transcript text of its own');
  const line = (i) => monitoring.brief(monitoring.evaluate({ ...snap, pending: [snap.pending[i]] }, task, { now: 100_000, quiet: { since: 0 }, quietMs: 1 }), snap, task, 100_000);
  assert.equal(line(0), `run · SKILL · Worker: Enable skill "release-notes"? sha256 aaaaaaaa… → omb answer --allow --reviewed ${sha} --request sk | --deny`);
  assert.equal(line(1), 'run · ROUTINE · Worker: Schedule “Nightly”? → omb answer --confirm --request rt | --cancel');
  assert.equal(line(2), 'run · CONNECT · Worker needs Slack (required) → omb answer --connect --request c3');
  assert.equal(line(3), 'run · CREDENTIAL · Worker needs the xAI API key → omb answer --provide --secret-stdin --request c4 < <file the user wrote> | --dismiss');
  for (const i of [0, 3]) assert.equal(/# release-notes|xai-|Grok/.test(line(i)), false, 'a brief never carries a skill preview or anything that looks like a value');
});

test('a settled card whose wake failed is attention, and a connection whose sibling is still pending is not', async () => {
  const errored = { id: 's1', at: 1600, role: 'bot', kind: 'secret', secret: { target: 'ttsKey', label: 'ElevenLabs API key', description: 'd', placeholder: 'p', helpUrl: 'h', requestKey: 'k', provided: true, resumed: false, error: 'the bot was busy' } };
  const live = (id, key, over = {}) => ({ id, at: 1500, role: 'bot', kind: 'connector', connector: { slug: id, label: id, description: 'c', status: 'connected', resumeKey: key, ...over } });
  let snap = await monitoring.snapshot(scripted({ threads: { lt: [user, done], wt: [errored] } }), { team, task });
  let ev = settled(snap);
  assert.equal(ev.state, 'needs-user', 'a run whose credential was saved but never handed back is not done');
  assert.match(monitoring.brief(ev, snap, task, 100_000), /CREDENTIAL · Worker needs the ElevenLabs API key .* --resume/);
  // A connection that is live but unresumed while a sibling in the same
  // request is still waiting: the sibling already carries the attention.
  snap = await monitoring.snapshot(scripted({ threads: { lt: [user, done], wt: [live('a', 'rk'), { id: 'b', at: 1501, role: 'bot', kind: 'connector', connector: { slug: 'b', label: 'b', description: 'c', status: 'required', resumeKey: 'rk' } }] } }), { team, task });
  ev = settled(snap);
  assert.equal(ev.state, 'needs-user');
  assert.deepEqual(ev.pending.map((p) => p.handle), ['b'], 'the unfinished sibling is the one to act on');
  snap = await monitoring.snapshot(scripted({ threads: { lt: [user, done], wt: [live('a', 'rk')] } }), { team, task });
  ev = settled(snap);
  assert.equal(ev.state, 'needs-user', 'with nothing left pending, the unresumed connection is the attention');
  assert.match(monitoring.brief(ev, snap, task, 100_000), /CONNECT · Worker needs a \(connected\) → omb answer --resume --request a/);
  snap = await monitoring.snapshot(scripted({ threads: { lt: [user, done], wt: [live('a', 'rk', { resumed: true })] } }), { team, task });
  assert.equal(settled(snap).state, 'done', 'a resumed connection leaves nothing behind');
});

test('foreign resumable cards remain selectable but do not block or change another run evidence', async () => {
  const card = { id: 'foreign-secret', at: 1600, role: 'bot', kind: 'secret', secret: { target: 'ttsKey', label: 'ElevenLabs API key', provided: true, resumed: false, error: 'wake failed' } };
  const location = { threadId: 'wt', botId: 'worker' };
  for (const closed of [false, true]) {
    const other = { ...task, runId: 'other', leadThreadId: 'lt2', threads: { lead: 'lt2', worker: 'wt' }, cards: { 'foreign-secret': location } };
    const state = { team, task, runs: closed ? [task] : [task, other], history: closed ? [other] : [] };
    const base = await monitoring.snapshot(scripted({ threads: { lt: [user, done], lt2: [], wt: [] } }), state);
    const snap = await monitoring.snapshot(scripted({ threads: { lt: [user, done], lt2: [], wt: [card] } }), state);
    assert.equal(snap.resumable[0].shared, true, 'explicit --request can still select the remembered card');
    assert.deepEqual(monitoring.stuckResumable(snap), [], closed ? 'closed owner' : 'other open owner');
    assert.equal(settled(snap).state, 'done');
    assert.deepEqual(monitoring.evidenceOf(snap), monitoring.evidenceOf(base));
    assert.deepEqual(signatureOf(snap, settled(snap)), signatureOf(base, settled(base)));
    assert.equal(monitoring.carriedVerdict(snap, { ...task, lastEval: { state: 'done', evidence: monitoring.evidenceOf(base) } }), 'done');
  }
});

test('ambiguous resumable cards still block each possible run', async () => {
  const other = { ...task, runId: 'other', leadThreadId: 'lt2', threads: { lead: 'lt2', worker: 'wt' } };
  const card = { id: 'unknown-secret', at: 1600, role: 'bot', kind: 'secret', secret: { target: 'ttsKey', provided: true, resumed: false } };
  const snap = await monitoring.snapshot(scripted({ threads: { lt: [user, done], lt2: [], wt: [card] } }), { team, task, runs: [task, other] });
  assert.equal(snap.resumable[0].shared, true);
  assert.equal(monitoring.stuckResumable(snap).length, 1);
  assert.equal(settled(snap).state, 'needs-user');
  assert.equal(monitoring.evidenceOf(snap).resumable.length, 1);
});

test('the connection brief names the step that is actually next for that status', async () => {
  const at = (i, status) => ({ id: `c${i}`, at: 1500 + i, role: 'bot', kind: 'connector', connector: { slug: 'slack', label: 'Slack', description: 'Connect Slack', status, resumeKey: `rk${i}` } });
  const statuses = ['required', 'authorizing', 'failed', 'connected'];
  const snap = await monitoring.snapshot(scripted({ threads: { lt: [user, done], wt: statuses.map((s, i) => at(i, s)) } }), { team, task });
  const entries = [...snap.pending, ...snap.resumable];
  const line = (handle) => monitoring.brief(monitoring.evaluate({ ...snap, pending: [entries.find((p) => p.handle === handle)] }, task, { now: 100_000, quiet: { since: 0 }, quietMs: 1 }), snap, task, 100_000);
  assert.equal(line('c0'), 'run · CONNECT · Worker needs Slack (required) → omb answer --connect --request c0');
  assert.equal(line('c1'), 'run · CONNECT · Worker needs Slack (authorizing) → omb answer --resume --request c1', 'the link was already handed over; the status read is the next step');
  assert.equal(line('c2'), 'run · CONNECT · Worker needs Slack (failed) → omb answer --connect --request c2');
  assert.equal(line('c3'), 'run · CONNECT · Worker needs Slack (connected) → omb answer --resume --request c3');
});

test('a settled card whose bot has not been told stays selectable even though it needs no input', async () => {
  const secret = (id, over) => ({ id, at: 1600, role: 'bot', kind: 'secret', secret: { target: 'ttsKey', label: 'ElevenLabs API key', description: 'd', placeholder: 'p', helpUrl: 'h', requestKey: 'k', ...over } });
  const cards = [
    { id: 'c1', at: 1500, role: 'bot', kind: 'connector', connector: { slug: 'slack', label: 'Slack', description: 'Connect Slack', status: 'connected', resumeKey: 'rk' } },
    { id: 'c2', at: 1501, role: 'bot', kind: 'connector', connector: { slug: 'github', label: 'GitHub', description: 'Connect GitHub', status: 'required', resumeKey: 'rk' } },
    { id: 'c3', at: 1502, role: 'bot', kind: 'connector', connector: { slug: 'notion', label: 'Notion', description: 'Connect Notion', status: 'connected', resumed: true, resumeKey: 'other' } },
    secret('s1', { provided: true, resumed: false, error: 'the bot was busy' }),
    secret('s2', { provided: true, resumed: true }),
    secret('s3', { dismissed: true, resumed: false, error: 'the bot was busy' }),
  ];
  const snap = await monitoring.snapshot(scripted({ threads: { lt: [user, done], wt: cards } }), { team, task });
  assert.deepEqual(snap.pending.map((p) => p.handle), ['c2'], 'only an unfinished request needs the user');
  assert.deepEqual(snap.resumable.map((p) => p.handle), ['c1', 's1', 's3'], 'a settled card whose bot was never woken is still actionable, declined as much as provided');
  assert.equal(snap.resumable[0].connector.resumeKey, 'rk');
  const line = monitoring.brief(monitoring.evaluate({ ...snap, pending: [snap.resumable[1]] }, task, { now: 100_000, quiet: { since: 0 }, quietMs: 1 }), snap, task, 100_000);
  assert.equal(line, 'run · CREDENTIAL · Worker needs the ElevenLabs API key → omb answer --provide --secret-stdin --request s1 < <file the user wrote> | --resume | --dismiss', 'the command names a file, never a value; a card whose wake failed can also be retried without one');
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

function tickingStream(t, { everyMs = 5, stopAfterMs = 350, kind = 'message', threadId = 'lt', botId = 'worker' } = {}) {
  const timers = new Set();
  t.after(() => { for (const timer of timers) clearInterval(timer); });
  return async (_url, signal) => ({ status: 200, body: new ReadableStream({
    start(c) {
      let count = 0; let closed = false;
      const close = () => { if (!closed) { closed = true; clearInterval(timer); clearTimeout(end); try { c.close(); } catch {} } };
      const timer = setInterval(() => { if (!closed) c.enqueue(new TextEncoder().encode(`id: cursor:${++count}\ndata: ${JSON.stringify(kind === 'bot' ? { kind, bot: { id: botId } } : { kind, threadId })}\n\n`)); }, everyMs);
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

// The worker is the other run's own implementer, so its frames are that run's
// business; a bot no run claims would be every run's, and would rightly count.
const otherRun = { runId: 'r2', tag: 'oml:5678', sentAt: 1000, leadThreadId: 'lt2', threads: { lead: 'lt2', worker: 'wt' }, implementer: { id: 'worker', name: 'Worker' } };

test('another run\'s bot frames never starve this run\'s verdict', async (t) => {
  // Frames about a bot this run does not hold are still worth a fresh
  // snapshot, but they must not reset quiet — and they arrive while the
  // snapshot this run is taking is still in flight.
  const client = scripted({
    threads: { lt: [user, done], wt: [], lt2: [] },
    stream: tickingStream(t, { everyMs: 5, stopAfterMs: 5000, kind: 'bot', threadId: 'wt' }),
    beforeGet: () => new Promise((r) => setTimeout(r, 15)),
  });
  const result = await watchRun({ client, team, task, runs: [task, otherRun], maxSeconds: 2, quietMs: 60, coalesceMs: 0, pollMs: 20, stallMs: Infinity });
  assert.equal(result.ev.state, 'done');
  assert.equal(result.outcome, 'terminal');
});

test('a foreign frame that hands this run a busy bot is drained before a verdict', async (t) => {
  // The other run's delegation settles while this run is hydrating: the bot it
  // was holding becomes nobody's, which makes it this run's to wait for. The
  // view this run just built predates that, so its `done` is not emitted.
  const chipAt = (name, at) => ({ id: `c${at}`, at, role: 'bot', kind: 'activity', tool: { name } });
  const holding = [chipAt('Delegated to @Worker', 1100)];
  const released = [...holding, chipAt('Delegation to @Worker completed without a text reply', 1500)];
  const other = { runId: 'r2', tag: 'oml:5678', sentAt: 1000, leadThreadId: 'lt2', threads: { lead: 'lt2', worker: 'wt' } };
  const busyFleet = team.bots.map((b) => ({ ...b, section: 's', busy: b.id === 'worker', activity: b.id === 'worker' ? 'working' : 'idle', threadId: task.threads[b.id] }));
  let reads = 0; let push = null; let frames = 0;
  const threads = {
    lt: [user, done], wt: [],
    // The read the verdict is built from returns the delegation still open, and
    // announces its settlement the moment it is read: this run's own reads take
    // longer, so the frame lands while this snapshot is still out.
    get lt2() { reads += 1; if (reads === 2) push?.(); return reads <= 2 ? holding : released; },
  };
  const client = scripted({
    threads, bots: busyFleet,
    beforeGet: (route) => (route.includes('lt2') ? undefined : new Promise((r) => setTimeout(r, 25))),
    stream: async (_url, signal) => ({ status: 200, body: new ReadableStream({ start(c) {
      push = () => { try { c.enqueue(new TextEncoder().encode(`id: cursor:${++frames}\ndata: ${JSON.stringify({ kind: 'message', threadId: 'lt2' })}\n\n`)); } catch {} };
      signal.addEventListener('abort', () => { try { c.close(); } catch {} }, { once: true });
    } }) }),
  });
  const result = await watchRun({ client, team, task, runs: [task, other], maxSeconds: 1, quietMs: 5, coalesceMs: 0, pollMs: 10, stallMs: Infinity });
  assert.notEqual(result.ev.state, 'done', 'a bot this run now has to wait for is not a finished run');
  assert.notEqual(result.outcome, 'terminal', 'no verdict was emitted from the view that predated the settlement');
  assert.ok(reads > 2, 'the other run\'s tail was read again before this run answered');
});

const chipOn = (name, at) => ({ id: `c${at}`, at, role: 'bot', kind: 'activity', tool: { name } });
const heldByOther = [chipOn('Delegated to @Worker', 1100)];
const releasedByOther = [...heldByOther, chipOn('Delegation to @Worker completed without a text reply', 3500)];
const busyWorkerFleet = team.bots.map((b) => ({ ...b, section: 's', busy: b.id === 'worker', activity: b.id === 'worker' ? 'working' : 'idle', threadId: task.threads[b.id] }));
const sharing = { runId: 'r2', tag: 'oml:5678', sentAt: 1000, leadThreadId: 'lt2', threads: { lead: 'lt2', worker: 'wt' } };

test('a verdict is confirmed by one more hydration when who owns what changed', async () => {
  // The card is the other run's while it holds the worker. The read that first
  // shows the delegation settled also makes the card nobody's — and by the time
  // this run looks again it has been answered, so it was never this run's to
  // raise. A verdict from the read where ownership moved is not trusted.
  const card = { id: 'q', at: 1500, role: 'bot', kind: 'options', card: { requestId: 'rq', title: 'Choice' } };
  let wtReads = 0; let lt2Reads = 0;
  const threads = {
    lt: [user, done],
    get wt() { wtReads += 1; return wtReads <= 2 ? [card] : []; },
    get lt2() { lt2Reads += 1; return lt2Reads <= 1 ? heldByOther : releasedByOther; },
  };
  const idleFleet = team.bots.map((b) => ({ ...b, section: 's', busy: false, activity: 'idle', threadId: task.threads[b.id] }));
  const result = await watchRun({ client: scripted({ threads, bots: idleFleet }), team, task, runs: [task, sharing], maxSeconds: 1, quietMs: 5, coalesceMs: 0, pollMs: 10, stallMs: Infinity });
  assert.notEqual(result.ev.state, 'needs-user', 'the card was the other run\'s, and gone before this run could own it');
  assert.ok(wtReads > 2, 'the run read again before answering');
});

test('a nudge is not sent from a view the other run has already moved on from', async (t) => {
  // The lead delegated and went quiet with an outcome newer than its own text —
  // the shape that makes `watch --nudge` send "status?". The settlement that
  // hands this run a busy worker lands while that snapshot is still out, so the
  // stall is only apparent: the nudge waits for the re-read, which says running.
  const delegating = { id: 'l1', at: 2000, role: 'bot', kind: 'text', text: 'Delegating.' };
  const echo = { id: 'e1', at: 3000, role: 'bot', kind: 'text', from: { botId: 'worker', name: 'Worker' }, text: '@Worker replied to the delegated task:\n\nok' };
  let lt2Reads = 0; let push = null; let frames = 0; let nudges = 0;
  const threads = {
    lt: [user, delegating, echo], wt: [],
    get lt2() { lt2Reads += 1; if (lt2Reads === 2) push?.(); return lt2Reads <= 2 ? heldByOther : releasedByOther; },
  };
  const client = scripted({
    threads, bots: busyWorkerFleet,
    beforeGet: (route) => (route.includes('lt2') ? undefined : new Promise((r) => setTimeout(r, 25))),
    stream: async (_url, signal) => ({ status: 200, body: new ReadableStream({ start(c) {
      push = () => { try { c.enqueue(new TextEncoder().encode(`id: cursor:${++frames}\ndata: ${JSON.stringify({ kind: 'message', threadId: 'lt2' })}\n\n`)); } catch {} };
      signal.addEventListener('abort', () => { try { c.close(); } catch {} }, { once: true });
    } }) }),
  });
  const result = await watchRun({ client, team, task, runs: [task, sharing], maxSeconds: 1, quietMs: 5, dropMs: 1000, coalesceMs: 0, pollMs: 10, stallMs: Infinity, nudge: async () => { nudges += 1; } });
  assert.equal(nudges, 0, 'nothing was sent to the lead on the strength of a stale view');
  assert.equal(result.nudged, false);
  assert.notEqual(result.ev.state, 'stalled');
});
