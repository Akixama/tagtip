import test from "node:test";
import assert from "node:assert/strict";
import { createAccountLedger, usdcUnits, feeUnits } from "../src/accounts.js";
import { testWallet } from "./helpers/wallet.js";

const identity = (id, username) => ({ id, username });
function fixture() {
  let time = Date.parse("2026-10-04T10:00:00Z");
  const ledger = createAccountLedger(null, () => time);
  ledger.touch(identity("1", "alice")); ledger.touch(identity("2", "bob")); ledger.fund("1");
  const send = (extra = {}) => ledger.send({ senderId: "1", recipientId: "2", recipientHandle: "bob", amount: "5", eventId: "event-1", ...extra });
  return { ledger, send, advance: days => { time += days * 86_400_000; } };
}
test("USDC conversion is exact and validates input", () => {
  assert.equal(usdcUnits("0.000001"), 1);
  assert.equal(usdcUnits("5.03"), 5_030_000);
  for (const value of [0, "0", "-1", "1e3", "NaN", "0.0000001"]) assert.throws(() => usdcUnits(value));
  assert.equal(feeUnits(3_000_000), 20_000);
  assert.equal(feeUnits(50_000_000_000), 1_000_000);
});
test("account balances, recipients and journal are isolated", () => {
  const { ledger, send } = fixture();
  const { tip } = send();
  assert.equal(ledger.snapshot("1").availableUnits, 19_970_000);
  assert.equal(ledger.snapshot("2").availableUnits, 0);
  assert.throws(() => ledger.claim(tip.id, "1"), /does not belong/);
  ledger.claim(tip.id, "2"); ledger.claim(tip.id, "2");
  assert.equal(ledger.snapshot("2").availableUnits, 5_000_000);
  assert.equal(ledger.reconcile().totalUnits, 0);
});
test("unknown recipients can register later with their stable X ID", () => {
  const { ledger, send } = fixture();
  const { tip } = send({ recipientId: "3", recipientHandle: "new_user" });
  ledger.touch(identity("3", "renamed_user"));
  ledger.claim(tip.id, "3");
  assert.equal(ledger.snapshot("3").availableUnits, 5_000_000);
});
test("funding and processor events cannot double charge", () => {
  const { ledger, send } = fixture();
  assert.throws(() => ledger.fund("1"), /already/);
  send(); assert.equal(send().duplicate, true);
  assert.throws(() => send({ amount: "4" }), /different command/);
  assert.equal(ledger.snapshot("1").availableUnits, 19_970_000);
});
test("special object-property names remain idempotent", () => {
  const { ledger, send } = fixture();
  send({ eventId: "__proto__" });
  assert.equal(send({ eventId: "__proto__" }).duplicate, true);
  assert.equal(ledger.snapshot("1").availableUnits, 19_970_000);
});
test("expiry refunds amount and fee once and blocks a late claim", () => {
  const { ledger, send, advance } = fixture();
  const { tip } = send(); advance(7);
  assert.throws(() => ledger.claim(tip.id, "2"), /no longer/);
  ledger.expire();
  assert.equal(ledger.snapshot("1").availableUnits, 25_000_000);
  assert.equal(ledger.snapshot("1").account.spentUnits, 0);
  assert.equal(ledger.reconcile().totalUnits, 0);
});
test("pause, limits, self-tips and overdrafts are blocked", () => {
  const { ledger, send } = fixture();
  ledger.policy("1", "2", "4", false);
  assert.throws(() => send(), /Per-tip/);
  send({ amount: "2" }); send({ amount: "2", eventId: "event-2" });
  assert.throws(() => send({ amount: "1", eventId: "event-3" }), /Daily/);
  ledger.policy("1", "10", "25", true);
  assert.throws(() => send({ eventId: "event-4" }), /paused/);
  assert.throws(() => send({ recipientId: "1" }), /yourself/);
});
test("withdrawals reserve money, are idempotent, and cancel safely", () => {
  const { ledger } = fixture();
  const proof = testWallet(), wallet = proof.address;
  const challenge = ledger.walletChallenge("1", wallet, "https://tagtip.example");
  ledger.verifyWallet("1", proof.sign(challenge.message));
  const first = ledger.withdraw("1", "20", wallet, "request-1");
  assert.equal(ledger.withdraw("1", "20", wallet, "request-1").id, first.id);
  assert.throws(() => ledger.withdraw("1", "6", wallet, "request-2"), /Insufficient/);
  assert.throws(() => ledger.cancelWithdrawal(first.id, "2"));
  ledger.cancelWithdrawal(first.id, "1");
  assert.equal(ledger.snapshot("1").availableUnits, 25_000_000);
  assert.throws(() => ledger.cancelWithdrawal(first.id, "1"));
  assert.equal(ledger.reconcile().totalUnits, 0);
});
test("reconciliation catches corrupted balances", () => {
  const { ledger } = fixture();
  const seed = ledger.export(); seed.balances["user:1"]++;
  assert.throws(() => createAccountLedger(seed).reconcile(), /reconciliation/);
});
test("reconciliation checks reservations even when the journal remains balanced", () => {
  const { ledger, send } = fixture();
  const { tip } = send();
  const seed = ledger.export();
  seed.tips[tip.id].status = "credited";
  assert.throws(() => createAccountLedger(seed).reconcile(), /reservation/);
  const unsafe = ledger.export();
  unsafe.journal[0].entries[0].units = NaN;
  assert.throws(() => createAccountLedger(unsafe).reconcile(), /Invalid journal/);
});
test("finalized devnet deposits credit a separate balance once", () => {
  const { ledger } = fixture();
  const proof = testWallet();
  const challenge = ledger.walletChallenge("1", proof.address, "https://tagtip.example");
  ledger.verifyWallet("1", proof.sign(challenge.message));
  const evidence = { ok: true, cluster: "devnet", commitment: "finalized", ledgerCredited: false, realFundsEnabled: false,
    signature: "3".repeat(88), amountUnits: 7_000_000, depositorWallet: proof.address, mint: "mint", slot: 42 };
  assert.equal(ledger.creditDevnetDeposit("1", evidence).duplicate, false);
  assert.equal(ledger.creditDevnetDeposit("1", evidence).duplicate, true);
  const snapshot = ledger.snapshot("1");
  assert.equal(snapshot.availableUnits, 25_000_000);
  assert.equal(snapshot.devnetAvailableUnits, 7_000_000);
  assert.equal(snapshot.devnetDeposits.length, 1);
  assert.equal(ledger.reconcile().ok, true);
  assert.throws(() => ledger.creditDevnetDeposit("2", evidence), /verified account wallet|another account/);
});
test("devnet withdrawals require recent wallet proof and remain cancellable before broadcast", () => {
  let clock = Date.now();
  const ledger = createAccountLedger(undefined, () => clock);
  ledger.touch({ id: "1", username: "alice" });
  const proof = testWallet(), challenge = ledger.walletChallenge("1", proof.address, "https://tagtip.example");
  ledger.verifyWallet("1", proof.sign(challenge.message));
  ledger.creditDevnetDeposit("1", { ok: true, cluster: "devnet", commitment: "finalized", ledgerCredited: false,
    realFundsEnabled: false, signature: "4".repeat(88), amountUnits: 7_000_000, depositorWallet: proof.address, mint: "mint", slot: 43 });
  const first = ledger.reserveDevnetWithdrawal("1", "2", proof.address, "devnet-withdraw-1");
  assert.equal(ledger.reserveDevnetWithdrawal("1", "2", proof.address, "devnet-withdraw-1").duplicate, true);
  assert.equal(ledger.snapshot("1").devnetAvailableUnits, 5_000_000);
  ledger.cancelDevnetWithdrawal(first.withdrawal.id, "1");
  assert.equal(ledger.snapshot("1").devnetAvailableUnits, 7_000_000);
  clock += 16 * 60_000;
  assert.throws(() => ledger.reserveDevnetWithdrawal("1", "1", proof.address, "devnet-withdraw-2"), /Verify the wallet again/);
  assert.equal(ledger.reconcile().ok, true);
});
