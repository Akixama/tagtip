// Evidence registry only: recording a receipt never changes a spendable balance.
// Persist exports with compare-and-swap; production needs transactional unique constraints.
export function createDepositReceipts(seed = {}) {
  const receipts = structuredClone(seed);
  return {
    record(accountId, evidence) {
      if (!/^\d{1,30}$/.test(accountId) || evidence?.ok !== true || evidence.cluster !== "devnet" ||
          evidence.commitment !== "finalized" || evidence.ledgerCredited !== false || evidence.realFundsEnabled !== false ||
          !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(evidence.signature || "") ||
          !Number.isSafeInteger(evidence.amountUnits) || evidence.amountUnits <= 0) throw new Error("Invalid devnet evidence.");
      const key = `devnet:${evidence.signature}`;
      const previous = receipts[key];
      if (previous) {
        if (previous.accountId !== accountId || JSON.stringify(previous.evidence) !== JSON.stringify(evidence)) {
          throw new Error("Deposit receipt already belongs to another account or evidence differs.");
        }
        return { receipt: structuredClone(previous), duplicate: true };
      }
      const receipt = { accountId, evidence: structuredClone(evidence), status: "evidence_only" };
      receipts[key] = receipt;
      return { receipt: structuredClone(receipt), duplicate: false };
    },
    export: () => structuredClone(receipts),
  };
}
