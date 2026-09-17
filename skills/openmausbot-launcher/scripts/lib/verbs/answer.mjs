// answer: the user's decision on whatever a bot is waiting for (design,
// "Answering"). One request, one mode, one call.
import { verb, EXIT, Fail, VERBS } from "../cli.mjs";
import { createClient } from "../http.mjs";
import { snapshot } from "../snapshot.mjs";
import { openRuns } from "../runs.mjs";
import { stateCommand, requireSameEnvironment } from "../session.mjs";
import { requireTeam, runFor, sendIdFor, deliverToLead } from "./run.mjs";

/** The flag that says what to do. Exactly one per call: a card takes one
 * decision, and two of them in one command would leave the second unexplained. */
const MODES = [
  ["allow", (f) => f.allow === true],
  ["deny", (f) => f.deny === true],
  ["answer", (f) => f.message !== undefined],
];
const modesIn = (flags) => MODES.filter(([, has]) => has(flags)).map(([name]) => name);

/** How a pending entry is named to the user and matched by `--request`. */
const handleOf = (p) => p.handle ?? p.requestId ?? p.messageId ?? p.kind;

verb("answer", {
  options: { allow: { type: "boolean" }, deny: { type: "boolean" }, message: { type: "string" }, request: { type: "string" }, run: { type: "string" } },
  allowPositionals: true,
  handler: stateCommand(async ({ flags, positionals, cfg }) => {
    const team = requireTeam(cfg);
    const client = createClient(cfg);
    await requireSameEnvironment(cfg, client);
    const bare = positionals.join(" ").trim();
    const modes = modesIn(flags);
    if (modes.length > 1) throw new Fail(EXIT.USAGE, "pass one of --allow, --deny, --message");
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
    if (target.kind !== "card") throw new Fail(EXIT.NEEDS_USER, `${target.botName} has a ${target.kind} request the driver cannot answer`, { hint: target.kind === "connector" ? "connect the app in OpenMausBot's UI (connector cards use /api/bots/:id/connector-cards)" : "provide the credential in OpenMausBot's UI (secret cards use /api/bots/:id/secret-cards)" });
    if (target.cardKind === "skill" || target.cardKind === "routine") throw new Fail(EXIT.NEEDS_USER, `${target.botName} has a ${target.cardKind} request the driver cannot answer`, { hint: target.cardKind === "skill" ? "review the learned skill in OpenMausBot's app; its response requires reviewedSha256 matching the displayed preview" : "review and resolve the routine proposal in OpenMausBot's app" });
    const behavior = modes[0];
    if (behavior === "answer" && target.cardKind && target.cardKind !== "question") throw new Fail(EXIT.USAGE, `request ${handleOf(target)} is an approval card: use --allow or --deny`);
    if (behavior !== "answer" && target.cardKind === "question") throw new Fail(EXIT.USAGE, `request ${handleOf(target)} is a question: use --message`);
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
