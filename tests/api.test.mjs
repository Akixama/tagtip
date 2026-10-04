import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("HTTP demo lifecycle and security boundaries", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tagtip-api-"));
  process.env.DEMO_DATA_FILE = join(directory, "ledger.json");
  process.env.DATABASE_URL = "";
  process.env.X_PROCESSOR_SECRET = "test-only-processor-secret";
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
    assert.equal(health.mode, "demo");
    assert.equal(health.realFundsEnabled, false);
    assert.equal(health.processorEnabled, true);
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
    const headers = { Authorization: "Bearer test-only-processor-secret" };
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
});
