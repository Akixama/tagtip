import test from "node:test";
import assert from "node:assert/strict";
import { createAuthService } from "../src/auth.js";

function fixture() {
  let saved, clock = 1_000_000, calls = 0, profile = { id: "123", username: "alice", name: "Alice" };
  const store = { load: async () => saved ? structuredClone(saved) : null, save: async value => { saved = structuredClone(value); } };
  const auth = createAuthService({ store, clientId: "client", clientSecret: "secret", origin: "https://tagtip.example",
    now: () => clock, fetcher: async url => {
      calls++;
      return { ok: true, json: async () => url.endsWith("/token") ? { access_token: "private-token" } : { data: profile } };
    } });
  const begin = async () => {
    const start = await auth.start();
    return { code: "code", nonce: new URL(start.url).searchParams.get("state"), browser: start.cookie.split(";")[0].split("=")[1] };
  };
  return { auth, begin, state: () => saved, calls: () => calls, advance: () => { clock += 86_400_001; }, profile: value => { profile = value; } };
}

test("X login uses PKCE and read-only scopes", async () => {
  const { auth } = fixture();
  const start = await auth.start();
  const url = new URL(start.url);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "tweet.read users.read");
  assert.match(start.cookie, /HttpOnly; SameSite=Lax/);
  assert.match(start.cookie, /Secure/);
});

test("login binds to browser, consumes state once, and stores no X tokens", async () => {
  const f = fixture();
  const input = await f.begin();
  await assert.rejects(f.auth.callback({ ...input, browser: "another-browser" }));
  assert.equal(f.calls(), 0);
  const result = await f.auth.callback(input);
  const session = result.cookies[0].split(";")[0].split("=")[1];
  assert.equal((await f.auth.me(session)).id, "123");
  assert.equal(await f.auth.me("forged"), null);
  assert.equal(JSON.stringify(f.state()).includes("private-token"), false);
  assert.equal(JSON.stringify(f.state()).includes(session), false);
  await assert.rejects(f.auth.callback(input));
  assert.equal(f.calls(), 2);
  await f.auth.logout(session);
  assert.equal(await f.auth.me(session), null);
});

test("expired login and expired sessions are rejected", async () => {
  const f = fixture();
  const input = await f.begin();
  f.advance();
  await assert.rejects(f.auth.callback(input));
  const result = await f.auth.callback(await f.begin());
  const session = result.cookies[0].split(";")[0].split("=")[1];
  f.advance();
  assert.equal(await f.auth.me(session), null);
});

test("distinct X identities keep separate accounts even if handles change", async () => {
  const f = fixture();
  await f.auth.callback(await f.begin());
  f.profile({ id: "456", username: "bob", name: "Bob" });
  await f.auth.callback(await f.begin());
  f.profile({ id: "123", username: "alice_new", name: "Alice" });
  await f.auth.callback(await f.begin());
  assert.equal(Object.keys(f.state().accounts).length, 2);
  assert.equal(f.state().accounts["123"].username, "alice_new");
  assert.equal(f.state().accounts["456"].username, "bob");
});

test("unconfigured login fails closed", async () => {
  const auth = createAuthService({ store: {} });
  assert.equal(auth.configured, false);
  await assert.rejects(auth.start());
});

test("non-local HTTP and path-bearing origins are rejected", () => {
  for (const origin of ["http://tagtip.example", "https://tagtip.example/path", "https://tagtip.example/"]) {
    assert.throws(() => createAuthService({ store: {}, origin }), /APP_ORIGIN/);
  }
  assert.doesNotThrow(() => createAuthService({ store: {}, origin: "http://localhost:4173" }));
});
