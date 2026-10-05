import test from "node:test";
import assert from "node:assert/strict";
import { operationsSummary } from "../src/ops-summary.js";

test("operations summary reports count-only actionable queues", () => {
  const summary = operationsSummary({
    checkpoint: { lastSeenPostId: "42", consecutiveFailures: 2, replyOutbox: {
      a: { status: "sent", text: "private reply text" },
      b: { status: "unknown", replyToPostId: "sensitive-post-id" },
      c: { status: "failed" },
    } },
    accounts: {
      withdrawals: { one: { status: "reserved", amountUnits: 5_000_000 } },
      devnetWithdrawals: { two: { status: "devnet_reserved", wallet: "private-wallet" } },
    },
  });

  assert.equal(summary.realFundsEnabled, false);
  assert.deepEqual(summary.worker.replies.statuses, { sent: 1, unknown: 1, failed: 1 });
  assert.equal(summary.queues.devnetWithdrawals.statuses.devnet_reserved, 1);
  assert.deepEqual(summary.alerts.map(alert => alert.code), ["REPLY_UNKNOWN", "REPLY_FAILED", "DEVNET_WITHDRAWALS_RESERVED", "SANDBOX_WITHDRAWALS_RESERVED"]);
  assert.doesNotMatch(JSON.stringify(summary), /private reply text|sensitive-post-id|private-wallet|5000000/);
});

test("operations summary handles empty state", () => {
  const summary = operationsSummary({});
  assert.deepEqual(summary.worker.replies, { total: 0, statuses: {} });
  assert.deepEqual(summary.alerts, []);
});
