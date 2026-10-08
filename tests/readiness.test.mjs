import test from "node:test";
import assert from "node:assert/strict";
import { readinessReport } from "../src/readiness.js";
test("configuration report does not expose credentials or pretend to be live verified", () => {
  const secret = "super-secret-value";
  const report = readinessReport({ APP_ORIGIN: "https://example.com", X_CLIENT_ID: "client", X_CLIENT_SECRET: secret, X_PROCESSOR_SECRET: "replace-with-secret" });
  assert.equal(report.configuration.identity.configured, true);
  assert.equal(report.configuration.identity.liveVerified, false);
  assert.equal(report.configuration.processor.configured, false);
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(report.realFundsEnabled, false);
});
test("processor readiness accepts a UTC start time instead of a post ID", () => {
  const report = readinessReport({ X_PROCESSOR_SECRET: "a".repeat(32), X_BEARER_TOKEN: "token",
    X_BOT_USER_ID: "123", X_START_TIME: "2026-10-08T11:00:00Z" });
  assert.equal(report.configuration.processor.configured, true);
  assert.deepEqual(report.configuration.processor.missing, []);
});
