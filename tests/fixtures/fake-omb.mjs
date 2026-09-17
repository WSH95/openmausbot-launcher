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

// ── pairing (S: server/sessions.ts) ──
const PAIRING_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // S: sessions.ts:19 (no 0/O/1/I)
const PAIRING_CODE_LENGTH = 12; // S: sessions.ts:20
const PAIRING_CODE_TTL_MS = 5 * 60_000; // S: sessions.ts:21
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000; // S: sessions.ts:22
const LOCKOUT = { failures: 10, windowMs: 60_000, lockMs: 60_000 }; // S: sessions.ts:29
const EXCHANGE_REPLAY_MS = 60_000; // S: sessions.ts:35
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
// 256 is a multiple of the 32-symbol alphabet, so the byte modulus is unbiased.
const generatePairingCode = () => Array.from(randomBytes(PAIRING_CODE_LENGTH), (b) => PAIRING_CODE_ALPHABET[b % PAIRING_CODE_ALPHABET.length]).join("");
/** XXXX-XXXX-XXXX, as the server presents it. S: sessions.ts:119-121. */
const formatPairingCode = (code) => code.match(/.{1,4}/g)?.join("-") ?? code;
/** Accept what a human typed: dashes, spaces, lowercase, lookalikes. S: sessions.ts:110-116. */
const normalizePairingCode = (input) => String(input).toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/0/g, "O").replace(/1/g, "I");

const BUSY = new Set(["working", "waiting-on-you", "no-signal"]); // S: server/store.ts:407-409
const ECHO_PREFIX = "replied to the delegated task"; // S: server/index.ts:3387 (and :3358)
const MAX_DESCRIPTION = 4000; // S: server/bot-package.ts (description ≤ 4000)
const MAX_TAGLINE = 160; // S: import 400 on a long tagline (devpack EVIDENCE.md:302)

// The five credentials a bot may ask for, and the config field each one is
// written to. The id is the whole authority surface: no agent picks a path.
// S: shared/credential-request.ts:6-38 (targets) and :52-65 (the patch shape).
const CREDENTIAL_TARGETS = {
  xaiApiKey: { label: "xAI API key", description: "Used by the built-in Grok provider.", placeholder: "xai-…", helpUrl: "https://console.x.ai/", section: "xai", field: "key" },
  boxToken: { label: "Box API key", description: "Gives bots an isolated cloud computer when Box is selected.", placeholder: "Paste your Box API key", helpUrl: "https://docs.ascii.dev/box/api-keys", section: "box", field: "token" },
  opencodeGoApiKey: { label: "OpenCode API key", description: "Used for OpenCode Go and other key-backed OpenCode providers.", placeholder: "Paste your OpenCode API key", helpUrl: "https://opencode.ai/docs/providers/", section: "opencodeGo", field: "apiKey" },
  ttsKey: { label: "ElevenLabs API key", description: "Enables text-to-speech voices in calls.", placeholder: "Paste your ElevenLabs API key", helpUrl: "https://elevenlabs.io/app/settings/api-keys", section: "tts", field: "key" },
  openaiImageApiKey: { label: "OpenAI API key", description: "Used only to generate custom bot avatar images.", placeholder: "sk-…", helpUrl: "https://platform.openai.com/api-keys", section: "imageGen", field: "key" },
};
// Config sections whose save does NOT rebuild the provider fleet
// (S: index.ts:12003-12014). Everything else, `xai` and `opencodeGo` among
// the driver's credential targets, does.
const CONFIG_NO_RELOAD = new Set(["profile", "language", "tts", "imageGen", "vps", "rooms", "localVm", "features", "browserProfiles"]);
// S: routine-requests.ts:41-48 — the label each action puts on its card.
const ROUTINE_ACTION_COPY = {
  create: { title: "Schedule", detail: "Create routine" }, update: { title: "Update", detail: "Update routine" },
  pause: { title: "Pause", detail: "Pause routine" }, resume: { title: "Resume", detail: "Resume routine" },
  run_now: { title: "Run now", detail: "Run routine now" }, delete: { title: "Delete", detail: "Delete routine" },
};

const newId = () => randomBytes(8).toString("hex");
const now = () => Date.now();
/** S: index.ts:6742-6744 — the only text a credential card puts in the transcript. */
const credentialDesktopHandoff = (label) => `Securely provide the ${label} from OpenMausBot on your phone or computer. It is never added to chat.`;
/** The card's schedule line. The real one formats in the server's time zone
 * (S: routine-requests.ts:538); a fixture needs only a stable rendering. */
const scheduleText = (s) => s.type === "once" ? `Once at ${new Date(s.at).toISOString()}` : s.type === "daily" ? `Daily at ${s.time}` : `Every ${s.everyMinutes} minutes`;

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
    pairings: [], sessions: [], replays: [], failures: new Map(), // S: sessions.ts:136-142
    delay: { count: 0, ms: 0 }, dropNext: 0, steer: false, lateSteerConflict: false,
    dropStreams: false, sequence: 0, instances: defaultInstances(),
    // Cards and the settings they touch. `config` holds configured-or-not
    // booleans only: this fake never stores a credential value anywhere.
    routines: [], routineRuns: [], skills: new Map(), accounts: new Map(), config: {}, wakes: [], providerReloads: 0,
    providerBusy: false, phoneSaving: new Set(), configPutHangs: 0, configPutFails: 0,
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

  // ── pairing and sessions ── S: sessions.ts. A pairing code is single use and
  // five minutes old at most; exchanging it yields an `omb_sess_…` token that
  // lives 30 days. Failed exchanges are counted per source.
  const environmentDescriptor = () => ({ environmentId, label: "fake", platform: "linux", version: "0.1.56", desktopManaged: false, capabilities: { remoteSessions: true, selfUpdate: "operator" } });
  const publicSession = (s) => ({ id: s.id, label: s.label, scopes: [...s.scopes], createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt }); // never the token: S: sessions.ts:123-132
  const publicPairing = (p) => ({ id: p.id, label: p.label, scopes: [...p.scopes], createdAt: p.createdAt, expiresAt: p.expiresAt }); // S: sessions.ts:223-226

  function pruneAuth() { // S: sessions.ts:175-182
    const t = now();
    state.pairings = state.pairings.filter((p) => p.expiresAt > t);
    state.replays = state.replays.filter((r) => r.expiresAt > t);
    state.sessions = state.sessions.filter((s) => { if (s.expiresAt > t) return true; state.tokens.delete(s.token); return false; });
  }

  function openPairing({ label, scopes } = {}) { // S: sessions.ts:206-221
    pruneAuth();
    const code = generatePairingCode();
    const p = { id: newId(), codeHash: sha256(code), scopes: scopes?.length ? [...new Set(scopes)] : ["admin", "client"], label: String(label ?? "").trim().slice(0, 80), createdAt: now(), expiresAt: now() + PAIRING_CODE_TTL_MS };
    state.pairings.push(p);
    return { id: p.id, code, expiresAt: p.expiresAt };
  }

  function recordFailure(source) { // S: sessions.ts:248-262
    const t = now();
    const entry = state.failures.get(source) ?? { count: 0, windowStart: t, lockedUntil: 0 };
    if (t - entry.windowStart > LOCKOUT.windowMs) { entry.count = 0; entry.windowStart = t; }
    entry.count += 1;
    if (entry.count >= LOCKOUT.failures) { entry.lockedUntil = t + LOCKOUT.lockMs; entry.count = 0; entry.windowStart = t; }
    state.failures.set(source, entry);
  }

  /** The lockout key. Every fake peer is loopback, so a forwarded hop wins. S: request-auth.ts:111-120. */
  function requestSource(req) {
    const hops = String(req.headers["x-forwarded-for"] ?? "").split(",").map((h) => h.trim()).filter(Boolean);
    return hops.length ? hops[hops.length - 1] : (req.socket?.remoteAddress || "unknown");
  }

  function exchange({ code, label, attemptId, source }) { // S: sessions.ts:269-303
    pruneAuth();
    const t = now();
    const presented = sha256(normalizePairingCode(code ?? ""));
    // A consumed code presented again with the SAME attempt id inside the
    // window gets the same answer, so a lost response strands nobody.
    const attempt = typeof attemptId === "string" && /^[\w-]{8,64}$/.test(attemptId) ? attemptId : null; // S: sessions.ts:273
    const replay = attempt ? state.replays.find((r) => r.attemptId === attempt && r.codeHash === presented) : undefined;
    if (replay) return replay.result;
    const locked = state.failures.get(source);
    if (locked && locked.lockedUntil > t) return { ok: false, status: 429, error: `too many failed pairing attempts from your address; try again in ${Math.ceil((locked.lockedUntil - t) / 1000)}s` }; // S: sessions.ts:278-281
    const index = state.pairings.findIndex((p) => p.codeHash === presented);
    if (index < 0) {
      recordFailure(source);
      return { ok: false, status: 401, error: "pairing code is wrong or has expired; create a new one on the server" }; // S: sessions.ts:283-286
    }
    const [pairing] = state.pairings.splice(index, 1); // single use: S: sessions.ts:286
    state.failures.delete(source);
    const token = `omb_sess_${randomBytes(32).toString("base64url")}`; // S: sessions.ts:288
    const session = { id: newId(), label: (String(label ?? "").trim() || pairing.label || "Unnamed device").slice(0, 80), scopes: [...pairing.scopes], createdAt: t, lastSeenAt: t, expiresAt: t + SESSION_TTL_MS }; // S: sessions.ts:289-297
    state.sessions.push({ ...session, token });
    state.tokens.set(token, session.scopes);
    const result = { ok: true, token, session };
    if (attempt) state.replays.push({ codeHash: presented, attemptId: attempt, result, expiresAt: t + EXCHANGE_REPLAY_MS }); // S: sessions.ts:302
    return result;
  }

  function revokeSession(id) { // S: sessions.ts:334-340
    const s = state.sessions.find((x) => x.id === id);
    if (!s) return false;
    state.sessions = state.sessions.filter((x) => x.id !== id);
    state.tokens.delete(s.token);
    return true;
  }

  // ── auth ── S: request-auth.ts:319-384. loopback without proxy headers = admin;
  // a bearer session wins over loopback; client scope is a default-deny table.
  const CLIENT_ALLOW = [ // S: request-auth.ts:185-250 (the subset the driver can hit)
    ["DELETE", /^\/api\/routines\/[\w-]+$/], // S: request-auth.ts:241
    ["GET", /^\/api\/auth\/session$/], ["GET", /^\/api\/health$/], ["GET", /^\/api\/events$/],
    ["GET", /^\/api\/bots$/], ["GET", /^\/api\/team-map$/], ["GET", /^\/api\/threads\/[\w-]+\/messages$/],
    ["POST", /^\/api\/bots\/[\w-]+\/messages$/], ["POST", /^\/api\/bots\/[\w-]+\/interrupt$/],
    ["POST", /^\/api\/bots\/[\w-]+\/tasks$/], ["POST", /^\/api\/bots\/[\w-]+\/tasks\/[\w-]+$/], // S: request-auth.ts:210-211
    ["POST", /^\/api\/bots\/[\w-]+\/respond$/],
    ["POST", /^\/api\/threads\/[\w-]+\/respond$/], ["PATCH", /^\/api\/bots\/[\w-]+$/], ["PATCH", /^\/api\/groups\/[\w-]+$/],
    ["POST", /^\/api\/groups\/[\w-]+\/messages$/], ["GET", /^\/api\/routines$/], ["GET", /^\/api\/config$/],
    // Cards a client session may act on. Authorizing a connection and
    // confirming a saved credential are the owner's (S: request-auth.ts:218-220).
    ["GET", /^\/api\/bots\/[\w-]+\/connector-cards\/[\w-]+\/status$/],
    ["POST", /^\/api\/bots\/[\w-]+\/connector-cards\/[\w-]+\/(?:resume|dismiss)$/],
    ["POST", /^\/api\/bots\/[\w-]+\/secret-cards\/[\w-]+\/(?:resume|dismiss)$/],
  ];
  function authorize(req, method, pathname) {
    // Two public routes come before the gate: what this server is, and turning
    // a pairing code into a session. S: index.ts:7314-7318.
    if (pathname === "/.well-known/openmausbot/environment" || (method === "POST" && pathname === "/api/auth/pair") || pathname.startsWith("/__fake")) return { kind: "public" };
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "")?.[1];
    if (bearer) {
      const scopes = state.tokens.get(bearer);
      if (!scopes) return { deny: [401, "unauthorized: this session has expired or was revoked; pair this device again"] }; // S: request-auth.ts:375
      const needed = CLIENT_ALLOW.some(([m, re]) => m === method && re.test(pathname)) ? "client" : "admin"; // S: request-auth.ts:252-258 (default deny)
      if (!scopes.includes(needed)) return { deny: [403, `forbidden: this session lacks the ${needed} scope`] }; // S: request-auth.ts:344-347
      return { kind: "session", scopes, sessionId: state.sessions.find((s) => s.token === bearer)?.id ?? null };
    }
    const proxied = ["x-forwarded-for", "x-forwarded-proto", "x-forwarded-host", "forwarded"].some((h) => req.headers[h]);
    if (proxied) return { deny: [403, "forbidden: this request came through a proxy (pair this device to use the server remotely)"] }; // S: request-auth.ts:378
    const host = String(req.headers.host ?? "").split(":")[0];
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) return { deny: [403, "forbidden: loopback host required (pair this device to use the server remotely)"] }; // S: request-auth.ts:381
    return { kind: "loopback", scopes: ["admin", "client"] };
  }

  // ── handlers ──
  // `dropNext` marks a response to be thrown away after its handler ran: the
  // server acted and the client never heard, which is the case the pairing
  // replay window exists for (S: sessions.ts:31-35).
  const json = (res, status, body) => {
    if (res.dropped) return void res.destroy();
    res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let d = ""; req.on("data", (c) => { d += c; }); req.on("end", () => { if (!d) return resolve(null); try { resolve(JSON.parse(d)); } catch (e) { reject(Object.assign(new Error("invalid json"), { status: 400 })); } }); req.on("error", reject);
  });

  async function handle(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    const method = req.method ?? "GET";
    const p = url.pathname;
    if (state.delay.count > 0) { state.delay.count--; await new Promise((r) => setTimeout(r, state.delay.ms)); }
    if (state.dropNext > 0 && !p.startsWith("/__fake")) { state.dropNext--; res.dropped = true; }
    const auth = authorize(req, method, p);
    // Reachability probe, public: the phone races it across a server's
    // addresses before it has a session. A stranger learns only the app name;
    // the pid and the static flag stay behind the gate (S: index.ts:7351-7357).
    if (auth.deny && method === "GET" && p === "/api/health") return json(res, 200, { app: "openmausbot" });
    if (auth.deny) return json(res, auth.deny[0], { error: auth.deny[1] });
    try {
      let m;
      if (p.startsWith("/__fake")) return control(req, res, method, p);
      if (method === "GET" && p === "/.well-known/openmausbot/environment") return json(res, 200, environmentDescriptor());
      if (method === "GET" && p === "/api/health") return json(res, 200, { app: "openmausbot", pid: process.pid, static: false });
      if (method === "GET" && p === "/api/auth/session") return json(res, 200, { kind: auth.kind, scopes: auth.scopes });
      if (method === "POST" && p === "/api/auth/pair") { // S: index.ts:7318-7341
        // JSON only: a cross-site HTML form cannot send this content type
        // without a preflight, so a stray code cannot be planted as a session.
        if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) return json(res, 415, { error: "send the pairing code as JSON (content-type: application/json)" }); // S: index.ts:7322-7324
        const body = await readBody(req) ?? {};
        const result = exchange({ code: typeof body.code === "string" ? body.code : "", label: typeof body.label === "string" ? body.label : "", attemptId: body.attemptId, source: requestSource(req) });
        if (!result.ok) return json(res, result.status, { error: result.error }); // S: index.ts:7331-7334
        return json(res, 200, { token: result.token, session: result.session, environment: environmentDescriptor() });
      }
      if (method === "POST" && p === "/api/auth/pairing") { // S: index.ts:7388-7405
        const body = await readBody(req) ?? {};
        const requested = Array.isArray(body.scopes) ? body.scopes.filter((v) => v === "admin" || v === "client") : undefined;
        const opened = openPairing({ label: typeof body.label === "string" ? body.label : undefined, scopes: requested });
        return json(res, 200, { id: opened.id, code: formatPairingCode(opened.code), expiresAt: opened.expiresAt, url: null, hint: "this server has no public address to put in a link: set OMB_PUBLIC_URL, or open /pair on the address you use and type the code" });
      }
      if (method === "GET" && p === "/api/auth/pairing") { pruneAuth(); return json(res, 200, { pairings: state.pairings.map(publicPairing) }); } // S: index.ts:7406
      if (method === "GET" && p === "/api/auth/sessions") { pruneAuth(); return json(res, 200, { sessions: state.sessions.map(publicSession), current: auth.sessionId ?? null }); } // S: index.ts:7412-7414
      if ((m = p.match(/^\/api\/auth\/pairing\/([\w-]+)$/)) && method === "DELETE") { // S: index.ts:7407-7411
        const before = state.pairings.length;
        state.pairings = state.pairings.filter((x) => x.id !== m[1]);
        return state.pairings.length !== before ? json(res, 200, { ok: true }) : json(res, 404, { error: "no such pairing code" });
      }
      if ((m = p.match(/^\/api\/auth\/sessions\/([\w-]+)$/)) && method === "DELETE") { // S: index.ts:7415-7420
        return revokeSession(m[1]) ? json(res, 200, { ok: true }) : json(res, 404, { error: "no such session" });
      }
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
      if ((m = p.match(/^\/api\/teams\/import$/)) && method === "POST") return importTeam(req, res, url);
      if ((m = p.match(/^\/api\/bots\/([\w-]+)\/model$/)) && method === "PATCH") return patchModel(req, res, m[1]);
      if ((m = p.match(/^\/api\/bots\/([\w-]+)\/tasks$/)) && method === "POST") return postTask(req, res, m[1]);
      if ((m = p.match(/^\/api\/bots\/([\w-]+)\/tasks\/([\w-]+)$/)) && method === "POST") return switchTask(res, m[1], m[2]);
      if (method === "GET" && p === "/api/routines") return json(res, 200, { routines: state.routines, runs: state.routineRuns }); // S: index.ts:8438-8447
      if ((m = p.match(/^\/api\/routines\/([\w-]+)$/)) && method === "DELETE") { // S: index.ts:8461-8464
        const found = state.routines.some((r) => r.id === m[1]);
        state.routines = state.routines.filter((r) => r.id !== m[1]);
        return found ? json(res, 200, { ok: true }) : json(res, 404, { error: "no such routine" });
      }
      if ((m = p.match(/^\/api\/bots\/([\w-]+)\/skills\/([a-z0-9-]+)$/))) { // S: index.ts:10557-10574
        const key = `${m[1]}/${m[2]}`;
        if (method === "GET") return state.skills.has(key) ? json(res, 200, { text: state.skills.get(key) }) : json(res, 404, { error: "no such skill" });
        if (method === "DELETE") return state.skills.delete(key) ? json(res, 200, { ok: true }) : json(res, 404, { error: `no imported skill named "${m[2]}"` }); // S: skills.ts:742-746
      }
      if (method === "GET" && p === "/api/config") return json(res, 200, configStatus());
      if ((method === "PUT" || method === "PATCH") && p === "/api/config") return putConfig(req, res);
      if ((m = p.match(/^\/api\/bots\/([\w-]+)\/connector-cards\/([\w-]+)\/(authorize|status|resume|dismiss)$/))) return connectorCard(req, res, method, url, m[1], m[2], m[3]);
      if ((m = p.match(/^\/api\/bots\/([\w-]+)\/secret-cards\/([\w-]+)\/(provide|provided|resume|dismiss)$/)) && method === "POST") return secretCard(req, res, m[1], m[2], m[3]);
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
  function switchTask(res, id, threadId) { // S: index.ts:11120-11140
    // Making another task the active one is the only way a message reaches it,
    // and it is refused mid-turn because switching would lose ownership of the
    // running process (S: index.ts:11127-11131).
    const bot = botById(id); if (!bot) return json(res, 404, { error: "no such bot" });
    if (bot.savingCredential) return json(res, 409, { error: "this bot is securely saving a credential — try again when it finishes" });
    if (BUSY.has(bot.activity)) return json(res, 409, { error: "this bot is working — stop it before switching tasks" });
    if (!taskByThread(bot, threadId)) return json(res, 404, { error: "no such task" });
    bot.threadId = threadId;
    broadcast({ kind: "bot", bot: publicBot(bot) });
    return json(res, 200, { bot: publicBot(bot) });
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
    // S: index.ts:11077-11084. A turn pinned to a non-active thread — a held
    // delegation wake drained on its own thread (S: index.ts:3225-3233) — is
    // out of reach: only the active thread, or a dispatch claim this fake does
    // not model (S: index.ts:11048, 808-823), answers to its own id.
    if (body.threadId && body.threadId !== bot.threadId) return json(res, 409, { error: "the bot switched tasks before it could be interrupted" });
    bot.activity = "idle"; bot.turnThreadId = null; broadcast({ kind: "bot", bot: publicBot(bot) });
    return json(res, 200, { ok: true });
  }
  async function respond(req, res, threadId) { // outcomes S: server/contracts.ts:162; unavailable marks the card S: index.ts:2116
    const body = await readBody(req) ?? {};
    if (!["allow", "deny", "answer"].includes(body.behavior)) return json(res, 400, { error: "behavior must be allow, deny, or answer" }); // S: index.ts:10978
    const list = messagesFor(threadId);
    const msg = list.find((m) => m.card?.requestId === body.requestId);
    if (!msg || !msg.card) return json(res, 200, { ok: true, outcome: "unavailable" });
    // Special requests are intercepted before adapter answers (S: index.ts:10980-11013).
    if (msg.card.skillRequest) return respondSkill(res, threadId, msg, body);
    if (msg.card.routineRequest) return respondRoutine(res, threadId, msg, body);
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
  /** S: index.ts:6438-6597. A settled card answers with its own outcome, any
   * behaviour other than allow rejects the staged write, and an allow passes
   * the reviewed hash, then the preview's own hash, before it is applied. */
  function respondSkill(res, threadId, msg, body) {
    const card = msg.card; const request = card.skillRequest;
    const owner = state.bots.find((b) => taskByThread(b, threadId)); // S: index.ts:10983-10986
    if (!owner) return json(res, 400, { error: "this skill request has no valid owner" });
    if (request.botId !== owner.id) return json(res, 403, { error: "this skill request belongs to a different bot" }); // S: index.ts:6455-6457
    const settle = (patch) => { Object.assign(card, patch); broadcast({ kind: "message.patch", threadId, message: msg }); };
    const decide = (decision) => state.decisions.unshift({ threadId, requestId: request.requestId, botId: request.botId, tool: card.tool, summary: card.subtitle, decision, source: "user", at: now() }); // S: index.ts:6479-6488
    if (card.answered || card.dismissed) return json(res, 200, { ok: true, outcome: card.answered === "allow" ? "allowed-once" : "rejected", alreadySettled: true }); // :6458-6468
    if (body.behavior !== "allow") { // :6470-6504 — an `answer` rejects the skill too
      settle({ answered: "deny", dismissed: true, held: undefined }); decide("user-denied");
      return json(res, 200, { ok: true, outcome: "rejected" });
    }
    if (typeof request.preview !== "string" || typeof request.sha256 !== "string") return json(res, 409, { error: "this proposal was created by an older build — deny it and ask the bot to create it again" }); // :6506-6512
    if (body.reviewedSha256 !== request.sha256) return json(res, 409, { error: "reviewedSha256 must match the skill shown on the approval card" }); // :6513-6519
    if (createHash("sha256").update(request.preview).digest("hex") !== request.sha256) return json(res, 422, { error: "the skill preview changed after review — deny and recreate it" }); // :6520-6523
    if (request.stagedGone) return json(res, 422, { error: "the staged skill no longer matches this approval card" }); // :6532-6542
    state.skills.set(`${request.botId}/${request.name}`, request.preview);
    settle({ answered: "allow", dismissed: false, held: undefined }); decide("user-approved");
    return json(res, 200, { ok: true, outcome: "allowed-once" });
  }

  /** S: routine-requests.ts:800-930 and index.ts:4802-4830. A textual answer is
   * refused before anything is read; an allow revalidates the operation and a
   * refusal is written onto the card as `held`. */
  function respondRoutine(res, threadId, msg, body) {
    const card = msg.card; const payload = card.routineRequest; const operation = payload.operation;
    const owner = state.bots.find((b) => taskByThread(b, threadId)); // S: index.ts:11002-11005
    if (!owner) return json(res, 400, { error: "this routine request has no valid owner" });
    const decide = (decision) => state.decisions.unshift({ threadId, requestId: body.requestId, botId: owner.id, botName: owner.name, tool: card.tool, summary: card.subtitle, decision, source: "user", at: now() }); // S: index.ts:4836-4854
    const deny = () => { card.answered = "deny"; card.held = undefined; patch(); decide("user-denied"); return json(res, 200, { ok: true, outcome: "rejected" }); };
    const patch = () => broadcast({ kind: "message.patch", threadId, message: msg });
    const held = (status, error) => { card.held = error; patch(); return json(res, status, { error }); }; // :896-908
    if (body.behavior !== "allow" && body.behavior !== "deny") return json(res, 400, { error: "Routine confirmations must be confirmed or cancelled" }); // :812-818
    if (payload.requestId !== body.requestId) return body.behavior === "deny" ? deny() : json(res, 400, { error: "This routine request id does not match its confirmation card" }); // S: routine-requests.ts:839-846
    if (payload.botId !== owner.id || payload.threadId !== threadId) return body.behavior === "deny" ? deny() : json(res, 403, { error: "This routine request belongs to another conversation" }); // S: routine-requests.ts:848-855
    if (card.answered) return json(res, 200, { ok: true, outcome: card.answered === "allow" ? "allowed-once" : "rejected", alreadySettled: true }); // index.ts:4811-4818
    if (body.behavior === "deny") return deny(); // S: routine-requests.ts:885-888
    if (operation.action !== "create") { // verifyManageSnapshot, :642-656
      const current = state.routines.find((r) => r.id === operation.routineId && r.botId === payload.botId);
      if (!current) return held(404, "That routine no longer exists"); // :648
      if (current.updatedAt !== operation.expectedUpdatedAt) return held(409, "That routine changed after this confirmation card was prepared. Ask the bot to review it and propose the action again."); // :650-653
    }
    const schedule = operation.action === "create" ? operation.routine.schedule : operation.changes?.schedule;
    if (schedule?.type === "once" && schedule.at <= now()) return held(409, "That one-time schedule is now in the past. Ask the bot to propose a new time."); // :679-681
    const resultId = applyRoutine(payload); // :981-1041
    card.answered = "allow"; card.held = undefined;
    payload.appliedAt = now(); payload.resultId = resultId; // :919-925
    patch();
    decide("user-approved");
    return json(res, 200, { ok: true, outcome: "allowed-once", routineAction: operation.action, resultId }); // index.ts:4823-4829
  }

  /** The routine each confirmed operation leaves behind; `run_now` answers with
   * the run's id rather than the routine's (S: routine-requests.ts:981-1041). */
  function applyRoutine(payload) {
    const operation = payload.operation;
    if (operation.action === "create") {
      const routine = { id: newId(), name: operation.routine.name, prompt: operation.routine.instructions, botId: operation.forBot?.botId ?? payload.botId, schedule: operation.routine.schedule, runOn: operation.routine.runOn, durationMinutes: operation.routine.durationMinutes, enabled: true, updatedAt: now() };
      state.routines.push(routine);
      return routine.id;
    }
    const current = state.routines.find((r) => r.id === operation.routineId);
    if (operation.action === "delete") { state.routines = state.routines.filter((r) => r.id !== operation.routineId); return operation.routineId; }
    if (operation.action === "run_now") { const run = { id: newId(), routineId: operation.routineId, startedAt: now() }; state.routineRuns.push(run); return run.id; }
    if (operation.action === "update") Object.assign(current, operation.changes);
    if (operation.action === "pause" || operation.action === "resume") current.enabled = operation.action === "resume";
    current.updatedAt = now();
    return current.id;
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
  // ── connection and credential cards ──
  // A card is bound to the bot AND the exact thread that raised it
  // (S: index.ts:6612-6615, 6746-6756); anything else is "no such …".
  const cardMessage = (botId, threadId, messageId, want) => {
    const bot = botById(botId);
    if (!bot || !taskByThread(bot, threadId)) return null;
    const message = messagesFor(threadId).find((x) => x.id === messageId);
    return message?.kind === want && message[want] ? message : null;
  };
  const patchCard = (threadId, message) => broadcast({ kind: "message.patch", threadId, message });
  /** The turn a settled card starts again. Recorded rather than run: a fixture
   * has no provider (S: index.ts:6637, 6778-6781 for the two prompts). */
  const wake = (kind, botId, threadId, prompt) => state.wakes.push({ kind, botId, threadId, prompt, at: now() });

  const connectorCards = (threadId, resumeKey) => messagesFor(threadId).filter((x) => x.kind === "connector" && x.connector?.resumeKey === resumeKey); // S: index.ts:6618-6622
  function maybeResumeConnectors(botId, threadId, resumeKey) { // S: index.ts:6687-6697
    const cards = connectorCards(threadId, resumeKey);
    if (!cards.length || cards.some((x) => x.connector.dismissed || x.connector.status !== "connected")) return false;
    if (cards.every((x) => x.connector.resumed)) return true;
    for (const x of cards) { x.connector = { ...x.connector, resumed: true, error: undefined }; patchCard(threadId, x); }
    wake("connector", botId, threadId, `OpenMausBot connection update: the user securely connected ${cards.map((x) => x.connector.label).join(", ")}. Continue the task that paused for this connection. Do not ask them to connect it again.`);
    return true;
  }

  async function connectorCard(req, res, method, url, botId, messageId, action) { // S: index.ts:12234-12289
    const body = method === "POST" ? await readBody(req) ?? {} : {};
    const threadId = String(method === "GET" ? url.searchParams.get("threadId") ?? "" : body.threadId ?? "");
    const message = cardMessage(botId, threadId, messageId, "connector");
    if (!message) return json(res, 404, { error: "no such connection request" });
    const connector = message.connector;
    if (action === "authorize" && method === "POST") {
      message.connector = { ...connector, status: "authorizing", error: undefined, dismissed: false };
      patchCard(threadId, message);
      // Model project-session account guards, including the default 400 for
      // a missing alias (S: composio.ts:348-350, 924-935).
      const accounts = [...state.threads.values()].flat().filter((m) => m.connector?.slug === connector.slug && state.accounts.has(m.id));
      const usable = accounts.filter((m) => /^(active|initiated|initializing|pending)$/i.test(state.accounts.get(m.id)));
      const refusal = usable.length >= 5 ? { status: 409, error: `${connector.slug} already has the maximum of 5 accounts` }
        : usable.length && !connector.alias ? { status: 400, error: "Add an account alias so the existing connection is not replaced" }
        : connector.alias && accounts.some((m) => m.connector.alias?.trim().toLowerCase() === connector.alias.toLowerCase()) ? { status: 409, error: `Account alias "${connector.alias}" is already in use for ${connector.slug}` } : null;
      if (refusal) { // S: index.ts:12245-12250
        message.connector = { ...connector, status: "failed", error: refusal.error.slice(0, 180) }; patchCard(threadId, message);
        return json(res, refusal.status, { error: refusal.error });
      }
      // The browser link is handed to this caller once and never stored
      // in the transcript (S: index.ts:12231-12233, composio.ts:937-945).
      return json(res, 200, { url: `https://connect.example/${connector.slug}/${messageId}` });
    }
    if (action === "status" && method === "GET") {
      const status = state.accounts.get(messageId) ?? "not_connected";
      const connected = /^active$/i.test(status);
      const failed = /failed|expired|revoked|error/i.test(status);
      message.connector = { ...connector, status: connected ? "connected" : failed ? "failed" : "authorizing", error: failed ? `Connection ${status}` : undefined };
      patchCard(threadId, message);
      if (connected) maybeResumeConnectors(botId, threadId, connector.resumeKey);
      return json(res, 200, { connected, pending: /^(initiated|initializing|pending)$/i.test(status), status });
    }
    if (action === "resume" && method === "POST") {
      return maybeResumeConnectors(botId, threadId, connector.resumeKey)
        ? json(res, 200, { resumed: true })
        : json(res, 409, { error: "finish connecting every requested app first" });
    }
    if (action === "dismiss" && method === "POST") { // a dismissal never wakes the bot
      message.connector = { ...connector, dismissed: true };
      patchCard(threadId, message);
      return json(res, 200, { dismissed: true });
    }
    return json(res, 405, { error: "method not allowed" });
  }

  const credentialIsConfigured = (target) => state.config[CREDENTIAL_TARGETS[target].section] === true;
  function resumeSecretCard(botId, threadId, message, outcome) { // S: index.ts:6838-6853
    if (message.secret.resumed) return true;
    message.secret = { ...message.secret, provided: outcome === "provided" ? true : message.secret.provided, dismissed: outcome === "dismissed" ? true : message.secret.dismissed, resumed: true, error: undefined };
    patchCard(threadId, message);
    wake("secret", botId, threadId, outcome === "provided"
      ? `OpenMausBot credential update: the user securely provided ${message.secret.label}. Continue the task that paused for it. You do not receive the secret and must not ask them to paste it into chat.`
      : `OpenMausBot credential update: the user declined to provide ${message.secret.label}. Continue without it if possible, or briefly explain the limitation. Do not ask them to paste it into chat.`);
    return true;
  }

  async function secretCard(req, res, botId, messageId, action) { // S: index.ts:12156-12229
    if (action === "provide") return json(res, 403, { error: "Secure phone entry must come from a paired phone" }); // :12158-12160 — the desktop never uses this route
    const body = await readBody(req) ?? {};
    const threadId = String(body.threadId ?? "");
    const message = cardMessage(botId, threadId, messageId, "secret");
    if (!message) return json(res, 404, { error: "no such credential request" });
    if (state.phoneSaving.has(messageId)) return json(res, 409, { error: "this credential is currently being saved from a phone" }); // :12191-12195
    if (action === "provided") {
      if (message.secret.dismissed) return json(res, 409, { error: "this credential request was dismissed" }); // :12197
      if (!credentialIsConfigured(message.secret.target)) return json(res, 409, { error: `${message.secret.label} was not saved yet` }); // :12198-12200
      resumeSecretCard(botId, threadId, message, "provided");
      return json(res, 200, { provided: true, resumed: message.secret.resumed === true });
    }
    if (action === "resume") {
      const provided = message.secret.provided === true; const dismissed = message.secret.dismissed === true;
      if (provided === dismissed) return json(res, 409, { error: "this credential request is not ready to resume" }); // :12210-12212
      if (provided && !credentialIsConfigured(message.secret.target)) return json(res, 409, { error: `${message.secret.label} is no longer configured` }); // :12213-12215
      resumeSecretCard(botId, threadId, message, provided ? "provided" : "dismissed");
      return json(res, 200, { resumed: message.secret.resumed === true });
    }
    if (!message.secret.provided) resumeSecretCard(botId, threadId, message, "dismissed"); // :12223
    return json(res, 200, { dismissed: true, resumed: message.secret.resumed === true });
  }

  /** Configured-or-not booleans, never a value (S: index.ts:7125-7157). */
  const configStatus = () => ({
    xai: { configured: state.config.xai === true }, box: { configured: state.config.box === true },
    opencodeGo: { configured: state.config.opencodeGo === true },
    // Native voice readiness is not a credential boolean (S: tts/index.ts:28-36,57-63).
    tts: { configured: state.voiceProvider?.provider === "system" ? state.voiceProvider.available : state.config.tts === true, ...(state.voiceProvider ? { provider: state.voiceProvider.provider } : {}) },
    imageGen: { configured: state.config.imageGen === true },
    features: { skillRecorder: state.config.skillRecorder === true },
  });
  async function putConfig(req, res) { // S: index.ts:11675-11679, 11962-11968
    const body = await readBody(req);
    // Model the driver's config subset with the same optional field types,
    // stripping unknown fields as the object schemas do (S: config.ts:14,
    // 234-267,395-400; schema.ts:14-18).
    const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
    const invalid = (field, type, value) => json(res, 400, { error: `${field ? `${field} ` : ""}Invalid input: expected ${type}, received ${value === null ? "null" : Array.isArray(value) ? "array" : typeof value}` });
    if (!object(body)) return invalid("", "object", body);
    const sections = [];
    const saved = [];
    for (const spec of Object.values(CREDENTIAL_TARGETS)) {
      if (body[spec.section] === undefined) continue;
      if (!object(body[spec.section])) return invalid(spec.section, "object", body[spec.section]);
      sections.push(spec.section);
      const value = body[spec.section]?.[spec.field];
      if (value === undefined) continue;
      // S: config.ts:14,234-252,395-400; schema.ts:14-18. Empty strings
      // clear credentials; the optional string schema has no minimum length.
      if (typeof value !== "string") return invalid(`${spec.section}.${spec.field}`, "string", value);
      saved.push(spec.section);
    }
    const recorder = body.features?.skillRecorder;
    if (body.features !== undefined) {
      if (!object(body.features)) return invalid("features", "object", body.features);
      if (recorder !== undefined && typeof recorder !== "boolean") return invalid("features.skillRecorder", "boolean", recorder);
      sections.push("features");
    }
    if (!sections.length) return json(res, 400, { error: "nothing to save" }); // S: index.ts:11678
    if (state.providerBusy) return json(res, 409, { error: "provider settings are already being updated" }); // :11679
    // Fault injection for provider-supplied error text. Real voice validation
    // returns it as a 400 (S: index.ts:11899-11903; tts/elevenlabs.ts:42-55,66-75).
    // Keep only the flag/status in fixture state, never the echoed value.
    if (state.configPutError) {
      const status = state.configPutError; state.configPutError = null;
      return json(res, status, { error: `checking that key failed: provider rejected ${body.tts?.key?.trim()}` });
    }
    if (state.configPutFails > 0) { state.configPutFails--; res.destroy(); return; }
    // Only the fact that something was saved is kept: a fixture that stored
    // the value could leak it through /__fake/state or a test's assertion.
    for (const spec of Object.values(CREDENTIAL_TARGETS)) if (saved.includes(spec.section)) state.config[spec.section] = Boolean(spec.section === "box" ? body[spec.section][spec.field].trim() : body[spec.section][spec.field]); // S: index.ts:11715,7125-7140
    if (typeof recorder === "boolean") state.config.skillRecorder = recorder;
    // A section outside the excluded list rebuilds the whole provider fleet
    // (S: index.ts:12003-12018), which kills every in-flight turn and settles
    // the bot it belonged to (S: :7188-7207).
    if (sections.some((section) => !CONFIG_NO_RELOAD.has(section))) {
      state.providerReloads++;
      for (const bot of state.bots.filter((b) => BUSY.has(b.activity))) {
        appendMessage(bot.threadId, { role: "bot", kind: "activity", tool: { name: "error: turn interrupted — provider settings changed", ok: false } });
        bot.activity = "idle"; broadcast({ kind: "bot", bot: publicBot(bot) });
      }
    }
    if (state.configPutHangs > 0) { state.configPutHangs--; res.dropped = true; }
    return json(res, 200, configStatus());
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
      // `config` is deliberately absent: what a credential PUT leaves behind
      // is a boolean, and no test should be able to read a value from here.
      return json(res, 200, { environmentId, bots: state.bots.map((b) => ({ ...publicBot(b), key: b.key })), groups: state.groups.map(publicGroup), receipts: state.receipts, decisions: state.decisions, queue: state.queue ?? [], lastSeq, streamId: STREAM_ID, threads: Object.fromEntries(state.threads), routines: state.routines, wakes: state.wakes, providerReloads: state.providerReloads, skills: [...state.skills.keys()] });
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
      case "pinnedTurn": { // S: index.ts:3225-3233 (a held wake starts on its own thread), 3925-3937 (busy flips; the active task is untouched)
        if (!bot) throw Object.assign(new Error("no such bot"), { status: 404 });
        const working = op.working !== false;
        bot.activity = working ? "working" : "idle";
        bot.turnThreadId = working ? (op.threadId ?? bot.threadId) : null;
        broadcast({ kind: "bot", bot: publicBot(bot) });
        return { turnThreadId: bot.turnThreadId };
      }
      case "delegated": // S: delegations.ts:302-313 — settled at birth, so ok is true and the chip is never patched
        return { message: appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: `Delegated to @${op.name}${op.reason ? `: ${op.reason}` : ""}`, ok: true } }) };
      case "askConverted": // S: index.ts:7912-7916 — an ask that timed out on a busy peer becomes a delegation
        return { message: appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: `@${op.name} is still working — ask converted to a delegation` } }) };
      case "delegationDone": { // the chips that settle a queued delegation
        const n = op.count ?? 1;
        const terminal = {
          empty: { name: `Delegation to @${op.name} completed without a text reply`, ok: true }, // S: index.ts:3396-3400
          failed: { name: `Delegation to @${op.name} failed — ${op.reason ?? "the delegated turn did not finish"}`, ok: false }, // S: index.ts:3398
          busy: { name: `Delegation to @${op.name} waiting — they're busy (retry ${op.attempt ?? 1}/3 when they finish)` }, // S: delegations.ts:486-493 — a retry, not a settlement
          canceled: { name: `Delegation to @${op.name} canceled — still busy after 3 retries`, ok: false }, // S: delegations.ts:503-507
          denied: { name: `Delegation to @${op.name} denied by user`, ok: false }, // S: delegations.ts:532-536
          dropped: { name: `${n} queued delegation${n > 1 ? "s" : ""} dropped — the turn did not finish`, ok: false }, // S: delegations.ts:438-442
        }[op.variant ?? "empty"];
        if (!terminal) throw Object.assign(new Error(`unknown delegationDone variant ${op.variant}`), { status: 400 });
        return { message: appendMessage(threadId, { role: "bot", kind: "activity", tool: terminal }) };
      }
      case "errorActivity": return { message: appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: `error: ${op.text ?? "the provider refused the turn"}`, ok: false } }) };
      case "card": { // S: index.ts:2917-2945, 2881-2896, 6420-6430; store.ts:63-66.
        const kind = op.kind ?? "approval";
        const card = { title: kind === "question" ? "Your bot has a question" : "Approval needed", subtitle: op.text ?? "May I contact Quill?", options: kind === "question" ? (op.choices ?? []) : ["Allow", "Deny"], requestId: op.requestId ?? newId(), answered: false, dismissed: false, dead: op.dead === true };
        if (kind === "approval") Object.assign(card, { tool: op.tool ?? "ask_bot", ...(op.held !== undefined ? { held: op.held } : {}), ...(op.approvalScope ? { approvalScope: op.approvalScope } : {}), ...(op.allowKey ? { allowKey: op.allowKey } : {}) });
        const owner = state.bots.find((b) => b.tasks.some((t) => t.threadId === threadId));
        if (kind === "skill") {
          // S: index.ts:6372-6431 — the copy, the options, and the durable
          // payload; the hash covers the SKILL.md preview (S: skills.ts:1250).
          const name = op.name ?? "example";
          const action = op.action ?? "create";
          const gist = op.gist ?? op.text ?? "Example";
          const warnings = op.warnings ?? [];
          const preview = op.preview ?? `# ${name}\nA fixture proposal.\n`;
          card.title = action === "create" ? `Enable skill "${name}"?` : `Update skill "${name}"?`;
          card.subtitle = `${gist || name}${warnings.length ? `\n\nWarnings:\n- ${warnings.join("\n- ")}` : ""}`;
          card.options = [action === "create" ? "Enable" : "Update", "Deny"];
          card.tool = "stage_skill";
          card.skillRequest = {
            version: 1, requestId: card.requestId, botId: owner?.id, threadId, stagedId: newId(), action, name, gist,
            source: op.source ?? `learned:${name}`,
            // A preview that no longer hashes to its sha256 is the card the
            // server refuses with 422 (S: index.ts:6520-6523); a card with no
            // preview at all is one an older build persisted (S: :6506-6512).
            ...(op.olderBuild ? {} : { preview: op.stalePreview ? `${preview}an edit after review\n` : preview }),
            sha256: createHash("sha256").update(preview).digest("hex"), warnings, createdAt: now(),
            ...(op.stagedGone ? { stagedGone: true } : {}),
          };
        }
        if (kind === "routine") {
          // Valid stored proposal and card shape (S: routine-requests.ts:119-157, 515-583, 742-752).
          const action = op.action ?? "create";
          const name = op.name ?? "Example";
          const copy = ROUTINE_ACTION_COPY[action];
          const forSuffix = op.forBot ? ` for @${op.forBot}` : "";
          const schedule = op.pastOnce ? { type: "once", at: now() - 60_000 } : op.schedule ?? { type: "interval", everyMinutes: 60 };
          const operation = action === "create"
            ? { action, routine: { name, instructions: op.instructions ?? "A fixture proposal.", schedule, runOn: "maus", durationMinutes: 5 }, ...(op.forBot ? { forBot: { botId: op.forBotId ?? newId(), name: op.forBot } } : {}) }
            : { action, routineId: op.routineId ?? newId(), expectedUpdatedAt: op.expectedUpdatedAt ?? 0, ...(action === "update" ? { changes: op.changes ?? { name } } : {}) };
          card.tool = action === "create" ? "schedule_routine" : "manage_routine"; // S: routine-requests.ts:581,534
          card.options = ["Confirm", "Cancel"];
          card.title = `${copy.title} “${name}”${forSuffix}?`;
          card.subtitle = [`Action: ${copy.detail}`, `Name: ${name}`, `Schedule: ${scheduleText(schedule)}`, "Runs on: This OpenMausBot setup", "", "Instructions:", op.instructions ?? "A fixture proposal."].join("\n");
          card.routineRequest = { version: 1, requestId: card.requestId, botId: owner?.id, threadId, createdAt: now(), operation };
        }
        return { message: appendMessage(threadId, { role: "bot", kind: "options", card }) };
      }
      case "connector": { // S: index.ts:8336-8399 — one card per requested app, all sharing one resume key
        const resumeKey = op.resumeKey ?? `resume-${newId()}`;
        const items = op.items ?? [{ slug: op.slug ?? "slack", label: op.label ?? "Slack", alias: op.alias }];
        const messages = items.map((item) => appendMessage(threadId, {
          role: "bot", kind: "connector",
          connector: {
            slug: item.slug, label: item.label ?? item.slug,
            description: item.alias ? `Connect ${item.label ?? item.slug} as “${item.alias}” so the bot can continue` : item.description ?? `Connect ${item.label ?? item.slug} so the bot can continue`,
            status: item.status ?? "required", resumeKey, ...(item.alias ? { alias: item.alias } : {}),
          },
        }));
        return { resumeKey, messages, messageIds: messages.map((m) => m.id) };
      }
      // What the provider says about an account. It reaches the card only
      // through the status read (S: index.ts:12255-12276), never on its own.
      case "connectorAccount": state.accounts.set(op.messageId, op.status ?? "ACTIVE"); return;
      case "secret": { // S: index.ts:8262-8277 — the allowlisted target, its copy, and the handoff text
        const target = op.target ?? "xaiApiKey";
        const spec = CREDENTIAL_TARGETS[target];
        if (!spec) throw Object.assign(new Error("unsupported credential id"), { status: 400 });
        const reason = typeof op.reason === "string" ? op.reason.trim().slice(0, 240) : "";
        return { message: appendMessage(threadId, {
          role: "bot", kind: "secret", text: credentialDesktopHandoff(spec.label),
          secret: { target, label: spec.label, description: reason ? `${spec.description} ${reason}` : spec.description, placeholder: spec.placeholder, helpUrl: spec.helpUrl, requestKey: newId() },
        }) };
      }
      // The wake after a saved credential can fail on its own; the card then
      // keeps the error, provided but unresumed. S: index.ts:6767-6773.
      case "secretResumeFailed": {
        for (const list of state.threads.values()) {
          const message = list.find((m) => m.id === op.messageId && m.kind === "secret");
          if (!message) continue;
          message.secret = { ...message.secret, provided: op.outcome !== "dismissed", dismissed: op.outcome === "dismissed", resumed: false, error: String(op.error ?? "the turn could not be started").slice(0, 180) };
          return { secret: message.secret };
        }
        throw Object.assign(new Error("no such credential request"), { status: 404 });
      }
      case "providerBusy": state.providerBusy = op.busy !== false; return; // S: index.ts:11679
      // A config write whose answer is lost after the value was persisted, and
      // one that dies before it. The config is durable before the provider
      // reload that can outlast the request (S: index.ts:12015-12042), so the
      // two are indistinguishable to the client and must not be guessed.
      case "configPutHangs": state.configPutHangs = op.count ?? 1; return;
      case "configPutFailsBeforeSaving": state.configPutFails = op.count ?? 1; return;
      case "configPutError": state.configPutError = op.status ?? 400; return;
      case "voiceProvider": state.voiceProvider = { provider: op.provider, available: op.available === true }; return;
      case "phoneSaving": { // S: index.ts:12191-12195
        if (op.saving === false) state.phoneSaving.delete(op.messageId); else state.phoneSaving.add(op.messageId);
        return;
      }
      case "receipt": return { receipt: recordReceipt(op) };
      case "notify": { const b = botById(op.botId); if (b && b.notifications === false) return { suppressed: true }; broadcast({ kind: "notify", notification: { kind: op.kind, botId: op.botId, botName: b?.name ?? "", threadId: op.threadId ?? b?.threadId, title: op.title ?? op.kind, body: op.body ?? "" } }); return; }
      case "notifications": { if (!bot) throw Object.assign(new Error("no such bot"), { status: 404 }); bot.notifications = op.enabled !== false; return; }
      case "queued": state.pendingDelegations.push({ sourceBotId: op.sourceBotId, targetBotId: op.targetBotId, reason: op.reason }); return;
      case "running": state.running.push({ sourceBotId: op.sourceBotId, targetBotId: op.targetBotId, threadId: op.threadId ?? newId(), groupId: op.groupId }); return;
      case "clearDelegations": state.pendingDelegations = []; state.running = []; return;
      case "delay": state.delay = { count: op.count ?? 1, ms: op.ms ?? 1000 }; return;
      case "dropNext": state.dropNext = op.count ?? 1; return;
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
      case "pairing": { const opened = openPairing({ label: op.label, scopes: op.scopes }); return { pairing: { id: opened.id, code: formatPairingCode(opened.code), expiresAt: opened.expiresAt } }; }
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
  // The address to listen on. A test that binds another loopback address
  // (127.0.0.2) is a caller whose Host header is not loopback, which is how
  // a request through a tunnel reaches the real server.
  const host = opts.host ?? "127.0.0.1";
  await new Promise((resolve) => server.listen(opts.port ?? 0, host, resolve));
  const port = server.address().port;
  const url = `http://${host}:${port}`;
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
