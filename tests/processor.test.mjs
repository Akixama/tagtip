import test from "node:test";
import assert from "node:assert/strict";
import { createXProcessor } from "../src/x-processor.js";

function fixture({ maxCalls = 10, pages, status = 200 } = {}) {
  let saved, time = 1_000_000, callCount = 0;
  const applied = [];
  const store = { load: async () => saved && structuredClone(saved), save: async state => { saved = structuredClone(state); } };
  const worker = createXProcessor({ token: "secret", botId: "99", botHandle: "TippOnSol", initialSinceId: "100", enabled: true, store,
    maxCalls, now: () => time,
    fetcher: async rawUrl => {
      callCount++;
      const url = new URL(rawUrl);
      return { ok: status === 200, status, headers: { get: () => "1060" }, json: async () => url.pathname.includes("/mentions") ?
        (pages ? pages[Number(url.searchParams.get("pagination_token") || 0)] : { data: [
          { id: "103", author_id: "1", text: "@TippOnSol send $2 to @bob" },
          { id: "102", author_id: "1", text: "just saying hi" },
          { id: "101", author_id: "1", text: "@TippOnSol send $1 to @bob" },
        ], meta: {} }) : { data: { id: "2", username: "bob" } } };
    }, applyEvent: async event => { applied.push(event); return { status: "accepted", tipId: `tip-${event.tweetId}` }; },
  });
  return { worker, applied, state: () => saved, calls: () => callCount, advance: () => { time += 61_000; } };
}
test("processor normalizes the configured bot and applies commands oldest first", async () => {
  const f = fixture();
  const result = await f.worker.run();
  assert.deepEqual(f.applied.map(event => event.tweetId), ["101", "103"]);
  assert.equal(f.applied[0].recipientId, "2");
  assert.equal(result.sinceId, "103");
  assert.equal(result.realFundsEnabled, false);
  assert.equal((await f.worker.run()).deferred, true);
});
test("processor retains per-command progress when X request budget is exhausted", async () => {
  const f = fixture({ maxCalls: 2 });
  await assert.rejects(f.worker.run(), /budget/);
  assert.deepEqual(f.applied.map(event => event.tweetId), ["101"]);
  assert.equal(f.state().sinceId, "100");
  f.advance();
  await f.worker.run();
  assert.deepEqual(f.applied.map(event => event.tweetId), ["101", "103"]);
  assert.equal(f.state().sinceId, "103");
});
test("X 429 pauses processing without advancing the cursor", async () => {
  const f = fixture({ status: 429 });
  await assert.rejects(f.worker.run(), /rate limit/);
  assert.equal(f.state().sinceId, "100");
  assert.equal(f.applied.length, 0);
  assert.equal((await f.worker.run()).deferred, true);
});
test("a too-large backlog does not apply a partial out-of-order batch", async () => {
  const f = fixture({ pages: Array.from({ length: 3 }, (_, index) => ({ data: [], meta: { next_token: String(index + 1) } })) });
  await assert.rejects(f.worker.run(), /backlog/);
  assert.equal(f.applied.length, 0);
});
test("processor fails closed without an explicit enabling flag", async () => {
  const worker = createXProcessor({ token: "secret", botId: "99", initialSinceId: "100" });
  assert.equal(worker.configured, false);
  await assert.rejects(worker.run(), /disabled/);
});
