// answer: the user's decision on whatever a bot is waiting for (design,
// "Answering"). One request, one mode, one call.
import { verb, EXIT, Fail, VERBS } from "../cli.mjs";
import { createClient, refused } from "../http.mjs";
import { snapshot } from "../snapshot.mjs";
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
];
const modesIn = (flags) => MODES.filter(([, has]) => has(flags)).map(([name]) => name);
const MODE_FLAGS = "--allow (--confirm), --deny (--cancel), --message";

/** Which modes each kind of request accepts, and what it is called when it refuses one. */
const KINDS = {
  question: { label: "a question", accepts: ["answer"], use: "--message" },
  approval: { label: "an approval card", accepts: ["allow", "deny"], use: "--allow or --deny" },
  routine: { label: "a routine confirmation", accepts: ["allow", "deny"], use: "--confirm or --cancel" },
  // A learned-skill card has no third answer: every behaviour other than allow
  // rejects the staged write (index.ts:6470-6504), so `--message` would throw
  // the skill away while reading like a comment.
  skill: { label: "a learned-skill card", accepts: ["allow", "deny"], use: "--allow --reviewed <sha256> or --deny; a message would reject the skill" },
};

/** How a pending entry is named to the user and matched by `--request`. */
const handleOf = (p) => p.handle ?? p.requestId ?? p.messageId ?? p.kind;
/** The kind of request, whatever it arrived on. */
const kindOf = (p) => (p.kind === "card" ? p.cardKind : p.kind);

verb("answer", {
  options: {
    allow: { type: "boolean" }, deny: { type: "boolean" }, message: { type: "string" },
    confirm: { type: "boolean" }, cancel: { type: "boolean" }, reviewed: { type: "string" },
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
      if (!bare) throw new Fail(EXIT.USAGE, 'usage: answer --allow|--deny|--message "<text>" [--request ID]  |  answer "<text>"');
      const out = await VERBS.get("send").handler({ flags: { ...flags }, positionals: [bare], verb: "send" });
      return { result: { viaSend: true, ...out.result }, brief: out.brief };
    }
    const snap = await snapshot(client, { team, task, runs: openRuns(cfg.state), history: cfg.state?.history }, { dataDir: null });
    const cards = snap.pending.filter((p) => p.kind !== "waiting");
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
    const behavior = modes[0];
    // Every kind is checked against its own card before anything is posted: a
    // response the server would refuse costs a round trip, and on some kinds
    // the wrong one settles the card the wrong way.
    if (!spec) {
      if (target.kind !== "card") throw new Fail(EXIT.NEEDS_USER, `${target.botName} has a ${target.kind} request the driver cannot answer`, { hint: target.kind === "connector" ? "connect the app in OpenMausBot's UI (connector cards use /api/bots/:id/connector-cards)" : "provide the credential in OpenMausBot's UI (secret cards use /api/bots/:id/secret-cards)" });
      throw new Fail(EXIT.NEEDS_USER, `${target.botName} has a ${kind} request the driver cannot answer`, { hint: "review the learned skill in OpenMausBot's app; its response requires reviewedSha256 matching the displayed preview" });
    }
    if (flags.reviewed !== undefined && kind !== "skill") throw new Fail(EXIT.USAGE, "--reviewed belongs to a learned-skill card", { hint: `request ${handleOf(target)} is ${spec.label}` });
    if (!spec.accepts.includes(behavior)) throw new Fail(EXIT.USAGE, `request ${handleOf(target)} is ${spec.label}: use ${spec.use}`);
    if (kind === "routine") return routine(client, cfg, target, behavior);
    if (kind === "skill") return skill(client, cfg, target, behavior, flags.reviewed);
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
