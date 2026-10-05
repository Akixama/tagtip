const countStatuses = (items = []) => items.reduce((counts, item) => {
  const status = typeof item?.status === "string" && item.status ? item.status : "unknown";
  counts[status] = (counts[status] || 0) + 1;
  return counts;
}, {});

export function operationsSummary({ checkpoint, accounts }) {
  const replies = Object.values(checkpoint?.replyOutbox || {});
  const withdrawals = Object.values(accounts?.withdrawals || {});
  const devnetWithdrawals = Object.values(accounts?.devnetWithdrawals || {});
  const alerts = [];

  const replyStatuses = countStatuses(replies);
  const withdrawalStatuses = countStatuses(withdrawals);
  const devnetWithdrawalStatuses = countStatuses(devnetWithdrawals);
  if (replyStatuses.unknown) alerts.push({ code: "REPLY_UNKNOWN", count: replyStatuses.unknown,
    message: "X replies have an unknown delivery result and require manual review before retrying." });
  if (replyStatuses.failed) alerts.push({ code: "REPLY_FAILED", count: replyStatuses.failed,
    message: "X replies failed permanently and require operator review." });
  if (devnetWithdrawalStatuses.devnet_reserved) alerts.push({ code: "DEVNET_WITHDRAWALS_RESERVED", count: devnetWithdrawalStatuses.devnet_reserved,
    message: "Devnet withdrawal reservations are waiting for operator action; no transaction was broadcast." });
  if (withdrawalStatuses.reserved) alerts.push({ code: "SANDBOX_WITHDRAWALS_RESERVED", count: withdrawalStatuses.reserved,
    message: "Sandbox withdrawal reservations are waiting for operator action." });

  return {
    ok: true,
    mode: "sandbox",
    realFundsEnabled: false,
    worker: {
      lastSeenPostId: checkpoint?.lastSeenPostId || null,
      lastRunAt: checkpoint?.lastRunAt || null,
      consecutiveFailures: Number(checkpoint?.consecutiveFailures || 0),
      replies: { total: replies.length, statuses: replyStatuses },
    },
    queues: {
      sandboxWithdrawals: { total: withdrawals.length, statuses: withdrawalStatuses },
      devnetWithdrawals: { total: devnetWithdrawals.length, statuses: devnetWithdrawalStatuses },
    },
    alerts,
  };
}
