import test from "node:test";
import assert from "node:assert/strict";
import { createAccountLedger } from "../src/accounts.js";
import { decodeSolanaAddress, verifyWalletProof } from "../src/wallet-proof.js";
import { testWallet } from "./helpers/wallet.js";

test("Ed25519 wallet signatures reject other wallets and changed messages", () => {
  const wallet = testWallet(), other = testWallet(), message = "TagTip ownership proof";
  const signature = wallet.sign(message);
  assert.equal(decodeSolanaAddress(wallet.address).length, 32);
  assert.equal(verifyWalletProof(wallet.address, message, signature), true);
  assert.equal(verifyWalletProof(other.address, message, signature), false);
  assert.equal(verifyWalletProof(wallet.address, "changed", signature), false);
  assert.equal(verifyWalletProof(wallet.address, message, "bad"), false);
  assert.throws(() => decodeSolanaAddress("z".repeat(44)), /32 bytes/);
});
test("wallet verification is identity-bound, single-use and expires", () => {
  let time = Date.now();
  const ledger = createAccountLedger(null, () => time), wallet = testWallet();
  ledger.touch({ id: "1", username: "alice" }); ledger.touch({ id: "2", username: "bob" });
  const proof = ledger.walletChallenge("1", wallet.address, "https://tagtip.example");
  assert.match(proof.message, /https:\/\/tagtip.example/);
  assert.match(proof.message, /X user ID: 1/);
  const signature = wallet.sign(proof.message);
  assert.throws(() => ledger.verifyWallet("2", signature), /expired/);
  ledger.verifyWallet("1", signature);
  assert.equal(ledger.snapshot("1").account.verifiedWallet, wallet.address);
  assert.throws(() => ledger.verifyWallet("1", signature), /expired/);
  ledger.walletChallenge("1", wallet.address, "https://tagtip.example");
  time += 300_000;
  assert.throws(() => ledger.verifyWallet("1", signature), /expired/);
});
test("unverified destinations cannot reserve withdrawals", () => {
  const ledger = createAccountLedger();
  ledger.touch({ id: "1", username: "alice" }); ledger.fund("1");
  assert.throws(() => ledger.withdraw("1", "2", testWallet().address, "intent-1"), /Verify ownership/);
});
