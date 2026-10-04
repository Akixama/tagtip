import test from "node:test";
import assert from "node:assert/strict";
import { createDevnetDepositVerifier, DEVNET_USDC_MINT, TOKEN_PROGRAM } from "../src/devnet-deposit.js";
import { testWallet } from "./helpers/wallet.js";
function fixture(change = () => {}, genesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1") {
  const depositor = testWallet().address, treasuryOwner = testWallet().address;
  const treasury = testWallet().address, source = testWallet().address, signature = "3".repeat(88);
  const token = (accountIndex, owner, amount) => ({ accountIndex, owner, mint: DEVNET_USDC_MINT, uiTokenAmount: { amount, decimals: 6 } });
  const tx = { slot: 123, meta: { err: null,
    preTokenBalances: [token(1, depositor, "10000000"), token(2, treasuryOwner, "0")],
    postTokenBalances: [token(1, depositor, "5000000"), token(2, treasuryOwner, "5000000")] },
    transaction: { signatures: [signature], message: { accountKeys: [{ pubkey: depositor, signer: true }, { pubkey: source }, { pubkey: treasury }],
      instructions: [{ programId: TOKEN_PROGRAM, parsed: { type: "transferChecked", info: { authority: depositor, source,
        destination: treasury, mint: DEVNET_USDC_MINT, tokenAmount: { amount: "5000000", decimals: 6 } } } }] } } };
  change(tx);
  const methods = [];
  const verifier = createDevnetDepositVerifier({ rpcUrl: "https://rpc.example", treasuryTokenAccount: treasury, treasuryOwner,
    fetcher: async (url, options) => { const call = JSON.parse(options.body); methods.push(call.method);
      if (call.method === "getTransaction") assert.equal(call.params[1].commitment, "finalized");
      return { ok: true, json: async () => ({ result: call.method === "getGenesisHash" ? genesis : tx }) };
    } });
  return { verifier, methods, input: { signature, depositorWallet: depositor } };
}
test("deposit evidence requires finalized devnet USDC and never credits money", async () => {
  const f = fixture(), receipt = await f.verifier.verify(f.input);
  assert.equal(receipt.amountUnits, 5_000_000);
  assert.equal(receipt.ledgerCredited, false);
  assert.equal(receipt.realFundsEnabled, false);
  assert.deepEqual(f.methods, ["getGenesisHash", "getTransaction"]);
});
test("mainnet RPC is rejected before reading any transaction", async () => {
  const f = fixture(() => {}, "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
  await assert.rejects(f.verifier.verify(f.input), /Wrong Solana network/);
  assert.deepEqual(f.methods, ["getGenesisHash"]);
});
test("failed, forged and mismatched deposits cannot produce receipts", async () => {
  const changes = [
    tx => { tx.meta.err = { error: "failed" }; },
    tx => { tx.transaction.message.accountKeys[0].signer = false; },
    tx => { tx.meta.postTokenBalances[1].mint = testWallet().address; },
    tx => { tx.meta.postTokenBalances[1].owner = testWallet().address; },
    tx => { tx.meta.postTokenBalances[1].uiTokenAmount.amount = "4000000"; },
    tx => { tx.meta.preTokenBalances[0].owner = testWallet().address; },
    tx => { tx.transaction.signatures = []; },
    tx => { tx.transaction.message.instructions[0].parsed.info.tokenAmount.decimals = 9; },
  ];
  for (const change of changes) { const f = fixture(change); await assert.rejects(f.verifier.verify(f.input)); }
});
test("deposit verifier is disabled without treasury configuration", async () => {
  const verifier = createDevnetDepositVerifier({});
  assert.equal(verifier.configured, false);
  await assert.rejects(verifier.verify({}), /not configured/);
});
