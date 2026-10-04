import test from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "../src/rate-limit.js";
test("rate limiter limits, resets, and bounds memory", () => {
  let now = 0;
  const limiter = createRateLimiter({ now: () => now, maxKeys: 2 });
  assert.equal(limiter.check("alice", 2).allowed, true);
  assert.equal(limiter.check("alice", 2).allowed, true);
  assert.equal(limiter.check("alice", 2).allowed, false);
  assert.equal(limiter.check("bob", 2).allowed, true);
  assert.equal(limiter.check("charlie", 2).allowed, false);
  now = 60_000;
  assert.equal(limiter.check("alice", 2).allowed, true);
  assert.equal(limiter.check("charlie", 2).allowed, true);
});
