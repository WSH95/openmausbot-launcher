#!/usr/bin/env node
// An in-memory OpenMausBot 0.1.56 for tests. It encodes the HTTP contract the
// driver relies on; every non-obvious rule cites the pinned source
// (~/.cache/agent-team/openmausbot-src, "S:" below). It is not evidence of
// anything: real runs are recorded in docs/evidence.md.
//
// Two ways to run it:
//   import { createFake } from "./fake-omb.mjs"; const f = await createFake({ dataDir });
//   node fake-omb.mjs serve --port N --data-dir D [--no-pair]   (a supervisor
//     that spawns a child serving the API; the child answers /api/health with
//     its own pid, as the real CLI does — S: server/cli.ts:455, index.ts:11363)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";

const BUSY = new Set(["working", "waiting-on-you", "no-signal"]); // S: server/store.ts:407-409
const ECHO_PREFIX = "replied to the delegated task"; // S: server/index.ts:3386
const MAX_DESCRIPTION = 4000; // S: server/bot-package.ts (description ≤ 4000)
const MAX_TAGLINE = 160; // S: import 400 on a long tagline (devpack EVIDENCE.md:302)

const newId = () => randomBytes(8).toString("hex");
const now = () => Date.now();

export async function createFake(opts = {}) {
  const dataDir = opts.dataDir ?? fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "fake-omb-"));
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, "events"), { recursive: true });
  const maxReceipts = opts.maxReceipts ?? 100; // S: server/delegations.ts:98
  const receiptMaxAgeMs = opts.receiptMaxAgeMs ?? 48 * 60 * 60 * 1000; // S: delegations.ts:99
  const heartbeatMs = opts.heartbeatMs ?? 1000; // real: 15 s
  const replayMax = opts.replayMax ?? 50;
  const STREAM_ID = randomBytes(4).toString("hex");
  const environmentFile = path.join(dataDir, "environment-id");
  if (!fs.existsSync(environmentFile)) fs.writeFileSync(environmentFile, `${newId()}-${newId()}`);
  let environmentId = fs.readFileSync(environmentFile, "utf8").trim();

  // ── state ──
  const state = {
    bots: [], groups: [], threads: new Map(), receipts: [], decisions: [],
    pendingDelegations: [], running: [], tokens: new Map(), // token -> scopes
    delay: { count: 0, ms: 0 }, steer: false, lateSteerConflict: false,
    dropStreams: false, sequence: 0, instances: defaultInstances(),
  };
  const sse = new Set();
  let lastSeq = 0;
  const replay = [];

  function saveReceipts() {
    const tmp = `${path.join(dataDir, "delegation-receipts.json")}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state.receipts, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, path.join(dataDir, "delegation-receipts.json"));
  }
  function recordReceipt(r) { // S: delegations.ts:113-129 (newest first, dedupe, cap, age)
    const t = now();
    const bounded = { id: r.id ?? newId(), sourceThreadId: r.sourceThreadId, toBotId: r.toBotId ?? "", toBotName: r.toBotName ?? "", status: r.status ?? "completed", finishedAt: r.finishedAt ?? t };
    if (r.result !== undefined) bounded.result = String(r.result).slice(0, 4000);
    state.receipts = [bounded, ...state.receipts.filter((e) => e.id !== bounded.id)]
      .filter((e) => t - e.finishedAt <= receiptMaxAgeMs).slice(0, maxReceipts);
    saveReceipts();
    return bounded;
  }
  function broadcast(payload) { // S: index.ts:2037-2050
    const seq = ++lastSeq;
    const kind = String(payload.kind ?? "");
    const frame = `id: ${STREAM_ID}:${seq}\ndata: ${JSON.stringify({ ...payload, seq })}\n\n`;
    replay.push({ seq, kind, frame });
    if (replay.length > replayMax) replay.shift();
    for (const client of [...sse]) {
      if (kind === "screen" && !client.screens) continue;
      try { client.res.write(frame); } catch {}
    }
  }
  const publicBot = (b) => ({
    id: b.id, name: b.name, title: b.title, description: b.description, section: b.section,
    threadId: b.threadId, busy: BUSY.has(b.activity), activity: b.activity, cwd: b.cwd,
    approvalMode: b.approvalMode, approvePeerComms: b.approvePeerComms, // S: index.ts:1159-1168 wireBot passes both through as stored
    modelSelection: { ...b.modelSelection }, chiefOfStaff: b.chiefOfStaff === true,
    hidden: b.hidden === true, notifications: b.notifications !== false,
    tasks: b.tasks.map((t) => ({ threadId: t.threadId, title: t.title, createdAt: t.createdAt })),
  });
  const publicGroup = (g) => ({
    id: g.id, name: g.name, threadId: g.threadId, memberIds: [...g.memberIds], section: g.section,
    cwd: g.cwd, dm: g.dm === true, busyBotId: g.busyBotId ?? null, working: g.working === true,
    defaultResponder: g.defaultResponder,
  });
  const messagesFor = (threadId) => { if (!state.threads.has(threadId)) state.threads.set(threadId, []); return state.threads.get(threadId); };
  function appendMessage(threadId, m) {
    const message = { id: newId(), at: now(), ...m };
    const list = messagesFor(threadId);
    if (list.length && message.at <= list[list.length - 1].at) message.at = list[list.length - 1].at + 1;
    list.push(message);
    broadcast({ kind: "message", threadId, message });
    return message;
  }
  const botById = (id) => state.bots.find((b) => b.id === id);
  const groupById = (id) => state.groups.find((g) => g.id === id);
  const taskByThread = (bot, threadId) => bot.tasks.find((t) => t.threadId === threadId);
  const activeTask = (bot) => taskByThread(bot, bot.threadId);
  function createTask(bot, title) { // S: store.ts:1607 — always a new task, title defaulted, becomes active
    const task = { threadId: newId(), title: (title ?? "").trim() || "Untitled task", createdAt: now(), cwd: undefined };
    bot.tasks.push(task); bot.threadId = task.threadId; return task;
  }
  function makeBot(fields) {
    const b = {
      id: newId(), name: fields.name, title: fields.title, description: fields.description ?? "",
      section: fields.section, activity: "idle", cwd: fields.cwd,
      ...(fields.approvalMode !== undefined ? { approvalMode: fields.approvalMode } : {}), // S: store.ts:1303-1335 — createBot never writes approvalMode; it reads as ask until PATCHed (shared/approval-mode.ts:32-43)
      modelSelection: fields.modelSelection ?? { instanceId: "claude", model: "claude-sonnet-5" },
      chiefOfStaff: fields.chiefOfStaff === true, hidden: false, notifications: true, tasks: [],
      approvalGrantPending: false, savingCredential: false, busyElsewhere: null, key: fields.key,
    };
    createTask(b, "Chat");
    state.bots.push(b);
    return b;
  }
  function uniqueName(name) { // S: index.ts:9232 (colliding names numbered)
    if (!state.bots.some((b) => b.name === name)) return name;
    for (let n = 2; ; n++) { const c = `${name} ${n}`; if (!state.bots.some((b) => b.name === c)) return c; }
  }
  function uniqueSection(name) {
    if (!state.bots.some((b) => b.section === name)) return name;
    for (let n = 2; ; n++) { const c = `${name} ${n}`; if (!state.bots.some((b) => b.section === c)) return c; }
  }
  function makeGroup(fields) {
    const g = { id: newId(), name: fields.name, threadId: newId(), memberIds: fields.memberIds ?? [], section: fields.section,
      cwd: fields.cwd, pinnedCwd: undefined, dm: fields.dm === true, busyBotId: null, working: false,
      defaultResponder: fields.defaultResponder ?? { kind: "everyone" } };
    state.groups.push(g); return g;
  }

  // ── auth ── S: request-auth.ts:319-384. loopback without proxy headers = admin;
  // a bearer session wins over loopback; client scope is a default-deny table.
  const CLIENT_ALLOW = [ // S: request-auth.ts:185-250 (the subset the driver can hit)
    ["GET", /^\/api\/auth\/session$/], ["GET", /^\/api\/health$/], ["GET", /^\/api\/events$/],
    ["GET", /^\/api\/bots$/], ["GET", /^\/api\/team-map$/], ["GET", /^\/api\/threads\/[\w-]+\/messages$/],
    ["POST", /^\/api\/bots\/[\w-]+\/messages$/], ["POST", /^\/api\/bots\/[\w-]+\/interrupt$/],
    ["POST", /^\/api\/bots\/[\w-]+\/tasks$/], ["POST", /^\/api\/bots\/[\w-]+\/respond$/],
    ["POST", /^\/api\/threads\/[\w-]+\/respond$/], ["PATCH", /^\/api\/bots\/[\w-]+$/], ["PATCH", /^\/api\/groups\/[\w-]+$/],
    ["POST", /^\/api\/groups\/[\w-]+\/messages$/], ["GET", /^\/api\/routines$/], ["GET", /^\/api\/config$/],
  ];
  function authorize(req, method, pathname) {
    if (pathname === "/.well-known/openmausbot/environment" || pathname.startsWith("/__fake")) return { kind: "public" };
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "")?.[1];
    if (bearer) {
      const scopes = state.tokens.get(bearer);
      if (!scopes) return { deny: [401, "unauthorized: unknown session"] };
      const needAdmin = !CLIENT_ALLOW.some(([m, re]) => m === method && re.test(pathname));
      if (needAdmin && !scopes.includes("admin")) return { deny: [403, "forbidden: this needs the owner"] };
      return { kind: "session", scopes };
    }
    const proxied = ["x-forwarded-for", "x-forwarded-proto", "x-forwarded-host", "forwarded"].some((h) => req.headers[h]);
    const host = String(req.headers.host ?? "").split(":")[0];
    const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host) && !proxied;
    if (!loopback) return { deny: [401, "unauthorized: pair this device"] };
    return { kind: "loopback", scopes: ["admin", "client"] };
  }

  // ── handlers ──
  const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const readBody = (req) => new Promise((resolve, reject) => {
    let d = ""; req.on("data", (c) => { d += c; }); req.on("end", () => { if (!d) return resolve(null); try { resolve(JSON.parse(d)); } catch (e) { reject(Object.assign(new Error("invalid json"), { status: 400 })); } }); req.on("error", reject);
  });

  async function handle(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    const method = req.method ?? "GET";
    const p = url.pathname;
    if (state.delay.count > 0) { state.delay.count--; await new Promise((r) => setTimeout(r, state.delay.ms)); }
    const auth = authorize(req, method, p);
    if (auth.deny) return json(res, auth.deny[0], { error: auth.deny[1] });
    try {
      if (p.startsWith("/__fake")) return control(req, res, method, p);
      if (method === "GET" && p === "/.well-known/openmausbot/environment") {
        return json(res, 200, { environmentId, label: "fake", platform: "linux", version: "0.1.56", capabilities: { remoteSessions: true, selfUpdate: "operator" } });
      }
      if (method === "GET" && p === "/api/health") return json(res, 200, { app: "openmausbot", pid: process.pid, static: false });
      if (method === "GET" && p === "/api/auth/session") return json(res, 200, { kind: auth.kind, scopes: auth.scopes });
      if (method === "GET" && p === "/api/instances") return json(res, 200, { instances: state.instances });
      if (method === "GET" && p === "/api/decisions") return json(res, 200, { decisions: state.decisions.slice(0, Number(url.searchParams.get("limit") ?? 200)) });
      if (method === "GET" && p === "/api/team-map") { // S: index.ts:8407-8437 (hidden bots omitted)
        const visible = new Set(state.bots.filter((b) => !b.hidden).map((b) => b.id));
        const queued = state.pendingDelegations.filter((q) => visible.has(q.sourceBotId) && visible.has(q.targetBotId)).map((q) => ({ sourceBotId: q.sourceBotId, targetBotId: q.targetBotId, reason: q.reason ?? "" }));
        const running = state.running.filter((r) => visible.has(r.sourceBotId) && visible.has(r.targetBotId)).map((r) => ({ sourceBotId: r.sourceBotId, targetBotId: r.targetBotId, threadId: r.threadId, ...(r.groupId ? { groupId: r.groupId } : {}) }));
        return json(res, 200, { collaborations: [], queued, running });
      }
      if (method === "GET" && p === "/api/events") return events(req, res, url, auth);
      if (method === "GET" && p === "/api/bots") return json(res, 200, { bots: state.bots.map(publicBot), groups: state.groups.map(publicGroup), computerControl: {} });
      if (method === "POST" && p === "/api/bots") {
        const body = await readBody(req) ?? {};
        if (!body.name) return json(res, 400, { error: "name required" });
        return json(res, 201, { bot: publicBot(makeBot({ ...body, name: uniqueName(String(body.name)) })) });
      }
      let m;
      if ((m = p.match(/^\/api\/teams\/import$/)) && method === "POST") return importTeam(req, res, url);
      if ((m = p.match(/^\/api\/bots\/([\w-]+)\/model$/)) && method === "PATCH") return patchModel(req, res, m[1]);
      if ((m = p.match(/^\/api\/bots\/([\w-]+)\/tasks$/)) && method === "POST") return postTask(req, res, m[1]);
      if ((m = p.match(/^\/api\/bots\/([\w-]+)\/messages$/)) && method === "POST") return postMessage(req, res, m[1]);
      if ((m = p.match(/^\/api\/bots\/([\w-]+)\/interrupt$/)) && method === "POST") return interrupt(req, res, m[1]);
      if ((m = p.match(/^\/api\/bots\/([\w-]+)\/respond$/)) && method === "POST") { const bot = botById(m[1]); if (!bot) return json(res, 404, { error: "no such bot" }); return respond(req, res, bot.threadId); }
      if ((m = p.match(/^\/api\/threads\/([\w-]+)\/respond$/)) && method === "POST") return respond(req, res, m[1]);
      if ((m = p.match(/^\/api\/threads\/([\w-]+)\/messages$/)) && method === "GET") return threadMessages(res, url, m[1]);
      if ((m = p.match(/^\/api\/bots\/([\w-]+)$/)) && method === "PATCH") return patchBot(req, res, m[1], auth);
      if ((m = p.match(/^\/api\/groups\/([\w-]+)$/)) && method === "PATCH") return patchGroup(req, res, m[1]);
      if ((m = p.match(/^\/api\/groups\/([\w-]+)\/messages$/)) && method === "POST") {
        const g = groupById(m[1]); if (!g) return json(res, 404, { error: "no such channel" });
        const body = await readBody(req) ?? {}; if (!body.text) return json(res, 400, { error: "text required" });
        const message = appendMessage(g.threadId, { role: "user", kind: "text", text: body.text });
        return json(res, 202, { ok: true, threadId: g.threadId, message });
      }
      return json(res, 404, { error: `no route: ${method} ${p}` });
    } catch (e) {
      return json(res, e.status ?? 500, { error: e.message });
    }
  }

  async function importTeam(req, res, url) { // S: index.ts:9151-9337 (always additive, fresh ids, numbered copies)
    const body = await readBody(req);
    const mode = url.searchParams.get("mode") ?? "add";
    if (mode === "replace") return json(res, 400, { error: "mode replace is not supported" });
    if (!body || body.format !== "openmaus.package") return json(res, 400, { error: "unsupported document" });
    const pkg = body.package ?? {};
    if (typeof pkg.tagline === "string" && pkg.tagline.length > MAX_TAGLINE) return json(res, 400, { error: `tagline is longer than ${MAX_TAGLINE} characters` });
    const section = uniqueSection(pkg.name ?? "Imported team");
    const byKey = new Map();
    const bots = [];
    for (const agent of pkg.agents ?? []) {
      const b = makeBot({ key: agent.key, name: uniqueName(agent.name), title: agent.title, description: agent.description ?? "", section, chiefOfStaff: pkg.chiefOfStaff === agent.key });
      byKey.set(agent.key, b); bots.push(b);
    }
    const groups = [];
    for (const room of pkg.rooms ?? []) {
      const memberIds = (room.members ?? []).map((k) => byKey.get(k)?.id).filter(Boolean);
      const responder = room.defaultResponder?.kind === "agent" ? { kind: "member", botId: byKey.get(room.defaultResponder.agent)?.id } : room.defaultResponder ?? { kind: "everyone" };
      groups.push(makeGroup({ name: room.name, memberIds, section, defaultResponder: responder }));
    }
    for (const b of bots) broadcast({ kind: "bot", bot: publicBot(b) });
    for (const g of groups) broadcast({ kind: "group", group: publicGroup(g) });
    // `name` is the package name, unnumbered (index.ts:9322); the bots carry the numbered section.
    return json(res, 201, { name: pkg.name ?? "Imported team", bots: bots.map(publicBot), group: groups[0] ? publicGroup(groups[0]) : null, groups: groups.map((g) => ({ ...publicGroup(g), messages: [] })), routines: [] });
  }
  async function patchModel(req, res, id) { // S: index.ts:1050-1057 (409 only when changed while busy), 9930 (pending grant)
    const bot = botById(id); if (!bot) return json(res, 404, { error: "no such bot" });
    const body = await readBody(req) ?? {};
    if (bot.approvalGrantPending) return json(res, 409, { error: "wait for the approval-level change to finish before changing models" });
    const instanceId = body.instanceId ?? bot.modelSelection.instanceId;
    if (!state.instances.some((i) => i.instanceId === instanceId)) return json(res, 400, { error: `unknown engine ${instanceId}` });
    if (body.effort !== undefined && !["low", "medium", "high", "xhigh", "max"].includes(body.effort)) return json(res, 400, { error: `effort "${body.effort}" is not recognized` });
    const selection = { instanceId, model: body.model ?? bot.modelSelection.model, ...(body.effort !== undefined ? { effort: body.effort } : {}) };
    const changed = selection.instanceId !== bot.modelSelection.instanceId || selection.model !== bot.modelSelection.model || selection.effort !== bot.modelSelection.effort;
    if (BUSY.has(bot.activity) && changed) return json(res, 409, { error: "the bot is working — stop it before changing models" });
    bot.modelSelection = selection; broadcast({ kind: "bot", bot: publicBot(bot) });
    return json(res, 200, { bot: publicBot(bot) });
  }
  async function postTask(req, res, id) { // S: index.ts:11105-11119
    const bot = botById(id); if (!bot) return json(res, 404, { error: "no such bot" });
    const body = await readBody(req) ?? {};
    if (BUSY.has(bot.activity)) return json(res, 409, { error: "this bot is working — let it finish before starting a task" });
    if (bot.savingCredential) return json(res, 409, { error: "this bot is securely saving a credential — try again when it finishes" });
    const task = createTask(bot, typeof body.title === "string" ? body.title : undefined);
    broadcast({ kind: "bot", bot: publicBot(bot) });
    return json(res, 201, { bot: publicBot(bot), task: { threadId: task.threadId, title: task.title, createdAt: task.createdAt } });
  }
  async function postMessage(req, res, id) { // S: index.ts:10738-10830
    const bot = botById(id); if (!bot) return json(res, 404, { error: "no such bot" });
    const body = await readBody(req) ?? {};
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return json(res, 400, { error: "text required" });
    if (body.threadId !== undefined && !/^[\w-]+$/.test(String(body.threadId))) return json(res, 400, { error: "threadId must be a task id" });
    const threadId = body.threadId ?? bot.threadId;
    if (!taskByThread(bot, threadId)) return json(res, 409, { error: "the bot switched tasks before it could receive the message" });
    const sendId = typeof body.sendId === "string" && body.sendId ? body.sendId : undefined;
    const list = messagesFor(threadId);
    if (sendId) {
      const existing = list.find((m) => m.sendId === sendId);
      if (existing) {
        if (existing.text !== text) return json(res, 409, { error: "sendId already belongs to another message" });
        return json(res, 202, existing.steered ? { ok: true, steered: true, threadId, message: existing } : { ok: true, threadId, message: existing });
      }
      const queued = state.queue?.find((q) => q.botId === bot.id && q.threadId === threadId && q.sendId === sendId);
      if (queued) { if (queued.text !== text) return json(res, 409, { error: "sendId already belongs to another message" }); return json(res, 202, { ok: true, queued: true, queueId: queued.id, threadId }); }
    }
    if (bot.threadId !== threadId) return json(res, 409, { error: "the bot switched tasks before it could receive the message" });
    if (BUSY.has(bot.activity)) {
      if (state.steer) {
        if (state.lateSteerConflict) { state.lateSteerConflict = false; return json(res, 409, { error: "the bot switched tasks before it could receive the message" }); }
        const message = appendMessage(threadId, { role: "user", kind: "text", text, sendId, steered: true });
        return json(res, 202, { ok: true, steered: true, threadId, message });
      }
      state.queue ??= [];
      const q = { id: newId(), botId: bot.id, threadId, sendId, text };
      state.queue.push(q);
      return json(res, 202, { ok: true, queued: true, queueId: q.id, threadId });
    }
    const message = appendMessage(threadId, { role: "user", kind: "text", text, sendId });
    if (state.autoWork) { bot.activity = "working"; broadcast({ kind: "bot", bot: publicBot(bot) }); }
    return json(res, 202, { ok: true, threadId, message });
  }
  async function interrupt(req, res, id) { // S: index.ts:11035-11060
    const bot = botById(id); if (!bot) return json(res, 404, { error: "no such bot" });
    const body = await readBody(req) ?? {};
    if (body.threadId !== undefined && !/^[\w-]+$/.test(String(body.threadId))) return json(res, 400, { error: "threadId must be a task id" });
    if (bot.busyElsewhere) return json(res, 409, { error: `the bot is working in ${bot.busyElsewhere} — interrupt it there` });
    if (body.threadId && body.threadId !== bot.threadId) return json(res, 409, { error: "the bot is not working in that task" });
    bot.activity = "idle"; broadcast({ kind: "bot", bot: publicBot(bot) });
    return json(res, 200, { ok: true });
  }
  async function respond(req, res, threadId) { // outcomes S: server/contracts.ts:162; unavailable marks the card S: index.ts:2116
    const body = await readBody(req) ?? {};
    const list = messagesFor(threadId);
    const msg = list.find((m) => m.card?.requestId === body.requestId);
    if (!msg || !msg.card) return json(res, 200, { ok: true, outcome: "unavailable" });
    if (!["allow", "deny", "answer"].includes(body.behavior)) return json(res, 400, { error: "behavior must be allow, deny, or answer" });
    // Special requests are intercepted before adapter answers (S: index.ts:10981-11013).
    // Model the valid staged proposal cases used by these fixtures, including
    // the hash review gate (S: index.ts:6466-6526). No blanket rejection route.
    if (msg.card.skillRequest || msg.card.routineRequest) {
      // Routine answers are rejected before settlement checks (S: routine-requests.ts:812-818).
      if (msg.card.routineRequest && body.behavior === "answer") return json(res, 400, { error: "Routine confirmations must be confirmed or cancelled" });
      if (msg.card.answered || msg.card.dismissed) return json(res, 200, { ok: true, outcome: msg.card.answered === "allow" ? "allowed-once" : "rejected", alreadySettled: true });
      if (msg.card.skillRequest && body.behavior === "allow" && body.reviewedSha256 !== msg.card.skillRequest.sha256) return json(res, 409, { error: "reviewedSha256 must match the skill shown on the approval card" });
      msg.card.answered = body.behavior === "allow" ? "allow" : "deny";
      msg.card.dismissed = body.behavior !== "allow";
      broadcast({ kind: "message.patch", threadId, message: msg });
      // The fixture represents a valid staged create (S: index.ts:4814-4828;
      // routine-requests.ts:919-925). It does not implement the routine scheduler.
      const routine = msg.card.routineRequest;
      if (routine && body.behavior === "allow") { routine.appliedAt = now(); routine.resultId = newId(); }
      return json(res, 200, { ok: true, outcome: body.behavior === "allow" ? "allowed-once" : "rejected", ...(routine && body.behavior === "allow" ? { routineAction: routine.operation.action, resultId: routine.resultId } : {}) });
    }
    if (msg.card.answered || msg.card.dismissed) return json(res, 200, { ok: true, outcome: "unavailable" });
    if (msg.card.dead) { msg.card.answered = true; broadcast({ kind: "message.patch", threadId, message: msg }); return json(res, 200, { ok: true, outcome: "unavailable" }); }
    let outcome;
    if (body.behavior === "answer") { if (msg.card.tool) return json(res, 400, { error: "this card takes allow or deny" }); outcome = "answered"; msg.card.answer = body.message; }
    else if (body.behavior === "allow") outcome = "allowed-once";
    else if (body.behavior === "deny") outcome = "rejected";
    else return json(res, 400, { error: "behavior must be allow, deny, or answer" });
    msg.card.answered = true;
    state.decisions.unshift({ threadId, requestId: body.requestId, decision: body.behavior, at: now() });
    broadcast({ kind: "message.patch", threadId, message: msg });
    return json(res, 200, { ok: true, outcome });
  }
  function threadMessages(res, url, threadId) { // S: index.ts:1937-1946 pageSize() (default 50, clamp 200, null for a non-integer or negative), 8646 (the 400), 8639-8663
    const list = messagesFor(threadId);
    const limitRaw = url.searchParams.get("limit");
    const size = limitRaw === null ? 50 : Number(limitRaw);
    if (!Number.isInteger(size) || size < 0) return json(res, 400, { error: "limit must be a non-negative whole number" });
    const limit = Math.min(size, 200);
    const before = url.searchParams.get("before");
    let end = list.length;
    if (before !== null) { const i = list.findIndex((m) => m.id === before); if (i < 0) return json(res, 404, { error: "no such message" }); end = i; }
    const start = Math.max(0, end - limit);
    return json(res, 200, { messages: list.slice(start, end), hasMore: start > 0 });
  }
  async function patchBot(req, res, id, auth) { // S: index.ts:9986-10321; cwd allowed while busy (10128); approval change guarded (10162)
    const bot = botById(id); if (!bot) return json(res, 404, { error: "no such bot" });
    const body = await readBody(req) ?? {};
    if (auth.kind === "session" && !auth.scopes.includes("admin")) {
      const allowed = new Set(["name", "title", "description", "unread", "pinned"]);
      if (Object.keys(body).some((k) => !allowed.has(k))) return json(res, 403, { error: "forbidden: this change needs the owner" });
    }
    if (body.description !== undefined) {
      if (typeof body.description !== "string" || body.description.length > MAX_DESCRIPTION) return json(res, 400, { error: `description is longer than ${MAX_DESCRIPTION} characters` });
      bot.description = body.description;
    }
    if (body.cwd !== undefined) {
      if (body.cwd !== null && (typeof body.cwd !== "string" || !path.isAbsolute(body.cwd))) return json(res, 400, { error: "cwd must be an absolute path" });
      bot.cwd = body.cwd ?? undefined;
    }
    if (body.approvalMode !== undefined) {
      if (["full", "custom"].includes(body.approvalMode)) return json(res, 403, { error: "this approval level can only be set from the desktop app" });
      if (!["ask", "auto"].includes(body.approvalMode)) return json(res, 400, { error: "unknown approval level" });
      if (BUSY.has(bot.activity) && body.approvalMode !== (bot.approvalMode ?? "ask")) return json(res, 409, { error: "stop this bot's turn before changing its approval level" }); // S: index.ts:10157-10163 compares approvalModeFor(existingBot)
      if (bot.approvalGrantPending) return json(res, 409, { error: "wait for the approval-level change to finish" });
      bot.approvalMode = body.approvalMode;
    }
    if (body.approvePeerComms !== undefined && typeof body.approvePeerComms !== "boolean") return json(res, 400, { error: "approvePeerComms must be true or false" }); // S: index.ts:10212-10217
    for (const k of ["name", "title", "section", "chiefOfStaff", "approvePeerComms", "hidden"]) if (body[k] !== undefined) bot[k] = body[k];
    broadcast({ kind: "bot", bot: publicBot(bot) });
    return json(res, 200, { bot: publicBot(bot) });
  }
  async function patchGroup(req, res, id) { // S: index.ts:9493-9600; cwd fixed once pinned even when equal (9566)
    const g = groupById(id); if (!g) return json(res, 404, { error: "no such channel" });
    const body = await readBody(req) ?? {};
    if (g.working) return json(res, 409, { error: "the channel is working — wait for the turn to finish" });
    if (body.cwd !== undefined) {
      if (g.dm) return json(res, 400, { error: "direct-message channels cannot have a working folder" });
      if (g.pinnedCwd !== undefined) return json(res, 409, { error: "the room's working folder is fixed after its first turn" });
      if (body.cwd !== null && (typeof body.cwd !== "string" || !path.isAbsolute(body.cwd))) return json(res, 400, { error: "cwd must be an absolute path" });
      g.cwd = body.cwd ?? undefined;
    }
    for (const k of ["name", "bulletin", "memberIds", "section", "defaultResponder"]) if (body[k] !== undefined) g[k] = body[k];
    broadcast({ kind: "group", group: publicGroup(g) });
    return json(res, 200, { group: publicGroup(g) });
  }
  function cursorSeq(raw) { // S: index.ts:2028-2035 (a cursor from another stream is rejected)
    if (!raw) return null; const [stream, seq] = String(raw).split(":"); if (stream !== STREAM_ID) return null;
    const n = Number(seq); return Number.isSafeInteger(n) && n >= 0 ? n : null;
  }
  function events(req, res, url, auth) { // S: index.ts:8553-8619
    if (state.dropStreams) { res.writeHead(200, { "content-type": "text/event-stream" }); res.end(); return; }
    const client = { res, screens: url.searchParams.get("screens") !== "off", session: auth.kind === "session" };
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
    const since = cursorSeq(req.headers["last-event-id"]) ?? cursorSeq(url.searchParams.get("since") ?? undefined);
    const resumed = since !== null && since <= lastSeq && (replay.length === 0 ? since === lastSeq : replay[0].seq <= since + 1);
    res.write(`data: ${JSON.stringify({ kind: "hello", cursor: `${STREAM_ID}:${lastSeq}`, resumed })}\n\n`);
    if (resumed) for (const b of replay) if (b.seq > since && (b.kind !== "screen" || client.screens)) res.write(b.frame);
    sse.add(client);
    req.socket.setTimeout(0);
    const keepalive = setInterval(() => { try { res.write(`: keepalive\n\ndata: ${JSON.stringify({ kind: "ping" })}\n\n`); } catch {} }, heartbeatMs);
    req.on("close", () => { clearInterval(keepalive); sse.delete(client); });
  }

  // ── control route for tests ──
  async function control(req, res, method, p) {
    if (method === "GET" && p === "/__fake/state") {
      return json(res, 200, { environmentId, bots: state.bots.map((b) => ({ ...publicBot(b), key: b.key })), groups: state.groups.map(publicGroup), receipts: state.receipts, decisions: state.decisions, queue: state.queue ?? [], lastSeq, streamId: STREAM_ID, threads: Object.fromEntries(state.threads) });
    }
    if (method !== "POST" || p !== "/__fake") return json(res, 404, { error: "no route" });
    const body = await readBody(req) ?? {};
    const result = apply(body);
    return json(res, 200, { ok: true, ...(result ?? {}) });
  }
  function apply(op) {
    const bot = op.botId ? botById(op.botId) : undefined;
    const threadId = op.threadId ?? bot?.threadId;
    switch (op.op) {
      case "activity": { if (!bot) throw Object.assign(new Error("no such bot"), { status: 404 }); bot.activity = op.activity; broadcast({ kind: "bot", bot: publicBot(bot) }); return; }
      case "leadSay": return { message: appendMessage(threadId, { role: "bot", kind: "text", text: op.text, ...(op.turnId ? { turnId: op.turnId } : {}) }) }; // no `from` on direct turn text: S: index.ts:2731-2736
      case "userSay": return { message: appendMessage(threadId, { role: "user", kind: "text", text: op.text }) };
      case "echo": { const target = op.fromBotId ? botById(op.fromBotId) : undefined; const name = op.name ?? target?.name ?? "Peer";
        return { message: appendMessage(threadId, { role: "bot", kind: "text", text: `@${name} ${ECHO_PREFIX}:\n\n${op.text ?? "ok"}`, from: { botId: op.fromBotId ?? newId(), name, color: "blue" } }) }; } // S: index.ts:3383-3388
      case "delegationActivity": { // S: index.ts:3392-3401, delegations.ts:495
        const variants = { empty: `Delegation to @${op.name} completed without a text reply`, failed: `Delegation to @${op.name} failed — ${op.reason ?? "the delegated turn did not finish"}`, busy: `Delegation to @${op.name} waiting — they're busy (retry 1/3 when they finish)`, dropped: `Delegation to @${op.name} dropped — the queueing turn was interrupted`, canceled: `Delegation to @${op.name} canceled`, denied: `Delegation to @${op.name} denied — peer contact was not approved` };
        return { message: appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: variants[op.variant ?? "empty"], ok: op.variant === "empty" } }) }; }
      case "errorActivity": return { message: appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: `error: ${op.text ?? "the provider refused the turn"}`, ok: false } }) };
      case "card": { // S: index.ts:2917-2945, 2881-2896, 6420-6430; store.ts:63-66.
        const kind = op.kind ?? "approval";
        const card = { title: kind === "question" ? "Your bot has a question" : "Approval needed", subtitle: op.text ?? "May I contact Quill?", options: kind === "question" ? (op.choices ?? []) : ["Allow", "Deny"], requestId: op.requestId ?? newId(), answered: false, dismissed: false, dead: op.dead === true };
        if (kind === "approval") Object.assign(card, { tool: op.tool ?? "ask_bot", ...(op.held !== undefined ? { held: op.held } : {}), ...(op.approvalScope ? { approvalScope: op.approvalScope } : {}), ...(op.allowKey ? { allowKey: op.allowKey } : {}) });
        if (kind === "skill") {
          const preview = "# Example skill\nA fixture proposal.\n";
          card.tool = "learn_skill"; card.options = ["Enable", "Deny"];
          card.skillRequest = { botId: state.bots.find((b) => b.tasks.some((t) => t.threadId === threadId))?.id, stagedId: newId(), name: "example", action: "create", gist: op.text ?? "Example", preview, sha256: createHash("sha256").update(preview).digest("hex") };
        }
        if (kind === "routine") {
          // Valid stored proposal and card shape (S: routine-requests.ts:119-157, 745-751).
          card.tool = "create_routine"; card.options = ["Confirm", "Cancel"];
          card.routineRequest = { version: 1, requestId: card.requestId, botId: state.bots.find((b) => b.tasks.some((t) => t.threadId === threadId))?.id, threadId, createdAt: now(), operation: { action: "create", routine: { name: "Example", instructions: "A fixture proposal.", schedule: { type: "interval", everyMinutes: 60 }, runOn: "maus", durationMinutes: 5 } } };
        }
        return { message: appendMessage(threadId, { role: "bot", kind: "options", card }) };
      }
      case "connector": return { message: appendMessage(threadId, { role: "bot", kind: "text", text: "Connect Slack to continue", connector: { id: newId(), status: "pending", dismissed: false, resumed: false } }) };
      case "secret": return { message: appendMessage(threadId, { role: "bot", kind: "text", text: "A credential is needed", secret: { id: newId(), provided: false, dismissed: false } }) };
      case "receipt": return { receipt: recordReceipt(op) };
      case "notify": { const b = botById(op.botId); if (b && b.notifications === false) return { suppressed: true }; broadcast({ kind: "notify", notification: { kind: op.kind, botId: op.botId, botName: b?.name ?? "", threadId: op.threadId ?? b?.threadId, title: op.title ?? op.kind, body: op.body ?? "" } }); return; }
      case "notifications": { if (!bot) throw Object.assign(new Error("no such bot"), { status: 404 }); bot.notifications = op.enabled !== false; return; }
      case "queued": state.pendingDelegations.push({ sourceBotId: op.sourceBotId, targetBotId: op.targetBotId, reason: op.reason }); return;
      case "running": state.running.push({ sourceBotId: op.sourceBotId, targetBotId: op.targetBotId, threadId: op.threadId ?? newId(), groupId: op.groupId }); return;
      case "clearDelegations": state.pendingDelegations = []; state.running = []; return;
      case "delay": state.delay = { count: op.count ?? 1, ms: op.ms ?? 1000 }; return;
      case "steer": state.steer = op.enabled !== false; state.lateSteerConflict = op.lateConflict === true; return;
      case "autoWork": state.autoWork = op.enabled !== false; return;
      case "dropStreams": state.dropStreams = op.enabled !== false; if (state.dropStreams) for (const c of [...sse]) { try { c.res.end(); } catch {} } return;
      case "pinRoom": { const g = groupById(op.groupId); if (!g) throw Object.assign(new Error("no such channel"), { status: 404 }); g.pinnedCwd = g.cwd ?? null; return; }
      case "roomWorking": { const g = groupById(op.groupId); if (!g) throw Object.assign(new Error("no such channel"), { status: 404 }); g.working = op.working !== false; g.busyBotId = op.busyBotId ?? null; return; }
      case "approvalGrant": { if (!bot) throw Object.assign(new Error("no such bot"), { status: 404 }); bot.approvalGrantPending = op.pending !== false; return; }
      case "credential": { if (!bot) throw Object.assign(new Error("no such bot"), { status: 404 }); bot.savingCredential = op.saving !== false; return; }
      case "busyElsewhere": { if (!bot) throw Object.assign(new Error("no such bot"), { status: 404 }); bot.busyElsewhere = op.where ?? null; return; }
      case "hide": { if (!bot) throw Object.assign(new Error("no such bot"), { status: 404 }); bot.hidden = op.hidden !== false; return; }
      case "token": state.tokens.set(op.token, op.scopes ?? ["client"]); return;
      case "newEnvironment": environmentId = `${newId()}-${newId()}`; fs.writeFileSync(environmentFile, environmentId); return { environmentId };
      case "event": { fs.appendFileSync(path.join(dataDir, "events", `${threadId}.ndjson`), `${JSON.stringify({ at: now(), ...op.event })}\n`); return; }
      case "bot": return { bot: publicBot(makeBot({ ...op, name: uniqueName(op.name) })) };
      case "group": return { group: publicGroup(makeGroup(op)) };
      case "reset": state.bots = []; state.groups = []; state.threads = new Map(); state.receipts = []; state.decisions = []; state.pendingDelegations = []; state.running = []; state.queue = []; saveReceipts(); return;
      default: throw Object.assign(new Error(`unknown op ${op.op}`), { status: 400 });
    }
  }

  // The real server binds a second listener on port+1 for its webhook
  // receiver before the API port (S: index.ts:319-320, 4874; cli.ts:438 passes
  // OMB_WEBHOOK_PORT || port + 1), loopback only (S: webhook-ingress.ts:161-186).
  // It answers GET /health and nothing else (S: webhook-ingress.ts:94-98); a
  // taken port is logged, not fatal (S: index.ts:4877-4879).
  let webhook = null;
  if (opts.webhookPort) {
    const w = http.createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && u.pathname === "/health") return json(res, 200, { app: "openmausbot-webhooks", ready: true });
      return json(res, 404, { error: "Unknown webhook endpoint" });
    });
    try {
      await new Promise((resolve, reject) => { w.once("error", reject); w.listen(opts.webhookPort, "127.0.0.1", () => { w.off("error", reject); resolve(); }); });
      webhook = w;
    } catch (e) { console.error(`openmausbot webhook receiver unavailable: ${e.message}`); }
  }

  const server = http.createServer((req, res) => { handle(req, res).catch((e) => { try { json(res, e.status ?? 500, { error: e.message }); } catch {} }); });
  server.keepAliveTimeout = 5000;
  await new Promise((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}`;
  return {
    url, port, dataDir, server, webhookPort: webhook ? opts.webhookPort : null,
    get environmentId() { return environmentId; },
    apply: (op) => apply(op),
    control: async (op) => { const r = await fetch(`${url}/__fake`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(op) }); const b = await r.json(); if (!r.ok) throw new Error(b.error); return b; },
    snapshot: async () => (await fetch(`${url}/__fake/state`)).json(),
    close: () => new Promise((resolve) => { for (const c of [...sse]) { try { c.res.end(); } catch {} } webhook?.close(); webhook?.closeAllConnections?.(); server.close(() => resolve()); server.closeAllConnections?.(); }),
  };
}

function defaultInstances() {
  return [
    { instanceId: "claude", driverKind: "claude", displayName: "Claude Code", snapshot: { state: "available" }, models: { default: "claude-sonnet-5", options: ["claude-sonnet-5", "claude-fable-5-1"] }, capabilities: { effortLevels: ["low", "medium", "high", "xhigh", "max"] }, access: "subscription" },
    { instanceId: "codex", driverKind: "codex", displayName: "Codex", snapshot: { state: "available" }, models: { default: "gpt-5.6-luna", options: ["gpt-5.6-luna", "gpt-6-astra"] }, capabilities: { effortLevels: ["low", "medium", "high", "xhigh"] }, access: "subscription" },
    { instanceId: "grok", driverKind: "grok", displayName: "Grok Build", snapshot: { state: "unavailable" }, models: { default: "grok-4", options: ["grok-4"] }, capabilities: { effortLevels: [] }, access: "none" },
  ];
}

// ── CLI: `serve` as a supervisor with a server child, like server/cli.ts ──
function parseCli(argv) {
  const o = { command: argv[0], port: Number(process.env.OMB_PORT || 8799), dataDir: process.env.OMB_DATA_DIR ?? path.join(process.env.HOME ?? "/tmp", ".openmausbot"), pair: true };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") o.port = Number(argv[++i]);
    else if (a === "--data-dir") o.dataDir = path.resolve(argv[++i]);
    else if (a === "--no-pair") o.pair = false;
    else if (a === "--label") i++;
    else { console.error(`unknown argument ${a}`); process.exit(2); }
  }
  return o;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = parseCli(process.argv.slice(2));
  if (o.command === "child") {
    const f = await createFake({ port: o.port, dataDir: o.dataDir, webhookPort: Number(process.env.OMB_WEBHOOK_PORT || o.port + 1) }); // S: index.ts:320
    const stop = () => { f.close().then(() => process.exit(0)); };
    process.on("SIGTERM", stop); process.on("SIGINT", stop);
    console.log(`child listening on ${f.url}`);
    if (f.webhookPort) console.log(`openmausbot webhook receiver on http://127.0.0.1:${f.webhookPort}`); // S: index.ts:4876
  } else if (o.command === "serve") {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "child", "--port", String(o.port), "--data-dir", o.dataDir], { env: { ...process.env, OMB_DATA_DIR: o.dataDir, OMB_PORT: String(o.port), OMB_WEBHOOK_PORT: process.env.OMB_WEBHOOK_PORT || String(o.port + 1) }, stdio: ["ignore", "inherit", "inherit"] }); // S: cli.ts:438
    let exited = null;
    child.on("exit", (code) => { exited = code ?? 1; });
    const stop = () => { if (exited === null) child.kill("SIGTERM"); };
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
    const deadline = Date.now() + 30_000;
    let up = false;
    while (Date.now() < deadline && exited === null) {
      try { const r = await fetch(`http://127.0.0.1:${o.port}/api/health`, { signal: AbortSignal.timeout(2000) }); const b = await r.json(); if (b.app === "openmausbot") { up = true; break; } } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!up) { console.error("the server did not answer"); stop(); process.exit(1); }
    console.log(`OpenMausBot is running on http://127.0.0.1:${o.port}`);
    console.log(`data: ${o.dataDir}`);
    child.on("exit", (code) => process.exit(code ?? 0));
  } else if (o.command === "status") {
    console.log(JSON.stringify({ app: "openmausbot", version: "0.1.56" }));
  } else {
    console.log("usage: fake-omb.mjs serve [--port N] [--data-dir D] [--no-pair]");
    process.exit(o.command ? 2 : 0);
  }
}
