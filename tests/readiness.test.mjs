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
