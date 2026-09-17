// answer: the user's decision on whatever a bot is waiting for (design,
// "Answering"). One request, one mode, one call.
import fs from "node:fs";
import { verb, EXIT, Fail, VERBS } from "../cli.mjs";
import { createClient, refused, HttpError } from "../http.mjs";
import { snapshot, BUSY } from "../snapshot.mjs";
import { openRuns } from "../runs.mjs";
import { stateCommand, requireSameEnvironment } from "../session.mjs";
import { requireTeam, runFor, sendIdFor, deliverToLead } from "./run.mjs";

/**
 * What to do, said once. `--confirm` and `--cancel` are the words a routine
 * card shows on its buttons and mean the server's `allow` and `deny`
 * (routine-requests.ts:748); two decisions in one command would leave the
 * second one unexplained, so more than one mode is a usage error.
 */
const MODES = [
  ["allow", (f) => f.allow === true || f.confirm === true],
  ["deny", (f) => f.deny === true || f.cancel === true],
  ["answer", (f) => f.message !== undefined],
  ["provide", (f) => f.provide === true],
  ["connect", (f) => f.connect === true],
  ["resume", (f) => f.resume === true],
  ["dismiss", (f) => f.dismiss === true],
];
const modesIn = (flags) => MODES.filter(([, has]) => has(flags)).map(([name]) => name);
const MODE_FLAGS = "--allow (--confirm), --deny (--cancel), --message, --provide, --connect, --resume, --dismiss";

/** Which modes each kind of request accepts, and what it is called when it refuses one. */
const KINDS = {
  question: { label: "a question", accepts: ["answer"], use: "--message" },
  approval: { label: "an approval card", accepts: ["allow", "deny"], use: "--allow or --deny" },
  routine: { label: "a routine confirmation", accepts: ["allow", "deny"], use: "--confirm or --cancel" },
  // A learned-skill card has no third answer: every behaviour other than allow
  // rejects the staged write (index.ts:6470-6504), so `--message` would throw
  // the skill away while reading like a comment.
  skill: { label: "a learned-skill card", accepts: ["allow", "deny"], use: "--allow --reviewed <sha256> or --deny; a message would reject the skill" },
  secret: { label: "a credential request", accepts: ["provide", "resume", "dismiss"], use: "--provide, --resume or --dismiss" },
  connector: { label: "a connection request", accepts: ["connect", "resume", "dismiss"], use: "--connect, --resume or --dismiss" },
};

/**
 * The two targets whose section is not on the server's no-reload list, so
 * saving one rebuilds the whole provider fleet (S: index.ts:12003-12014).
 * That kills every in-flight turn, fails its delegation watch and leaves an
 * `error: turn interrupted — provider settings changed` chip behind
 * (S: :7175-7207). `tts` and `imageGen` are excluded sections and are safe.
 */
const RESTARTS_PROVIDERS = new Set(["xaiApiKey", "opencodeGoApiKey"]);

/**
 * Where each credential id is stored. The id is the whole authority surface:
 * a bot names one of these five and never a config path
 * (S: shared/credential-request.ts:6-38, 52-65).
 */
const CREDENTIAL_PATCH = {
  xaiApiKey: (value) => ({ xai: { key: value } }),
  boxToken: (value) => ({ box: { token: value } }),
  opencodeGoApiKey: (value) => ({ opencodeGo: { apiKey: value } }),
  ttsKey: (value) => ({ tts: { key: value } }),
  openaiImageApiKey: (value) => ({ imageGen: { key: value } }),
};
/** The section each target reports under in `configStatus()` (S: index.ts:7125-7157). */
const CREDENTIAL_SECTION = { xaiApiKey: "xai", boxToken: "box", opencodeGoApiKey: "opencodeGo", ttsKey: "tts", openaiImageApiKey: "imageGen" };

/**
 * The value, from the environment or from stdin — never from argv, where a
 * process list would show it. It is read once and `OMB_SECRET` is removed from
 * this process's environment immediately, so nothing later in the run can pass
 * it on. Null means the user has not supplied one yet.
 */
function readSecretValue(flags) {
  const supplied = Object.hasOwn(process.env, "OMB_SECRET");
  const fromEnv = supplied ? process.env.OMB_SECRET : undefined;
  if (supplied) delete process.env.OMB_SECRET;
  const fromStdin = flags["secret-stdin"] === true;
  if (supplied && fromStdin) throw new Fail(EXIT.USAGE, "pass the value through OMB_SECRET or --secret-stdin, not both");
  if (!supplied && !fromStdin) return null;
  // One trailing newline is the shell's, not the credential's.
  const value = (fromStdin ? fs.readFileSync(0, "utf8") : fromEnv).replace(/\r?\n$/, "");
  if (!value) throw new Fail(EXIT.USAGE, fromStdin ? "--secret-stdin read an empty value" : "OMB_SECRET is empty");
  return value;
}

/** How a pending entry is named to the user and matched by `--request`. */
const handleOf = (p) => p.handle ?? p.requestId ?? p.messageId ?? p.kind;
/** The kind of request, whatever it arrived on. */
const kindOf = (p) => (p.kind === "card" ? p.cardKind : p.kind);

verb("answer", {
  options: {
    allow: { type: "boolean" }, deny: { type: "boolean" }, message: { type: "string" },
    confirm: { type: "boolean" }, cancel: { type: "boolean" }, reviewed: { type: "string" },
    provide: { type: "boolean" }, "secret-stdin": { type: "boolean" }, dismiss: { type: "boolean" },
    connect: { type: "boolean" }, resume: { type: "boolean" },
    request: { type: "string" }, run: { type: "string" },
  },
  allowPositionals: true,
  handler: stateCommand(async ({ flags, positionals, cfg }) => {
    const team = requireTeam(cfg);
    const client = createClient(cfg);
    await requireSameEnvironment(cfg, client);
    const bare = positionals.join(" ").trim();
    const modes = modesIn(flags);
    if (modes.length > 1) throw new Fail(EXIT.USAGE, `pass one of ${MODE_FLAGS}`);
    const task = runFor(cfg, flags);
    if (!modes.length) {
      if (!bare) throw new Fail(EXIT.USAGE, 'usage: answer <mode> [--request ID]  |  answer "<text>"', { hint: `modes: ${MODE_FLAGS}; a learned skill also needs --reviewed <sha256>, a credential --secret-stdin (or an OMB_SECRET the user exported themselves)` });
      const out = await VERBS.get("send").handler({ flags: { ...flags }, positionals: [bare], verb: "send" });
      return { result: { viaSend: true, ...out.result }, brief: out.brief };
    }
    const behavior = modes[0];
    const snap = await snapshot(client, { team, task, runs: openRuns(cfg.state), history: cfg.state?.history }, { dataDir: null });
    // A resume also reaches a connection that is already live and waiting only
    // for its bot to be told, which by then needs nothing from the user.
    const cards = [...snap.pending.filter((p) => p.kind !== "waiting"), ...(behavior === "resume" ? snap.resumable ?? [] : [])];
    let target;
    if (flags.request) { target = cards.find((p) => handleOf(p) === flags.request) ?? null; if (!target) throw new Fail(EXIT.PRECONDITION, `no pending request ${flags.request}`, { hint: cards.length ? `pending: ${cards.map((c) => `${handleOf(c)} (${c.botName})`).join(", ")}` : "nothing is pending; a plain question is answered with send" }); }
    else if (cards.length === 1) {
      target = cards[0];
      // A request no open run owns is answered on purpose, never by elimination.
      if (target.shared) throw new Fail(EXIT.PRECONDITION, `no open run owns request ${handleOf(target)} (${target.botName})`, { hint: `pass --request ${handleOf(target)} to answer it anyway` });
    }
    else if (cards.length === 0) throw new Fail(EXIT.PRECONDITION, "nothing is pending", { hint: 'a plain-text question is answered with send "…"' });
    else throw new Fail(EXIT.PRECONDITION, `${cards.length} requests are pending; pass --request`, { hint: cards.map((c) => `${handleOf(c)}: ${c.botName} ${c.text}`).join(" | ") });
    const kind = kindOf(target);
    const spec = KINDS[kind];
    // Every kind is checked against its own card before anything is posted: a
    // response the server would refuse costs a round trip, and on some kinds
    // the wrong one settles the card the wrong way.
    if (!spec) throw new Fail(EXIT.NEEDS_USER, `${target.botName} has a ${kind ?? target.kind} request the driver cannot answer`, { hint: "open OpenMausBot and settle it there" });
    if (flags.reviewed !== undefined && kind !== "skill") throw new Fail(EXIT.USAGE, "--reviewed belongs to a learned-skill card", { hint: `request ${handleOf(target)} is ${spec.label}` });
    if (!spec.accepts.includes(behavior)) throw new Fail(EXIT.USAGE, `request ${handleOf(target)} is ${spec.label}: use ${spec.use}`);
    if (kind === "routine") return routine(client, cfg, target, behavior);
    if (kind === "skill") return skill(client, cfg, target, behavior, flags.reviewed);
    if (kind === "secret") return secret(client, cfg, target, behavior, flags);
    if (kind === "connector") return connector(client, cfg, snap, target, behavior);
    if (cfg.dryRun) return { result: { dryRun: true, requestId: target.requestId, threadId: target.threadId, behavior } };
    const res = await client.post(`/api/threads/${target.threadId}/respond`, { requestId: target.requestId, behavior, ...(behavior === "answer" ? { message: flags.message } : {}) });
    const outcome = res.outcome ?? "unknown";
    let fellBackToSend = false; let sent = null;
    if (outcome === "unavailable") {
      if (behavior === "answer" && task && target.threadId === task.leadThreadId) {
        sent = await deliverToLead(client, { leadId: team.lead.id, run: task, otherRuns: openRuns(cfg.state).filter((x) => x.runId !== task.runId), text: flags.message, sendId: sendIdFor(task.runId, task.leadThreadId, flags.message) });
        fellBackToSend = true;
      } else {
        throw new Fail(EXIT.NEEDS_USER, `the card is no longer answerable (outcome unavailable); the ${behavior} did not happen`, { hint: "the request died with the bot's turn; tell the bot in chat what you decided with send, and it will ask again if it must" });
      }
    }
    return { result: { requestId: target.requestId, threadId: target.threadId, bot: target.botName, behavior, outcome, fellBackToSend, sent }, brief: `answer · ${target.botName} · ${behavior} → ${outcome}${fellBackToSend ? " (sent as chat instead)" : ""}` };
  }, { lockWhen: ({ flags }) => modesIn(flags).length > 0 }),
});

/**
 * A connection request. One agent call can ask for several apps at once and
 * they share a resume key: the bot is told to carry on only when every one of
 * them is connected and none was dismissed (`index.ts:6687-6697`), so each
 * mode reports the whole family, not just the card that was named.
 */
async function connector(client, cfg, snap, target, mode) {
  const own = target.connector ?? {};
  const route = (p, action, query = "") => `/api/bots/${p.botId}/connector-cards/${p.messageId}/${action}${query}`;
  const family = [...snap.pending, ...(snap.resumable ?? [])]
    .filter((p) => p.kind === "connector" && p.threadId === target.threadId && p.connector?.resumeKey === own.resumeKey)
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const listed = (p) => ({ messageId: p.messageId, slug: p.connector?.slug ?? null, label: p.connector?.label ?? null, alias: p.connector?.alias ?? null, status: p.connector?.status ?? null });
  const base = { messageId: target.messageId, threadId: target.threadId, bot: target.botName, kind: "connector", label: own.label ?? null, slug: own.slug ?? null, alias: own.alias ?? null };
  if (mode === "connect") {
    if (cfg.dryRun) return { result: { dryRun: true, ...base, action: "connect", siblings: family.map(listed) } };
    let res;
    try { res = await client.post(route(target, "authorize"), { threadId: target.threadId }); }
    catch (e) { throw refused(e, "nothing was authorized; the card keeps whatever status it had"); }
    // The link is returned to this caller and never written to the transcript
    // (index.ts:12231-12233): it is handed to the user now or not at all.
    return {
      code: EXIT.NEEDS_USER,
      result: { ...base, url: res.url ?? null, status: "authorizing", siblings: family.map(listed), hint: `the user opens this link once; then omb answer --resume --request ${target.messageId}` },
      brief: `answer · ${target.botName} · open once to connect ${base.label}: ${res.url}`,
    };
  }
  if (mode === "dismiss") {
    if (cfg.dryRun) return { result: { dryRun: true, ...base, action: "dismiss" } };
    let res;
    try { res = await client.post(route(target, "dismiss"), { threadId: target.threadId }); }
    catch (e) { throw refused(e, "the card was not dismissed; read the server's words"); }
    // Unlike a declined credential, a dismissed connection wakes nobody
    // (index.ts:12284-12287): the bot is still waiting for an answer.
    return { result: { ...base, dismissed: res.dismissed === true, woken: false, hint: `the bot is not woken; omb send "…" to tell it to continue without ${base.label}` }, brief: `answer · ${target.botName} · dismissed ${base.label} (the bot is not woken)` };
  }
  // That status read also WRITES: anything the provider does not report as
  // connected or failed is stored as `authorizing` (index.ts:12269-12274). So
  // reading a card nobody has authorized would move it out of `required`, the
  // brief would start asking for a resume, and its link would never be opened.
  const unopened = family.filter((p) => !["authorizing", "connected"].includes(p.connector?.status));
  if (unopened.length) {
    const name = (p) => `${p.connector?.label ?? p.connector?.slug}${p.connector?.alias ? ` (${p.connector.alias})` : ""}`;
    throw new Fail(EXIT.PRECONDITION, `${unopened.map(name).join(", ")} ${unopened.length > 1 ? "have" : "has"} not been authorized yet, and every app in one request resumes together`, {
      hint: unopened.map((p) => `connect each first: omb answer --connect --request ${p.messageId}`).join("; "),
    });
  }
  // The status read is what refreshes the stored card from the provider, and
  // it resumes the bot itself once the last one is live (index.ts:12255-12276).
  // A dry run therefore does not make it.
  if (cfg.dryRun) return { result: { dryRun: true, ...base, action: "resume", siblings: family.map(listed), note: "a status read refreshes the cards and can resume the bot, so it is not previewed" } };
  const siblings = [];
  for (const p of family) {
    try {
      const st = await client.get(route(p, "status", `?threadId=${encodeURIComponent(p.threadId)}`));
      siblings.push({ ...listed(p), connected: st.connected === true, pending: st.pending === true, status: st.status ?? null });
    } catch (e) { throw refused(e, `${p.connector?.label ?? p.messageId} could not be checked; nothing was resumed`); }
  }
  let resumed = true;
  if (family.some((p) => p.connector?.resumed !== true)) {
    try { resumed = (await client.post(route(target, "resume"), { threadId: target.threadId })).resumed === true; }
    catch (e) { throw refused(e, `every app in this request resumes together: ${siblings.filter((s) => !s.connected).map((s) => s.label).join(", ") || "one of them"} is not connected yet`); }
  }
  const mine = siblings.find((s) => s.messageId === target.messageId) ?? {};
  return {
    result: { ...base, connected: mine.connected === true, pending: mine.pending === true, status: mine.status ?? null, resumed, siblings },
    brief: `answer · ${target.botName} · ${base.label} ${mine.connected ? "connected" : mine.status ?? "not connected"}${resumed ? " · the bot was resumed" : ""}`,
  };
}

/**
 * A credential request. The card is a handoff, not a channel: the value never
 * travels through chat, so the driver writes it to the server's settings with
 * `PUT /api/config` and then tells the card it was saved. The server checks
 * that for itself before it resumes the bot (`index.ts:12198-12200`), which is
 * why the two steps are reported separately when the second one fails: the
 * credential is on the server either way.
 */
async function secret(client, cfg, target, mode, flags) {
  const card = target.secret ?? {};
  const label = card.label ?? card.target;
  const route = (action) => `/api/bots/${target.botId}/secret-cards/${target.messageId}/${action}`;
  const base = { messageId: target.messageId, threadId: target.threadId, bot: target.botName, kind: "secret", target: card.target ?? null, label };
  if (mode === "dismiss") {
    if (cfg.dryRun) return { result: { dryRun: true, ...base, action: "dismiss" } };
    let res;
    try { res = await client.post(route("dismiss"), { threadId: target.threadId }); }
    catch (e) { throw refused(e, "the card was not dismissed; read the server's words"); }
    // Declining is an answer: the bot is told to carry on without it
    // (index.ts:6781).
    return { result: { ...base, dismissed: res.dismissed === true, resumed: res.resumed === true, woken: true }, brief: `answer · ${target.botName} · declined the ${label}` };
  }
  if (mode === "resume") {
    // Neither route carries a value. `provided` only checks that the
    // credential is configured and then resumes, and resuming a card that is
    // already resumed is a no-op (`index.ts:12197-12206`, `:6838-6842`), so a
    // card that was saved but never woken is retried without asking the user
    // for the secret a second time. Once its own flag is set, only the wake is
    // left, and that is what `/resume` retries (`:12208-12222`).
    const settled = card.provided === true || card.dismissed === true;
    const action = settled ? "resume" : "provided";
    if (cfg.dryRun) return { result: { dryRun: true, ...base, action, would: [`POST ${route(action)}`] } };
    let res;
    try { res = await client.post(route(action), { threadId: target.threadId }); }
    catch (e) {
      throw refused(e, /was not saved yet/.test(e.body?.error ?? "")
        ? `the server has no value for this credential: ask the user for it and run answer --provide --secret-stdin --request ${target.messageId} < the file they wrote`
        : `the card was not resumed; answer --dismiss --request ${target.messageId} lets the bot continue without it`);
    }
    return {
      result: { ...base, provided: res.provided === true || card.provided === true, resumed: res.resumed === true, woken: true },
      brief: `answer · ${target.botName} · ${label} resumed`,
    };
  }
  const patch = CREDENTIAL_PATCH[card.target];
  if (!patch) throw new Fail(EXIT.NEEDS_USER, `the driver does not know where to store ${card.target}`, { hint: "provide it in OpenMausBot's app" });
  // Saving a Box token makes the server inventory the cloud computers that
  // account owns and refuse the whole write when it cannot (index.ts:11752-11790).
  // That is a conversation with a provider, not a settings write; it belongs
  // where the person can see what it did.
  if (card.target === "boxToken") throw new Fail(EXIT.PRECONDITION, "boxToken has cloud side effects; provide it in the app", { hint: `saving it makes the server list and verify the cloud computers on that account; open OpenMausBot and paste it there, then answer --provide is not needed — or answer --dismiss --request ${target.messageId} to let the bot continue without it` });
  // Saving one of the provider keys restarts the fleet and interrupts every
  // turn that is running anywhere on this server — not only this team's. That
  // is not a cost to discover afterwards, so it is checked before the value is
  // even read, and there is no flag to override it.
  const restarts = RESTARTS_PROVIDERS.has(card.target);
  const guard = restarts ? `saving the ${label} restarts every provider and interrupts the turns that are running` : null;
  let busy = [];
  if (restarts) {
    const fleet = await client.get("/api/bots?messages=0");
    busy = (fleet.bots ?? []).filter((b) => b.busy === true || BUSY.has(b.activity)).map((b) => b.name);
    if (busy.length) {
      throw new Fail(EXIT.PRECONDITION, `${busy.join(", ")} ${busy.length > 1 ? "are" : "is"} working, and ${guard}`, {
        hint: `save it when they are idle, or answer --dismiss --request ${target.messageId} to let the bot continue without it`,
      });
    }
  }
  // The preview names the two routes and stops: reading the value here would
  // put it in a dry run's output.
  if (cfg.dryRun) return { result: { dryRun: true, ...base, action: "provide", ...(restarts ? { guard, busy } : {}), would: ["PUT /api/config", `POST ${route("provided")}`] } };
  const value = readSecretValue(flags);
  // The hint must not be a command the value could be pasted into: whatever
  // an agent composes lands in its own transcript.
  if (value === null) throw new Fail(EXIT.NEEDS_USER, `ask the user for the ${label}`, { hint: `have them write it to a file only they can read (umask 077) and run: omb answer --provide --secret-stdin --request ${target.messageId} < that-file — or have them export OMB_SECRET in their own shell with 'read -rs OMB_SECRET && export OMB_SECRET' and run it there. Never put the value in a command, in chat or in your notes${card.helpUrl ? `; it comes from ${card.helpUrl}` : ""}` });
  // The write itself is durable before the provider reload the server runs
  // after it, and that reload can outlast an ordinary request
  // (index.ts:12015-12042), so this one call gets a longer budget and a lost
  // answer is never read as "nothing was written".
  let saveOutcome = "saved";
  try { await client.put("/api/config", patch(value), { timeoutMs: 60_000 }); }
  catch (e) {
    // A 4xx is the server refusing before it wrote anything.
    if (e instanceof HttpError && e.status >= 400 && e.status < 500) throw refused(e, `the ${label} was not saved and the card is untouched`);
    const said = e.body?.error ?? e.message;
    let status;
    try { status = await client.get("/api/config"); }
    catch {
      throw new Fail(EXIT.PRECONDITION, `it is unknown whether the ${label} was saved: ${said}`, {
        hint: `the server's settings could not be read back; omb answer --resume --request ${target.messageId} finishes the card if the value did land, and says so if it did not — do that before asking the user for it again`,
      });
    }
    if (status?.[CREDENTIAL_SECTION[card.target]]?.configured !== true) {
      throw new Fail(EXIT.PRECONDITION, `the ${label} was not saved: ${said}`, { status: e.status, hint: "the server's settings do not have it and the card is untouched; try again" });
    }
    saveOutcome = "verified";
  }
  try {
    const res = await client.post(route("provided"), { threadId: target.threadId });
    return { result: { ...base, saveOutcome, provided: res.provided === true, resumed: res.resumed === true, woken: true }, brief: `answer · ${target.botName} · ${label} saved, the card resumed` };
  } catch (e) {
    throw new Fail(EXIT.PRECONDITION, `the ${label} was saved, the card was not resumed: ${e.body?.error ?? e.message}`, {
      status: e.status,
      hint: `the value is stored on the server now; omb answer --resume --request ${target.messageId} resumes the card without the value, or answer --dismiss --request ${target.messageId} lets the bot continue without it`,
    });
  }
}

/**
 * A learned-skill card. The skill stays staged until this answer, and the
 * server installs it only against the hash the person says they reviewed
 * (index.ts:6513-6519), so `--reviewed` is the review itself: it is checked
 * against this card before anything is posted, because a hash from another
 * card would otherwise buy an allow for a skill nobody read.
 *
 * Whether the preview still hashes to that sha256 is the server's own check
 * (`:6520-6523`); it refuses before it applies anything, and its words name
 * the remedy. Nothing is installed by any refusal here.
 */
async function skill(client, cfg, target, behavior, reviewed) {
  const request = target.skillRequest ?? {};
  if (behavior === "allow") {
    if (reviewed === undefined) throw new Fail(EXIT.USAGE, "allowing a learned skill needs --reviewed <sha256>: the hash of the preview you read to the user", { hint: `this card's sha256 is ${request.sha256}; its preview is in pending[].skillRequest.preview` });
    if (!/^[0-9a-f]{64}$/.test(reviewed)) throw new Fail(EXIT.USAGE, "--reviewed must be 64 hex characters (a sha256)");
    if (reviewed !== request.sha256) throw new Fail(EXIT.USAGE, "--reviewed is not this card's sha256", { hint: `this card's sha256 is ${request.sha256}` });
  }
  const base = { requestId: target.requestId, threadId: target.threadId, bot: target.botName, cardKind: "skill", name: request.name ?? null, action: request.action ?? null, behavior };
  if (cfg.dryRun) return { result: { dryRun: true, ...base, ...(behavior === "allow" ? { reviewedSha256: reviewed } : {}) } };
  let res;
  try { res = await client.post(`/api/threads/${target.threadId}/respond`, { requestId: target.requestId, behavior, ...(behavior === "allow" ? { reviewedSha256: reviewed } : {}) }); }
  catch (e) {
    throw refused(e, behavior === "allow"
      ? "nothing was installed: deny this card and ask the bot to stage the skill again"
      : "the staged write was not cleaned up; read the server's words to the bot");
  }
  const outcome = res.outcome ?? "unknown";
  return {
    result: { ...base, outcome, ...(res.alreadySettled ? { alreadySettled: true } : {}) },
    brief: `answer · ${target.botName} · ${behavior} → ${outcome}`,
  };
}

/**
 * A routine confirmation. The card holds a proposal the bot wrote and the
 * scheduler has not run: confirming it revalidates the operation and applies
 * it in one step (routine-requests.ts:889-895), so a refusal there is the
 * server's own account of what changed under the card, written onto the card
 * as `held` (`:896-908`) for the bot to read when it proposes again.
 */
async function routine(client, cfg, target, behavior) {
  const action = target.routineRequest?.operation?.action ?? null;
  const base = { requestId: target.requestId, threadId: target.threadId, bot: target.botName, cardKind: "routine", title: target.title ?? null, behavior };
  if (cfg.dryRun) return { result: { dryRun: true, ...base, routineAction: action } };
  let res;
  try { res = await client.post(`/api/threads/${target.threadId}/respond`, { requestId: target.requestId, behavior }); }
  catch (e) { throw refused(e, "the card now carries held with this text; read it to the bot, or cancel the card and ask it to propose the action again"); }
  const outcome = res.outcome ?? "unknown";
  return {
    result: { ...base, outcome, ...(res.alreadySettled ? { alreadySettled: true } : {}), routineAction: res.routineAction ?? null, resultId: res.resultId ?? null },
    brief: `answer · ${target.botName} · ${behavior} → ${outcome}${res.routineAction ? ` (${res.routineAction} ${res.resultId})` : ""}`,
  };
}
