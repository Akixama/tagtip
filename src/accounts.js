import { randomUUID } from "node:crypto";
import { decodeSolanaAddress, verifyWalletProof } from "./wallet-proof.js";

const DAY = 86_400_000;
const validId = id => typeof id === "string" && /^\d{1,30}$/.test(id);
const reject = reason => { const error = new Error(reason); error.code = "ACCOUNT_RULE"; throw error; };
export function usdcUnits(value) {
  if (typeof value !== "string" || !/^\d{1,9}(?:\.\d{1,6})?$/.test(value)) reject("Enter a positive USDC amount with at most six decimals.");
  const [whole, fraction = ""] = value.split(".");
  const units = Number(whole) * 1_000_000 + Number(fraction.padEnd(6, "0"));
  if (!Number.isSafeInteger(units) || units <= 0) reject("Invalid USDC amount.");
  return units;
}
export function feeUnits(amount) {
  return Math.min(1_000_000, Math.max(10_000, Math.floor((amount + 1_000_000) / 2_000_000) * 10_000));
}

// Financial sandbox only. Every movement has balanced integer journal entries.
export function createAccountLedger(seed, now = Date.now) {
  const state = structuredClone(seed || { version: 1, mode: "sandbox", accounts: {}, balances: {}, tips: {}, events: {}, withdrawals: {}, journal: [] });
  if (state.version !== 1 || state.mode !== "sandbox") reject("Unsupported ledger state.");
  state.devnetBalances ||= {};
  state.devnetDeposits ||= {};
  state.devnetJournal ||= [];
  state.devnetWithdrawals ||= {};
  const balanceKey = id => `user:${id}`;
  const balance = key => state.balances[key] || 0;
  function move(from, to, units, reason, reference) {
    if (!Number.isSafeInteger(units) || units <= 0) reject("Invalid journal amount.");
    if (from !== "sandbox:issuance" && balance(from) < units) reject("Insufficient available balance.");
    state.balances[from] = balance(from) - units;
    state.balances[to] = balance(to) + units;
    state.journal.push({ id: randomUUID(), at: new Date(now()).toISOString(), reason, reference, entries: [
      { account: from, units: -units }, { account: to, units },
    ] });
  }
  function account(id) {
    if (!validId(id) || !state.accounts[id]) reject("Account not found.");
    return state.accounts[id];
  }
  const devnetBalanceKey = id => `user:${id}`;
  const devnetBalance = key => state.devnetBalances[key] || 0;
  function devnetMove(from, to, units, reason, reference) {
    if (!Number.isSafeInteger(units) || units <= 0) reject("Invalid devnet journal amount.");
    if (from !== "asset:devnet-treasury" && devnetBalance(from) < units) reject("Insufficient devnet balance.");
    state.devnetBalances[from] = devnetBalance(from) - units;
    state.devnetBalances[to] = devnetBalance(to) + units;
    state.devnetJournal.push({ id: randomUUID(), at: new Date(now()).toISOString(), reason, reference, entries: [
      { account: from, units: -units }, { account: to, units },
    ] });
  }
  function touch(identity) {
    if (!validId(identity?.id) || !/^[A-Za-z0-9_]{1,15}$/.test(identity.username)) reject("Invalid verified identity.");
    const existing = state.accounts[identity.id];
    state.accounts[identity.id] = { ...(existing || { id: identity.id, funded: false, paused: false,
      policy: { perTipUnits: 10_000_000, perDayUnits: 25_000_000 }, spendingDay: "", spentUnits: 0 }), username: identity.username };
    return state.accounts[identity.id];
  }
  function dayReset(user) {
    const day = new Date(now()).toISOString().slice(0, 10);
    if (user.spendingDay !== day) { user.spendingDay = day; user.spentUnits = 0; }
  }
  function expire() {
    for (const tip of Object.values(state.tips)) {
      if (tip.status !== "pending" || tip.expiresAt > now()) continue;
      move(`tip:${tip.id}`, balanceKey(tip.senderId), tip.amountUnits + tip.feeUnits, "tip_expired", tip.id);
      tip.status = "expired";
      const sender = account(tip.senderId);
      dayReset(sender);
      if (tip.spendingDay === sender.spendingDay) sender.spentUnits -= tip.amountUnits;
    }
  }
  function snapshot(id) {
    expire();
    const user = account(id);
    dayReset(user);
    return { mode: "sandbox", realFundsEnabled: false, account: structuredClone(user), availableUnits: balance(balanceKey(id)),
      devnetAvailableUnits: devnetBalance(devnetBalanceKey(id)),
      devnetDeposits: Object.values(state.devnetDeposits).filter(item => item.accountId === id).map(item => structuredClone(item)),
      devnetWithdrawals: Object.values(state.devnetWithdrawals).filter(item => item.accountId === id).map(item => structuredClone(item)),
      tips: Object.values(state.tips).filter(tip => tip.senderId === id || tip.recipientId === id).map(tip => structuredClone(tip)),
      withdrawals: Object.values(state.withdrawals).filter(item => item.accountId === id).map(item => structuredClone(item)),
      journal: state.journal.filter(item => item.entries.some(entry => entry.account === balanceKey(id))).map(item => structuredClone(item)),
    };
  }
  return {
    touch,
    export: () => structuredClone(state),
    snapshot,
    resolveHandle: handle => Object.values(state.accounts).find(user => user.username.toLowerCase() === handle.replace(/^@/, "").toLowerCase())?.id,
    creditDevnetDeposit(id, evidence) {
      const user = account(id);
      if (!user.verifiedWallet || evidence?.depositorWallet !== user.verifiedWallet) reject("Deposit wallet does not match the verified account wallet.");
      if (evidence?.ok !== true || evidence.cluster !== "devnet" || evidence.commitment !== "finalized" ||
          evidence.ledgerCredited !== false || evidence.realFundsEnabled !== false || !Number.isSafeInteger(evidence.amountUnits) ||
          evidence.amountUnits <= 0 || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(evidence.signature || "")) reject("Invalid finalized devnet deposit evidence.");
      const previous = state.devnetDeposits[evidence.signature];
      if (previous) {
        if (previous.accountId !== id || previous.amountUnits !== evidence.amountUnits) reject("Deposit signature already belongs to another account or amount.");
        return { deposit: structuredClone(previous), duplicate: true };
      }
      devnetMove("asset:devnet-treasury", devnetBalanceKey(id), evidence.amountUnits, "devnet_deposit", evidence.signature);
      const deposit = { accountId: id, signature: evidence.signature, amountUnits: evidence.amountUnits,
        wallet: evidence.depositorWallet, mint: evidence.mint, slot: evidence.slot, status: "devnet_credited",
        creditedAt: new Date(now()).toISOString() };
      state.devnetDeposits[evidence.signature] = deposit;
      return { deposit: structuredClone(deposit), duplicate: false };
    },
    reserveDevnetWithdrawal(id, amount, wallet, requestId) {
      const user = account(id);
      if (wallet !== user.verifiedWallet) reject("Verify ownership of the devnet withdrawal wallet first.");
      if (!user.walletVerifiedAt || Date.parse(user.walletVerifiedAt) + 15 * 60_000 < now()) reject("Verify the wallet again before reserving a devnet withdrawal.");
      if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(requestId)) reject("Withdrawal idempotency key required.");
      const units = usdcUnits(amount);
      if (units > 100_000_000) reject("Devnet pilot withdrawals are capped at 100 USDC.");
      const existing = Object.values(state.devnetWithdrawals).find(item => item.accountId === id && item.requestId === requestId);
      if (existing) {
        if (existing.amountUnits !== units || existing.wallet !== wallet) reject("Withdrawal key was used for a different request.");
        return { withdrawal: structuredClone(existing), duplicate: true };
      }
      const withdrawalId = randomUUID();
      devnetMove(devnetBalanceKey(id), `withdrawal:${withdrawalId}`, units, "devnet_withdrawal_reserved", withdrawalId);
      const withdrawal = { id: withdrawalId, accountId: id, amountUnits: units, wallet, requestId,
        status: "devnet_reserved", createdAt: new Date(now()).toISOString() };
      state.devnetWithdrawals[withdrawalId] = withdrawal;
      return { withdrawal: structuredClone(withdrawal), duplicate: false };
    },
    cancelDevnetWithdrawal(id, userId) {
      const withdrawal = state.devnetWithdrawals[id];
      if (!withdrawal || withdrawal.accountId !== userId) reject("Devnet withdrawal not found.");
      if (withdrawal.status !== "devnet_reserved") reject("Devnet withdrawal cannot be cancelled.");
      devnetMove(`withdrawal:${id}`, devnetBalanceKey(userId), withdrawal.amountUnits, "devnet_withdrawal_cancelled", id);
      withdrawal.status = "cancelled";
    },
    fund(id) {
      const user = account(id);
      if (user.funded) reject("Your one-time sandbox balance has already been added.");
      move("sandbox:issuance", balanceKey(id), 25_000_000, "sandbox_funding", id);
      user.funded = true;
    },
    policy(id, perTip, perDay, paused) {
      const user = account(id);
      const perTipUnits = usdcUnits(perTip), perDayUnits = usdcUnits(perDay);
      if (perTipUnits > perDayUnits || perDayUnits > 100_000_000) reject("Per-tip limit must not exceed the daily limit; sandbox daily maximum is 100 USDC.");
      if (typeof paused !== "boolean") reject("Paused must be true or false.");
      user.policy = { perTipUnits, perDayUnits }; user.paused = paused;
    },
    send({ senderId, recipientId, recipientHandle, amount, eventId }) {
      expire();
      const user = account(senderId);
      if (!validId(recipientId)) reject("Recipient must be resolved to a verified X user ID.");
      if (senderId === recipientId) reject("You cannot tip yourself.");
      if (typeof eventId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(eventId)) reject("An idempotency key is required.");
      if (!/^[A-Za-z0-9_]{1,15}$/.test(recipientHandle || "")) reject("Invalid recipient handle.");
      const amountUnits = usdcUnits(amount);
      const previous = Object.hasOwn(state.events, eventId) ? state.events[eventId] : null;
      if (previous) {
        const tip = state.tips[previous];
        if (tip.senderId !== senderId || tip.recipientId !== recipientId || tip.amountUnits !== amountUnits) reject("Idempotency key already used for a different command.");
        return { tip: structuredClone(tip), duplicate: true };
      }
      dayReset(user);
      if (user.paused) reject("Tipping is paused.");
      if (amountUnits > user.policy.perTipUnits) reject("Per-tip limit exceeded.");
      if (amountUnits + user.spentUnits > user.policy.perDayUnits) reject("Daily spending limit exceeded.");
      const fee = feeUnits(amountUnits), id = randomUUID();
      move(balanceKey(senderId), `tip:${id}`, amountUnits + fee, "tip_reserved", id);
      const tip = { id, senderId, senderHandle: user.username, recipientId, recipientHandle,
        amountUnits, feeUnits: fee, status: "pending", spendingDay: user.spendingDay,
        createdAt: new Date(now()).toISOString(), expiresAt: now() + 7 * DAY };
      state.tips[id] = tip;
      Object.defineProperty(state.events, eventId, { value: id, enumerable: true, writable: true, configurable: true });
      user.spentUnits += amountUnits;
      return { tip: structuredClone(tip), duplicate: false };
    },
    claim(id, recipientId) {
      expire(); account(recipientId);
      const tip = state.tips[id];
      if (!tip || tip.recipientId !== recipientId) reject("This tip does not belong to your X account.");
      if (tip.status === "credited") return structuredClone(tip);
      if (tip.status !== "pending") reject("Tip is no longer claimable.");
      move(`tip:${id}`, balanceKey(recipientId), tip.amountUnits, "tip_claimed", id);
      move(`tip:${id}`, "service:fees", tip.feeUnits, "tip_fee", id);
      tip.status = "credited"; tip.claimedAt = new Date(now()).toISOString();
      return structuredClone(tip);
    },
    walletChallenge(id, wallet, origin) {
      const user = account(id);
      try { decodeSolanaAddress(wallet); } catch { reject("Invalid Solana wallet address."); }
      if (!origin) reject("Wallet verification origin not configured.");
      const expiresAt = now() + 300_000;
      const message = `${origin} requests wallet ownership verification for TagTip.\n\nX user ID: ${id}\nWallet: ${wallet}\nMode: sandbox (no real funds)\nNonce: ${randomUUID()}\nIssued: ${new Date(now()).toISOString()}\nExpires: ${new Date(expiresAt).toISOString()}\n\nThis signature proves ownership only. It does not approve a transaction or spending access.`;
      user.walletChallenge = { wallet, message, expiresAt };
      return structuredClone(user.walletChallenge);
    },
    verifyWallet(id, signature) {
      const user = account(id), challenge = user.walletChallenge;
      if (!challenge || challenge.expiresAt <= now()) reject("Wallet proof expired. Start again.");
      if (!verifyWalletProof(challenge.wallet, challenge.message, signature)) reject("Wallet signature is invalid.");
      user.verifiedWallet = challenge.wallet;
      user.walletVerifiedAt = new Date(now()).toISOString();
      delete user.walletChallenge;
    },
    withdraw(id, amount, wallet, requestId) {
      const user = account(id);
      if (typeof wallet !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) reject("Enter a Solana wallet address.");
      if (wallet !== user.verifiedWallet) reject("Verify ownership of the withdrawal wallet first.");
      if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(requestId)) reject("Withdrawal idempotency key required.");
      const units = usdcUnits(amount);
      const existing = Object.values(state.withdrawals).find(item => item.accountId === id && item.requestId === requestId);
      if (existing) {
        if (existing.amountUnits !== units || existing.wallet !== wallet) reject("Withdrawal key was used for a different request.");
        return structuredClone(existing);
      }
      const withdrawalId = randomUUID();
      move(balanceKey(id), `withdrawal:${withdrawalId}`, units, "withdrawal_reserved", withdrawalId);
      const withdrawal = { id: withdrawalId, accountId: id, amountUnits: units, wallet, requestId,
        status: "sandbox_reserved", createdAt: new Date(now()).toISOString() };
      state.withdrawals[withdrawalId] = withdrawal;
      return structuredClone(withdrawal);
    },
    cancelWithdrawal(id, userId) {
      const withdrawal = state.withdrawals[id];
      if (!withdrawal || withdrawal.accountId !== userId) reject("Withdrawal not found.");
      if (withdrawal.status !== "sandbox_reserved") reject("Withdrawal cannot be cancelled.");
      move(`withdrawal:${id}`, balanceKey(userId), withdrawal.amountUnits, "withdrawal_cancelled", id);
      withdrawal.status = "cancelled";
    },
    reconcile() {
      const expected = {};
      for (const item of state.journal) {
        if (!Array.isArray(item.entries) || item.entries.length !== 2 || item.entries.some(entry =>
          typeof entry.account !== "string" || !Number.isSafeInteger(entry.units) || entry.units === 0)) reject("Invalid journal entry.");
        if (item.entries.reduce((sum, entry) => sum + entry.units, 0) !== 0) reject("Unbalanced journal entry.");
        for (const entry of item.entries) expected[entry.account] = (expected[entry.account] || 0) + entry.units;
      }
      for (const key of new Set([...Object.keys(expected), ...Object.keys(state.balances)])) {
        if (!Number.isSafeInteger(balance(key))) reject("Unsafe ledger balance.");
        if ((expected[key] || 0) !== balance(key)) reject("Ledger reconciliation failed.");
        if (key !== "sandbox:issuance" && balance(key) < 0) reject("Negative balance.");
      }
      for (const tip of Object.values(state.tips)) {
        if (!["pending", "credited", "expired"].includes(tip.status) || !Number.isSafeInteger(tip.amountUnits) || tip.amountUnits <= 0 ||
          !Number.isSafeInteger(tip.feeUnits) || tip.feeUnits <= 0) reject("Invalid tip record.");
        if (balance(`tip:${tip.id}`) !== (tip.status === "pending" ? tip.amountUnits + tip.feeUnits : 0)) reject("Tip reservation does not match its record.");
      }
      for (const withdrawal of Object.values(state.withdrawals)) {
        if (!["sandbox_reserved", "cancelled"].includes(withdrawal.status) || !Number.isSafeInteger(withdrawal.amountUnits) || withdrawal.amountUnits <= 0) reject("Invalid withdrawal record.");
        if (balance(`withdrawal:${withdrawal.id}`) !== (withdrawal.status === "sandbox_reserved" ? withdrawal.amountUnits : 0)) reject("Withdrawal reservation does not match its record.");
      }
      const expectedDevnet = {};
      for (const item of state.devnetJournal) {
        if (!Array.isArray(item.entries) || item.entries.length !== 2 || item.entries.some(entry =>
          typeof entry.account !== "string" || !Number.isSafeInteger(entry.units) || entry.units === 0)) reject("Invalid devnet journal entry.");
        if (item.entries.reduce((sum, entry) => sum + entry.units, 0) !== 0) reject("Unbalanced devnet journal entry.");
        for (const entry of item.entries) expectedDevnet[entry.account] = (expectedDevnet[entry.account] || 0) + entry.units;
      }
      for (const key of new Set([...Object.keys(expectedDevnet), ...Object.keys(state.devnetBalances)])) {
        if (!Number.isSafeInteger(devnetBalance(key)) || (expectedDevnet[key] || 0) !== devnetBalance(key)) reject("Devnet ledger reconciliation failed.");
        if (key !== "asset:devnet-treasury" && devnetBalance(key) < 0) reject("Negative devnet balance.");
      }
      for (const withdrawal of Object.values(state.devnetWithdrawals)) {
        if (!["devnet_reserved", "cancelled"].includes(withdrawal.status) || !Number.isSafeInteger(withdrawal.amountUnits) || withdrawal.amountUnits <= 0) reject("Invalid devnet withdrawal record.");
        if (devnetBalance(`withdrawal:${withdrawal.id}`) !== (withdrawal.status === "devnet_reserved" ? withdrawal.amountUnits : 0)) reject("Devnet withdrawal reservation does not match its record.");
      }
      return { ok: true, journalEntries: state.journal.length, totalUnits: Object.values(state.balances).reduce((sum, value) => sum + value, 0) };
    },
    expire,
  };
}
