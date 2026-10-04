export const POLICY = Object.freeze({
  maxPerTip: 10,
  maxPerDay: 25,
  feeRate: 0.005,
  minimumFee: 0.01,
  maximumFee: 1,
});

export function parseTipCommand(raw) {
  if (typeof raw !== "string" || raw.length > 1000) return { ok: false, reason: "Enter a short text command." };
  const text = raw.trim();
  const match = text.match(/^@TagTip\s+send\s+\$?([0-9]+(?:\.[0-9]{1,2})?)\s+to\s+@([A-Za-z0-9_]{1,15})$/i);

  if (!match) {
    return {
      ok: false,
      reason: "Use: @TagTip send $5 to @username",
    };
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "Enter an amount greater than $0." };
  }

  return { ok: true, amount, recipient: `@${match[2]}` };
}

export function calculateFee(amount, policy = POLICY) {
  return Math.min(
    policy.maximumFee,
    Math.max(policy.minimumFee, Math.round((amount * policy.feeRate + Number.EPSILON) * 100) / 100),
  );
}

export function evaluateTip({ amount, spentToday = 0, budget = 0, active = true }, policy = POLICY) {
  const fee = calculateFee(amount, policy);
  const total = Number((amount + fee).toFixed(2));

  if (!active) return { ok: false, fee, total, reason: "TipBot is paused." };
  if (amount > policy.maxPerTip) {
    return { ok: false, fee, total, reason: `Blocked: the per-tip limit is $${policy.maxPerTip.toFixed(2)}.` };
  }
  if (spentToday + amount > policy.maxPerDay) {
    return { ok: false, fee, total, reason: `Blocked: this would exceed the $${policy.maxPerDay.toFixed(2)} daily limit.` };
  }
  if (total > budget) {
    return { ok: false, fee, total, reason: "Blocked: the approved test budget is too low." };
  }

  return { ok: true, fee, total };
}

export function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}
