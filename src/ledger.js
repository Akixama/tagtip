import { evaluateTip, money, parseTipCommand } from "./core.js";

const nowLabel = () => new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date());

export function createDemoLedger(seed = null) {
  let sequence = Math.max(2048, ...(seed?.tips || []).map((tip) => Number(tip.id?.replace("TT-", "")) + 1 || 0));
  let state = seed ? structuredClone(seed) : null;

  const reset = () => {
    state = {
      sender: {
        handle: "@you",
        identityLinked: false,
        budgetApproved: false,
        budget: 0,
        spentToday: 0,
        active: false,
        setupStage: "identity",
      },
      tips: [],
      activities: [],
    };
    return snapshot();
  };

  const snapshot = () => structuredClone(state);
  const activity = (ok, title, detail) => state.activities.unshift({ ok, title, detail, time: nowLabel() });
  const findTip = (id) => state.tips.find((tip) => tip.id === id);

  const setup = () => {
    if (state.sender.setupStage === "identity") {
      state.sender.identityLinked = true;
      state.sender.setupStage = "budget";
    } else if (state.sender.setupStage === "budget") {
      state.sender.budgetApproved = true;
      state.sender.budget = 25;
      state.sender.active = true;
      state.sender.setupStage = "ready";
    }
    return snapshot();
  };

  const createTip = (command, metadata = {}) => {
    if (metadata.sourceId) {
      const existing = state.tips.find((tip) => tip.sourceId === metadata.sourceId);
      if (existing) return { ok: true, duplicate: true, tip: structuredClone(existing), state: snapshot() };
    }
    const parsed = parseTipCommand(command);
    if (!parsed.ok) {
      activity(false, "Command not recognized", parsed.reason);
      return { ok: false, reason: parsed.reason, state: snapshot() };
    }

    const result = evaluateTip({
      amount: parsed.amount,
      spentToday: state.sender.spentToday,
      budget: state.sender.budget,
      active: state.sender.active,
    });

    if (!result.ok) {
      activity(false, `Blocked ${money(parsed.amount)} tip`, result.reason);
      return { ok: false, reason: result.reason, amount: parsed.amount, recipient: parsed.recipient, state: snapshot() };
    }

    state.sender.budget = Number((state.sender.budget - result.total).toFixed(2));
    state.sender.spentToday = Number((state.sender.spentToday + parsed.amount).toFixed(2));
    const tip = {
      id: `TT-${sequence++}`,
      sender: state.sender.handle,
      recipient: parsed.recipient,
      amount: parsed.amount,
      fee: result.fee,
      status: "ready",
      wallet: null,
      sourceId: metadata.sourceId || null,
      source: metadata.source || "web-demo",
      createdAt: new Date().toISOString(),
    };
    state.tips.unshift(tip);
    activity(true, `${money(parsed.amount)} reserved for ${parsed.recipient}`, `${money(result.fee)} service fee · ${tip.id}`);
    return { ok: true, tip: structuredClone(tip), state: snapshot() };
  };

  const pause = () => {
    if (state.sender.budgetApproved) state.sender.active = !state.sender.active;
    return snapshot();
  };

  const revoke = () => {
    Object.assign(state.sender, { budgetApproved: false, budget: 0, active: false, setupStage: "budget" });
    return snapshot();
  };

  const verify = (id) => {
    const tip = findTip(id);
    if (!tip || tip.status !== "ready") return null;
    tip.status = "verified";
    return snapshot();
  };

  const connectWallet = (id, wallet = "7mR2…a91Q") => {
    const tip = findTip(id);
    if (!tip || tip.status !== "verified") return null;
    tip.wallet = wallet;
    tip.status = "wallet_connected";
    return snapshot();
  };

  const claim = (id) => {
    const tip = findTip(id);
    if (!tip || tip.status !== "wallet_connected") return null;
    tip.status = "claimed";
    tip.claimedAt = new Date().toISOString();
    return snapshot();
  };

  const getTip = (id) => {
    const tip = findTip(id);
    return tip ? structuredClone(tip) : null;
  };

  const expirePending = (now = Date.now(), ttlMs = 7 * 24 * 60 * 60 * 1000) => {
    let expired = 0;
    for (const tip of state.tips) {
      if (!["ready", "verified", "wallet_connected"].includes(tip.status)) continue;
      if (now - new Date(tip.createdAt).getTime() < ttlMs) continue;
      tip.status = "expired";
      tip.expiredAt = new Date(now).toISOString();
      state.sender.budget = Number((state.sender.budget + tip.amount + tip.fee).toFixed(2));
      state.sender.spentToday = Math.max(0, Number((state.sender.spentToday - tip.amount).toFixed(2)));
      activity(true, `${money(tip.amount)} returned`, `${tip.id} expired before it was claimed`);
      expired += 1;
    }
    return { expired, state: snapshot() };
  };

  if (!state) reset();
  return { snapshot, reset, setup, createTip, pause, revoke, verify, connectWallet, claim, getTip, expirePending };
}
