import test from "node:test";
import assert from "node:assert/strict";
import { createAuthService } from "../src/auth.js";

function fixture(username = "tag_Tip") {
  let saved, clock = 1_000_000, refreshes = 0;
  const store = { load: async () => saved ? structuredClone(saved) : null, save: async value => { saved = structuredClone(value); } };
  const auth = createAuthService({ store, clientId: "client", clientSecret: "secret", origin: "https://tagtip.example", botHandle: "tag_Tip", tokenEncryptionKey: "ab".repeat(32), now: () => clock,
    fetcher: async (url, options) => {
      if (url.endsWith("/me")) return { ok: true, json: async () => ({ data: { id: "123", username } }) };
      if (options.body.includes("refresh_token")) refreshes++;
      return { ok: true, json: async () => ({ access_token: "bot-private-access-token", refresh_token: "bot-private-refresh-token", expires_in: 120, scope: "tweet.read users.read tweet.write offline.access" }) };
    } });
  async function callback() {
    const start = await auth.start({ bot: true });
    return auth.callback({ code: "code", nonce: new URL(start.url).searchParams.get("state"), browser: start.cookie.split(";")[0].split("=")[1] });
  }
  return { auth, callback, state: () => saved, advance: () => { clock += 120_000; }, refreshes: () => refreshes };
}

test("bot connection is separate, encrypted, and refreshed without exposing tokens", async () => {
  const f = fixture();
  assert.equal((await f.callback()).bot, true);
  assert.equal(JSON.stringify(f.state()).includes("bot-private"), false);
  assert.equal((await f.auth.botStatus()).account.username, "tag_Tip");
  assert.equal(JSON.stringify(await f.auth.botStatus()).includes("tokens"), false);
  assert.equal(await f.auth.botAccessToken(), "bot-private-access-token");
  f.advance();
  await f.auth.botAccessToken();
  assert.equal(f.refreshes(), 1);
});
test("wrong bot account is rejected and tokens are not saved", async () => {
  const f = fixture("bagszin");
  await assert.rejects(f.callback(), /Wrong bot account/);
  assert.equal((await f.auth.botStatus()).connected, false);
});
test("bot setup fails closed without dedicated encryption configuration", async () => {
  const auth = createAuthService({ store: {}, clientId: "client", clientSecret: "secret", origin: "https://tagtip.example", botHandle: "tag_Tip" });
  assert.equal(auth.botConfigured, false);
  await assert.rejects(auth.start({ bot: true }));
});
