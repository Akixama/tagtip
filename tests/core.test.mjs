import test from "node:test";
import assert from "node:assert/strict";
import { calculateFee, evaluateTip, parseTipCommand } from "../src/core.js";

test("parses the supported tag-to-tip command", () => {
  assert.deepEqual(parseTipCommand("@TagTip send $5 to @mara"), {
    ok: true,
    amount: 5,
    recipient: "@mara",
  });
});

test("rejects ambiguous commands", () => {
  assert.equal(parseTipCommand("send mara something").ok, false);
});

test("caps the service fee at one dollar", () => {
  assert.equal(calculateFee(50_000), 1);
});

test("enforces the per-tip limit", () => {
  const result = evaluateTip({ amount: 15, budget: 25, active: true });
  assert.equal(result.ok, false);
  assert.match(result.reason, /per-tip limit/);
});

test("allows a policy-compliant test tip", () => {
  assert.deepEqual(evaluateTip({ amount: 5, budget: 25, active: true }), {
    ok: true,
    fee: 0.03,
    total: 5.03,
  });
});
