import test from "node:test";
import assert from "node:assert/strict";
import { deliverToLead } from "../skills/openmausbot-launcher/scripts/lib/verbs/run.mjs";
import { HttpError } from "../skills/openmausbot-launcher/scripts/lib/http.mjs";
import { setImmediate as turn } from "node:timers/promises";

test("delivery preserves a child timeout before the outer clock reports expiry", async (t) => {
  t.mock.method(performance, "now", () => 0);
  const posts = [];
  let finishRead;
  const client = {
    async post(route) {
      posts.push(route);
      throw new HttpError("POST", route, 409, { error: "the bot switched tasks before it could receive the message" });
    },
    async get() {
      return new Promise((resolve) => { finishRead = resolve; });
    },
  };
  await assert.rejects(deliverToLead(client, {
    leadId: "lead", run: { leadThreadId: "la" }, otherRuns: [{ leadThreadId: "lb" }],
    text: "status?", sendId: "n", deadline: 15,
  }), /observation deadline reached/);
  assert.equal(typeof finishRead, "function", "the active-task read was pending when its timer expired");
  finishRead({ bots: [{ id: "lead", threadId: "lb" }] });
  await turn();
  assert.deepEqual(posts, ["/api/bots/lead/messages"], "the expired read cannot trigger a detached switch or retry");
});
