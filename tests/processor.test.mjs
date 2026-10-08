import test from "node:test";
import assert from "node:assert/strict";
import { createXProcessor } from "../src/x-processor.js";

function fixture({ maxCalls = 10, pages, status = 200 } = {}) {
  let saved, time = 1_000_000, callCount = 0;
  const applied = [];
  const store = { load: async () => saved && structuredClone(saved), save: async state => { saved = structuredClone(state); } };
  const worker = createXProcessor({ token: "secret", botId: "99", botHandle: "TippOnSol", initialSinceId: "100", enabled: true, store,
    appOrigin: "https://tagtip.example",
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
  assert.equal(f.state().replyOutbox["101"].replyToPostId, "101");
  assert.match(f.state().replyOutbox["101"].text, /@bob.*tagtip\.example/);
  assert.equal(Object.keys(f.state().replyOutbox).length, 2);
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
test("preview reads once without applying events, saving, or enabling processing", async () => {
  let reads = 0, writes = 0, applied = 0;
  const worker = createXProcessor({ token: "secret", botId: "99", botHandle: "TippOnSol", initialSinceId: "100",
    enabled: false, store: { load: async () => null, save: async () => { writes++; } },
    applyEvent: async () => { applied++; }, fetcher: async url => {
      reads++;
      assert.equal(new URL(url).searchParams.get("max_results"), "10");
      return { ok: true, json: async () => ({ data: [
        { id: "102", author_id: "1", text: "@TippOnSol send $2 to @bob" },
        { id: "101", author_id: "99", text: "@TippOnSol send $3 to @bob" },
      ], meta: { next_token: "more" } }) };
    },
  });
  assert.equal(worker.configured, false);
  assert.equal(worker.previewConfigured, true);
  const result = await worker.preview();
  assert.equal(reads, 1);
  assert.equal(writes, 0);
  assert.equal(applied, 0);
  assert.deepEqual(result.candidates, [{ postId: "102", senderId: "1", recipient: "@bob", amount: "2" }]);
  assert.equal(result.moreAvailable, true);
  assert.equal(result.stateChanged, false);
});
test("UTC start time excludes old mentions and becomes an ID checkpoint", async () => {
  let saved, clock = Date.parse("2026-10-08T11:05:00Z");
  const queries = [], applied = [];
  const worker = createXProcessor({ token: "secret", botId: "99", botHandle: "TippOnSol",
    initialStartTime: "2026-10-08T11:00:00Z", enabled: true,
    now: () => clock, store: { load: async () => saved && structuredClone(saved), save: async state => { saved = structuredClone(state); } },
    fetcher: async rawUrl => {
      const url = new URL(rawUrl);
      if (!url.pathname.includes("/mentions")) return { ok: true, json: async () => ({ data: { id: "2", username: "bob" } }) };
      queries.push(url.search);
      return { ok: true, json: async () => ({ data: [
        { id: "102", author_id: "1", created_at: "2026-10-08T11:01:00Z", text: "@TippOnSol send $2 to @bob" },
        { id: "101", author_id: "1", created_at: "2026-10-08T10:59:00Z", text: "@TippOnSol send $1 to @bob" },
      ], meta: {} }) };
    }, applyEvent: async event => { applied.push(event); return { status: "accepted", tipId: "tip-102" }; },
  });
  assert.equal(worker.previewConfigured, true);
  const preview = await worker.preview();
  assert.deepEqual(preview.candidates.map(item => item.postId), ["102"]);
  assert.equal(saved, undefined);
  assert.match(queries[0], /start_time=2026-10-08T11%3A00%3A00Z/);
  await worker.run();
  assert.deepEqual(applied.map(event => event.tweetId), ["102"]);
  assert.equal(saved.sinceId, "102");
  clock += 61_000;
  await worker.run();
  assert.match(queries.at(-1), /since_id=102/);
  assert.equal(applied.length, 1);
});
test("invalid UTC start time fails closed", async () => {
  const worker = createXProcessor({ token: "secret", botId: "99", initialStartTime: "2026-02-30T11:00:00Z" });
  assert.equal(worker.previewConfigured, false);
  await assert.rejects(worker.preview(), /not configured/);
});
