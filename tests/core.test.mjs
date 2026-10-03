import test from "node:test";
import assert from "node:assert/strict";
import { calculateFee, evaluateTip, parseTipCommand } from "../src/core.js";
import { createDemoLedger } from "../src/ledger.js";

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

test("moves one tip from sender creation to recipient claim", () => {
  const ledger = createDemoLedger();
  ledger.setup();
  ledger.setup();
  const created = ledger.createTip("@TagTip send $5 to @mara");

  assert.equal(created.ok, true);
  assert.equal(created.tip.status, "ready");
  assert.equal(ledger.verify(created.tip.id).tips[0].status, "verified");
  assert.equal(ledger.connectWallet(created.tip.id).tips[0].status, "wallet_connected");
  assert.equal(ledger.claim(created.tip.id).tips[0].status, "claimed");
});

test("rejects claiming a tip before verification and wallet selection", () => {
  const ledger = createDemoLedger();
  ledger.setup();
  ledger.setup();
  const created = ledger.createTip("@TagTip send $2 to @mara");
  assert.equal(ledger.claim(created.tip.id), null);
});

test("does not charge twice for the same X event", () => {
  const ledger = createDemoLedger();
  ledger.setup();
  ledger.setup();
  const first = ledger.createTip("@TagTip send $3 to @mara", { source: "x", sourceId: "tweet-42" });
  const second = ledger.createTip("@TagTip send $3 to @mara", { source: "x", sourceId: "tweet-42" });
  assert.equal(first.duplicate, undefined);
  assert.equal(second.duplicate, true);
  assert.equal(ledger.snapshot().tips.length, 1);
  assert.equal(ledger.snapshot().sender.budget, 21.99);
});

test("expires an unclaimed tip and returns its amount plus fee", () => {
  const ledger = createDemoLedger();
  ledger.setup();
  ledger.setup();
  const created = ledger.createTip("@TagTip send $5 to @mara");
  const future = new Date(created.tip.createdAt).getTime() + 8 * 24 * 60 * 60 * 1000;
  const result = ledger.expirePending(future);
  assert.equal(result.expired, 1);
  assert.equal(result.state.tips[0].status, "expired");
  assert.equal(result.state.sender.budget, 25);
});
