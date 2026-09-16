import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { startFake, makeRepo, runOmb, ROOT } from "./helpers.mjs";
import { statePaths, loadState, updateState } from "../skills/openmausbot-launcher/scripts/lib/state.mjs";

for (const scenario of ["foreign owner", "no owner", "two owners", "unresolved delegate", "incomplete observation"]) {
  test(`send refuses a shared specialist with ${scenario} unless the operator names its thread`, async (t) => {
    const f = await startFake(); t.after(() => f.close());
    const { dir } = makeRepo(); const paths = statePaths(dir);
    const env = { OMB_TOKEN: "", OMB_DATA_DIR: f.dataDir };
    const run = (args) => runOmb([...args, "--project", dir], { env });
    assert.equal((await run(["import", path.join(ROOT, "tests/fixtures/dev-team.package.json"), "--url", f.url])).code, 0);
    assert.equal((await run(["bind", "--default", "claude/claude-sonnet-5"])).code, 0);
    const a = await run(["task", "--todo", "T10"]);
    const b = await run(["task", "--todo", "T11", "--implementer", "Nova", "--share-implementer"]);
    assert.equal(a.code, 0, a.stdout); assert.equal(b.code, 0, b.stdout);
    const bot = loadState(paths).team.bots.find((x) => x.name === "Nova");
    const threadId = a.json.threads[bot.id];
    assert.equal(threadId, b.json.threads[bot.id]);
    const target = scenario === "foreign owner" ? "t11" : "t10";
    await updateState(paths, (doc) => {
      if (scenario !== "two owners") doc.runs[b.json.runId].implementer = null;
      if (scenario === "no owner") doc.runs[a.json.runId].implementer = null;
    });
    if (scenario === "incomplete observation") {
      const handlers = f.server.listeners("request");
      f.server.removeAllListeners("request");
      f.server.on("request", (req, res) => {
        if (req.url.startsWith(`/api/threads/${b.json.leadThreadId}/messages`)) {
          res.writeHead(503, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "injected unreadable sibling tail" }));
        } else for (const handler of handlers) handler(req, res);
      });
    }
    if (scenario === "unresolved delegate") await f.control({ op: "delegated", threadId: b.json.leadThreadId, name: "Former Name" });
    const before = await (await fetch(`${f.url}/api/threads/${threadId}/messages`)).json();
    const posts = [];
    f.server.on("request", (req) => { if (req.method === "POST" && req.url.endsWith("/messages")) posts.push(req.url); });
    for (const extra of [[], ["--dry-run"]]) {
      const denied = await run(["send", "steer selected run", "--run", target, "--bot", "Nova", ...extra]);
      assert.equal(denied.code, 3, denied.stdout);
      assert.match(denied.json.error, /shared|ownership.*incomplete/);
      assert.match(denied.json.hint, /--thread/);
    }
    assert.deepEqual(posts, [], "refusal and preview perform no send");
    assert.deepEqual(await (await fetch(`${f.url}/api/threads/${threadId}/messages`)).json(), before);
    const explicit = await run(["send", "operator names the destination", "--run", target, "--bot", "Nova", "--thread", threadId]);
    assert.equal(explicit.code, 0, explicit.stdout);
    assert.equal(explicit.json.threadId, threadId);
    assert.equal(posts.length, 1);
    if (scenario === "foreign owner") {
      const owned = await run(["send", "continue T10", "--run", "t10", "--bot", "Nova"]);
      assert.equal(owned.code, 0, owned.stdout);
      assert.equal(owned.json.threadId, threadId);
      await updateState(paths, (doc) => { doc.runs[a.json.runId].implementer = null; });
      await f.control({ op: "delegated", threadId: a.json.leadThreadId, name: "Nova" });
      const delegated = await run(["send", "continue delegated work", "--run", "t10", "--bot", "Nova"]);
      assert.equal(delegated.code, 0, delegated.stdout);
      assert.equal(posts.length, 3, "a sole implementer or delegate owner may send");
    }
  });
}
