import test from "node:test";
import assert from "node:assert/strict";
import { createDepositReceipts } from "../src/deposit-receipts.js";
const evidence = () => ({ ok: true, cluster: "devnet", commitment: "finalized", signature: "3".repeat(88),
  amountUnits: 5_000_000, ledgerCredited: false, realFundsEnabled: false });
test("deposit receipts survive restart and cannot be copied or counted twice", () => {
  const registry = createDepositReceipts();
  assert.equal(registry.record("1", evidence()).duplicate, false);
  const restarted = createDepositReceipts(registry.export());
  assert.equal(restarted.record("1", evidence()).duplicate, true);
  assert.throws(() => restarted.record("2", evidence()), /already belongs/);
  assert.throws(() => restarted.record("1", { ...evidence(), amountUnits: 6 }), /differs/);
  assert.equal(Object.keys(restarted.export()).length, 1);
});
test("receipt registry refuses real-money or unfinalized evidence", () => {
  const registry = createDepositReceipts();
  for (const change of [{ cluster: "mainnet" }, { commitment: "confirmed" }, { ledgerCredited: true },
    { realFundsEnabled: true }, { amountUnits: -1 }, { amountUnits: 0.5 }, { signature: "bad" }]) {
    assert.throws(() => registry.record("1", { ...evidence(), ...change }), /Invalid/);
  }
  assert.deepEqual(registry.export(), {});
});
