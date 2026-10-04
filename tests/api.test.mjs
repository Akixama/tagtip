import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createFileStore } from "../src/file-store.js";
import { testWallet } from "./helpers/wallet.js";

test("HTTP demo lifecycle and security boundaries", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tagtip-api-"));
  process.env.DEMO_DATA_FILE = join(directory, "ledger.json");
  process.env.AUTH_DATA_FILE = join(directory, "identity.json");
  process.env.ACCOUNT_DATA_FILE = join(directory, "accounts.json");
  process.env.APP_ORIGIN = "http://localhost:4173";
  process.env.X_CLIENT_ID = "";
  process.env.X_CLIENT_SECRET = "";
  await createFileStore(process.env.AUTH_DATA_FILE).save({ accounts: {
    "1": { id: "1", username: "alice" }, "2": { id: "2", username: "bob" }, "3": { id: "3", username: "charlie" },
  }, flows: {}, sessions: Object.fromEntries(["alice", "bob", "charlie"].map((name, index) => [
    createHash("sha256").update(name).digest("base64url"), { accountId: String(index + 1), expiresAt: Date.now() + 86_400_000 },
  ])) });
  process.env.DATABASE_URL = "";
  process.env.X_PROCESSOR_SECRET = "test-only-processor-secret-long-enough-12345";
  delete process.env.VERCEL;
  const { requestHandler } = await import("../server.mjs");
  const server = createServer(requestHandler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (path, body, headers = {}) => fetch(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  await t.test("health never implies real funds are enabled", async () => {
    const health = await (await request("/api/health")).json();
    assert.equal(health.mode, "sandbox");
    assert.equal(health.realFundsEnabled, false);
    assert.equal(health.demoIngestionEnabled, true);
    assert.equal(health.processorEnabled, false);
  });
  await t.test("private server and data files cannot be downloaded", async () => {
    for (const path of ["/server.mjs", "/.env", "/src/ledger.js", "/data/demo-ledger.json"]) {
      assert.equal((await request(path)).status, 404);
    }
  });
  await t.test("cross-origin mutations are rejected", async () => {
    assert.equal((await request("/api/demo/setup", {}, { Origin: "https://attacker.example" })).status, 403);
  });
  await t.test("processor authorization is mandatory", async () => {
    assert.equal((await request("/api/x/events", { tweetId: "42", text: "@TagTip send $3 to @mara" })).status, 401);
  });
  await request("/api/demo/setup", {});
  await request("/api/demo/setup", {});
  let id;
  await t.test("duplicate processor requests charge the balance once", async () => {
    const event = { tweetId: "42", text: "@TagTip send $3 to @mara" };
    const headers = { Authorization: `Bearer ${process.env.X_PROCESSOR_SECRET}` };
    const first = await request("/api/x/events", event, headers);
    assert.equal(first.status, 201);
    id = (await first.json()).tip.id;
    const second = await request("/api/x/events", event, headers);
    assert.equal(second.status, 200);
    assert.equal((await second.json()).duplicate, true);
    const state = await (await request("/api/demo")).json();
    assert.equal(state.tips.length, 1);
    assert.equal(state.sender.budget, 21.98);
  });
  await t.test("claims enforce order and cannot be repeated", async () => {
    const path = `/api/demo/tips/${id}`;
    assert.equal((await request(`${path}/claim`, {})).status, 409);
    for (const step of ["verify", "wallet", "claim"]) {
      assert.equal((await request(`${path}/${step}`, {})).status, 200);
    }
    assert.equal((await request(`${path}/claim`, {})).status, 409);
    assert.equal((await (await request(`/api/tips/${id}`)).json()).tip.status, "claimed");
  });
  await t.test("malformed JSON and invalid commands are rejected", async () => {
    const malformed = await fetch(`${origin}/api/demo/tips`, { method: "POST", body: "{" });
    assert.equal(malformed.status, 400);
    assert.equal((await request("/api/demo/tips", { command: 123 })).status, 400);
  });
  await t.test("personal accounts require sessions and same-origin mutations", async () => {
    assert.equal((await request("/api/account")).status, 401);
    assert.equal((await request("/api/account/fund", {}, { Cookie: "tagtip_session=alice" })).status, 403);
    assert.equal((await request("/api/auth/x/start")).status, 503);
  });
  await t.test("ops endpoints are protected and oversize bodies are rejected", async () => {
    assert.equal((await request("/api/ops/readiness")).status, 401);
    const ops = { Authorization: `Bearer ${process.env.X_PROCESSOR_SECRET}` };
    const ready = await request("/api/ops/readiness", undefined, ops);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).realFundsEnabled, false);
    assert.equal((await request("/api/ops/process-x", {}, ops)).status, 503);
    const large = await fetch(`${origin}/api/demo/tips`, { method: "POST", body: "a".repeat(17_000) });
    assert.equal(large.status, 413);
  });
  await t.test("authenticated account flows cannot access another user's money", async () => {
    const headers = name => ({ Cookie: `tagtip_session=${name}`, Origin: process.env.APP_ORIGIN });
    assert.equal((await request("/api/account/fund", {}, headers("alice"))).status, 200);
    const sent = await request("/api/account/tips", { command: "@TagTip send $5 to @bob", requestId: "intent-one" }, headers("alice"));
    assert.equal(sent.status, 200);
    const tipId = (await sent.json()).tip.id;
    assert.equal((await request(`/api/account/tips/${tipId}/claim`, {}, headers("alice"))).status, 422);
    const claimed = await request(`/api/account/tips/${tipId}/claim`, {}, headers("bob"));
    assert.equal(claimed.status, 200);
    assert.equal((await claimed.json()).state.availableUnits, 5_000_000);
    const charlie = await (await request("/api/account", undefined, headers("charlie"))).json();
    assert.equal(charlie.state.availableUnits, 0);
    assert.equal(charlie.state.tips.length, 0);
    assert.equal(charlie.state.journal.length, 0);
    const wallet = testWallet();
    const challengeResponse = await request("/api/account/wallet/challenge", { wallet: wallet.address }, headers("bob"));
    const { challenge } = await challengeResponse.json();
    assert.equal((await request("/api/account/wallet/verify", { signature: wallet.sign(challenge.message) }, headers("alice"))).status, 422);
    assert.equal((await request("/api/account/wallet/verify", { signature: wallet.sign(challenge.message) }, headers("bob"))).status, 200);
    const withdrawal = await request("/api/account/withdrawals", { amount: "2", wallet: wallet.address, requestId: "withdraw-1" }, headers("bob"));
    const withdrawalId = (await withdrawal.json()).withdrawal.id;
    assert.equal((await request(`/api/account/withdrawals/${withdrawalId}/cancel`, {}, headers("alice"))).status, 422);
    assert.equal((await request(`/api/account/withdrawals/${withdrawalId}/cancel`, {}, headers("bob"))).status, 200);
  });
});
