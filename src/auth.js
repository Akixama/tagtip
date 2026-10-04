import { randomBytes, createHash } from "node:crypto";

const random = () => randomBytes(32).toString("base64url");
const hash = value => createHash("sha256").update(value).digest("base64url");
const fail = message => { throw new Error(message); };

// Identity-only login. X tokens are used once to fetch the profile, never stored.
export function createAuthService({ store, clientId, clientSecret, origin, fetcher = fetch, now = Date.now }) {
  if (origin) {
    const url = new URL(origin);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.origin !== origin || url.username || url.password || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) {
      fail("APP_ORIGIN must be an HTTPS origin (HTTP is allowed only for localhost).");
    }
  }
  const configured = Boolean(clientId && clientSecret && origin);
  const secure = origin?.startsWith("https://");
  const cookie = (name, value, seconds) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? "; Secure" : ""}`;
  async function load() {
    const state = await store.load() || { accounts: {}, flows: {}, sessions: {} };
    for (const collection of [state.flows, state.sessions]) {
      for (const [key, entry] of Object.entries(collection)) if (entry.expiresAt <= now()) delete collection[key];
    }
    return state;
  }
  return {
    configured,
    async start() {
      if (!configured) fail("X login is not configured.");
      const state = await load();
      const nonce = random(), browser = random(), verifier = random();
      state.flows[hash(nonce)] = { browserHash: hash(browser), verifier, expiresAt: now() + 600_000 };
      await store.save(state);
      const url = new URL("https://x.com/i/oauth2/authorize");
      url.search = new URLSearchParams({ response_type: "code", client_id: clientId,
        redirect_uri: `${origin}/api/auth/x/callback`, scope: "tweet.read users.read",
        state: nonce, code_challenge: hash(verifier), code_challenge_method: "S256" }).toString();
      return { url: url.href, cookie: cookie("tagtip_oauth", browser, 600) };
    },
    async callback({ code, nonce, browser }) {
      if (!configured || !code || !nonce || !browser) fail("Invalid login callback. Start again.");
      const state = await load();
      const flow = state.flows[hash(nonce)];
      if (!flow || flow.browserHash !== hash(browser)) fail("Login expired or belongs to another browser.");
      // Consume before contacting X. Optimistic DB writes prevent concurrent replay.
      delete state.flows[hash(nonce)];
      await store.save(state);
      const tokenResponse = await fetcher("https://api.x.com/2/oauth2/token", {
        method: "POST", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString("base64")}` },
        body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: flow.verifier,
          redirect_uri: `${origin}/api/auth/x/callback` }).toString(),
      });
      if (!tokenResponse.ok) fail("X login could not be completed. Start again.");
      const token = await tokenResponse.json();
      if (typeof token.access_token !== "string" || !token.access_token) fail("X returned an invalid token.");
      const profileResponse = await fetcher("https://api.x.com/2/users/me", {
        signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (!profileResponse.ok) fail("Could not verify your X identity.");
      const { data } = await profileResponse.json();
      if (!data || !/^\d+$/.test(data.id) || !/^[A-Za-z0-9_]{1,15}$/.test(data.username)) fail("X returned an invalid identity.");
      const latest = await load();
      const account = { id: data.id, username: data.username, name: String(data.name || data.username),
        createdAt: latest.accounts[data.id]?.createdAt || new Date(now()).toISOString() };
      latest.accounts[data.id] = account;
      const session = random();
      latest.sessions[hash(session)] = { accountId: data.id, expiresAt: now() + 86_400_000 };
      await store.save(latest);
      return { account, cookies: [cookie("tagtip_session", session, 86400), cookie("tagtip_oauth", "", 0)] };
    },
    async me(session) {
      if (!session) return null;
      const state = await load();
      const entry = state.sessions[hash(session)];
      return entry ? state.accounts[entry.accountId] || null : null;
    },
    async findHandle(username) {
      const state = await load();
      return Object.values(state.accounts).find(account => account.username.toLowerCase() === username.toLowerCase()) || null;
    },
    async logout(session) {
      const state = await load();
      if (session) delete state.sessions[hash(session)];
      await store.save(state);
      return cookie("tagtip_session", "", 0);
    },
  };
}

export function readCookies(header = "") {
  return Object.fromEntries(header.split(";").map(part => part.trim().split(/=(.*)/s)).filter(parts => parts[0]).map(([key, value]) => [key, value || ""]));
}
