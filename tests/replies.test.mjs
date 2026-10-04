import test from "node:test";
import assert from "node:assert/strict";
import { createXReplySender } from "../src/x-replies.js";
const state = () => ({ replyOutbox: { "101": { id: "tip-receipt-101", replyToPostId: "101", status: "pending",
  text: "Tip ready at https://tagtip.example", createdAt: "2026-01-01T00:00:00.000Z" } } });
function store(seed = state()) { let value = structuredClone(seed); return { load: async () => structuredClone(value),
  save: async next => { value = structuredClone(next); }, value: () => value }; }
test("reply sender posts a pending receipt exactly once", async () => {
  const data = store(); let calls = 0;
  const sender = createXReplySender({ token: "x".repeat(20), enabled: true, store: data, now: () => 1,
    fetcher: async (url, options) => { calls++; const body = JSON.parse(options.body);
      assert.equal(body.reply.in_reply_to_tweet_id, "101"); return { ok: true, status: 201, json: async () => ({ data: { id: "900" } }) }; } });
  assert.equal((await sender.run()).results[0].status, "sent");
  assert.equal((await sender.run()).attempted, 0);
  assert.equal(calls, 1);
});
test("ambiguous reply outcomes are never automatically retried", async () => {
  const data = store(); let calls = 0;
  const sender = createXReplySender({ token: "x".repeat(20), enabled: true, store: data,
    fetcher: async () => { calls++; throw new Error("timeout"); } });
  assert.equal((await sender.run()).results[0].status, "unknown");
  assert.equal((await sender.run()).attempted, 0);
  assert.equal(calls, 1);
});
test("rate-limited replies remain pending until reset", async () => {
  const data = store(), sender = createXReplySender({ token: "x".repeat(20), enabled: true, store: data, now: () => 1_000,
    fetcher: async () => ({ ok: false, status: 429, headers: { get: () => "100" } }) });
  assert.equal((await sender.run()).results[0].status, "pending");
  assert.equal((await sender.run()).attempted, 0);
});
test("reply sender fails closed without explicit enablement", async () => {
  const sender = createXReplySender({ token: "x".repeat(20), store: store() });
  assert.equal(sender.configured, false);
  await assert.rejects(sender.run(), /disabled/);
});
test("an interrupted send becomes unknown instead of being retried", async () => {
  const seed = state(); seed.replyOutbox["101"].status = "sending"; seed.replyOutbox["101"].sendingAt = "2026-01-01T00:00:00.000Z";
  const data = store(seed), sender = createXReplySender({ token: "x".repeat(20), enabled: true, store: data,
    now: () => Date.parse("2026-01-01T00:11:00.000Z"), fetcher: async () => { throw new Error("must not call"); } });
  const result = await sender.run();
  assert.equal(result.recoveredUnknown, true);
  assert.equal(result.attempted, 0);
  assert.equal(data.value().replyOutbox["101"].status, "unknown");
});
