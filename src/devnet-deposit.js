import { decodeSolanaAddress } from "./wallet-proof.js";

export const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const DEVNET_IDENTIFIER = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const fail = reason => { throw new Error(reason); };
const rawAmount = value => {
  if (typeof value !== "string" || !/^\d{1,15}$/.test(value)) fail("Invalid token balance.");
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) fail("Unsafe token balance.");
  return amount;
};

// Read-only evidence verifier. It neither credits a ledger nor signs transactions.
export function createDevnetDepositVerifier({ rpcUrl, treasuryTokenAccount, treasuryOwner, fetcher = fetch }) {
  let configured = false;
  if (rpcUrl && treasuryTokenAccount && treasuryOwner) {
    if (new URL(rpcUrl).protocol !== "https:") fail("Devnet RPC must use HTTPS.");
    decodeSolanaAddress(treasuryTokenAccount); decodeSolanaAddress(treasuryOwner);
    configured = true;
  }
  async function rpc(method, params) {
    const response = await fetcher(rpcUrl, { method: "POST", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (!response.ok) fail("Devnet RPC unavailable.");
    const body = await response.json();
    if (body.error) fail("Devnet RPC rejected the request.");
    return body.result;
  }
  return {
    configured,
    async verify({ signature, depositorWallet }) {
      if (!configured) fail("Devnet deposit verification is not configured.");
      if (typeof signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) fail("Invalid transaction signature.");
      decodeSolanaAddress(depositorWallet);
      const genesis = await rpc("getGenesisHash", []);
      if (typeof genesis !== "string" || !genesis.startsWith(DEVNET_IDENTIFIER)) fail("Wrong Solana network. Only devnet is allowed.");
      const tx = await rpc("getTransaction", [signature, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
      if (!tx || !tx.meta || tx.meta.err !== null) fail("Transaction is missing, unfinalized, or failed.");
      if (!tx.transaction?.signatures?.includes(signature)) fail("Transaction signature does not match.");
      const message = tx.transaction.message;
      if (!Array.isArray(message?.accountKeys) || !Array.isArray(message.instructions)) fail("Unsupported transaction format.");
      const keys = message.accountKeys.map(key => typeof key === "string" ? { pubkey: key, signer: false } : key);
      if (!keys.some(key => key.pubkey === depositorWallet && key.signer === true)) fail("Verified wallet did not sign this transaction.");
      const treasuryIndex = keys.findIndex(key => key.pubkey === treasuryTokenAccount);
      if (treasuryIndex < 0) fail("Transaction does not involve the treasury token account.");
      const after = tx.meta.postTokenBalances?.find(item => item.accountIndex === treasuryIndex);
      const before = tx.meta.preTokenBalances?.find(item => item.accountIndex === treasuryIndex);
      for (const item of [after, before].filter(Boolean)) {
        if (item.mint !== DEVNET_USDC_MINT || item.owner !== treasuryOwner || item.uiTokenAmount?.decimals !== 6) fail("Treasury mint, owner or decimals do not match.");
      }
      if (!after) fail("Treasury token balance missing.");
      let credited = 0;
      for (const instruction of message.instructions) {
        const info = instruction.parsed?.info;
        if (instruction.programId !== TOKEN_PROGRAM || instruction.parsed?.type !== "transferChecked" || info?.destination !== treasuryTokenAccount) continue;
        if (info.authority !== depositorWallet || info.mint !== DEVNET_USDC_MINT || info.tokenAmount?.decimals !== 6) fail("Deposit authority, mint or decimals mismatch.");
        const sourceIndex = keys.findIndex(key => key.pubkey === info.source);
        const source = tx.meta.preTokenBalances?.find(item => item.accountIndex === sourceIndex);
        if (!source || source.owner !== depositorWallet || source.mint !== DEVNET_USDC_MINT || source.uiTokenAmount?.decimals !== 6) fail("Deposit source is not owned by the verified wallet.");
        const units = rawAmount(info.tokenAmount.amount);
        if (units <= 0) fail("Deposit must be positive.");
        credited += units;
        if (!Number.isSafeInteger(credited)) fail("Deposit exceeds safe accounting range.");
      }
      const delta = rawAmount(after.uiTokenAmount.amount) - (before ? rawAmount(before.uiTokenAmount.amount) : 0);
      if (credited <= 0 || delta !== credited) fail("Treasury balance delta does not match the deposit instructions.");
      return { ok: true, cluster: "devnet", mint: DEVNET_USDC_MINT, signature, depositorWallet, amountUnits: credited,
        treasuryTokenAccount, slot: tx.slot, commitment: "finalized", ledgerCredited: false, realFundsEnabled: false };
    },
  };
}
