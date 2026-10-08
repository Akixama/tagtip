import { randomBytes, createHash, createCipheriv, createDecipheriv } from "node:crypto";

const random = () => randomBytes(32).toString("base64url");
const hash = value => createHash("sha256").update(value).digest("base64url");
const fail = message => { throw new Error(message); };

// Identity-only login. X tokens are used once to fetch the profile, never stored.
export function createAuthService({ store, clientId, clientSecret, origin, botHandle, tokenEncryptionKey, fetcher = fetch, now = Date.now }) {
  if (origin) {
    const url = new URL(origin);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.origin !== origin || url.username || url.password || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) {
      fail("APP_ORIGIN must be an HTTPS origin (HTTP is allowed only for localhost).");
    }
  }
  const configured = Boolean(clientId && clientSecret && origin);
  const key = /^[a-f0-9]{64}$/i.test(tokenEncryptionKey || "") ? Buffer.from(tokenEncryptionKey, "hex") : null;
  const botConfigured = Boolean(configured && key && /^[A-Za-z0-9_]{1,15}$/.test(botHandle || ""));
  const seal = value => {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from("tagtip:x-bot:v1"));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") };
  };
  const open = value => {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
    decipher.setAAD(Buffer.from("tagtip:x-bot:v1"));
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, "base64")), decipher.final()]).toString());
  };
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
    botConfigured,
    async botStatus() {
      const bot = (await load()).bot;
      return { configured: botConfigured, connected: Boolean(botConfigured && bot), account: bot?.account || null };
    },
    async botAccessToken() {
      if (!botConfigured) fail("Bot authorization is not configured.");
      const state = await load();
      if (!state.bot) fail("Bot account is not connected.");
      const tokens = open(state.bot.tokens);
      if (tokens.expiresAt > now() + 60_000) return tokens.accessToken;
      const response = await fetcher("https://api.x.com/2/oauth2/token", {
        method: "POST", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString("base64")}` },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refreshToken }).toString(),
      });
      if (!response.ok) fail("Bot authorization needs reconnecting.");
      const token = await response.json();
      if (!token.access_token || !Number.isFinite(token.expires_in) || token.expires_in <= 0) fail("Invalid refreshed bot authorization.");
      state.bot.tokens = seal({ accessToken: token.access_token, refreshToken: token.refresh_token || tokens.refreshToken, expiresAt: now() + token.expires_in * 1000 });
      await store.save(state);
      return token.access_token;
    },
    async start({ bot = false } = {}) {
      if (!configured) fail("X login is not configured.");
      if (bot && !botConfigured) fail("Bot authorization is not configured.");
      const state = await load();
      const nonce = random(), browser = random(), verifier = random();
      state.flows[hash(nonce)] = { browserHash: hash(browser), verifier, bot, expiresAt: now() + 600_000 };
      await store.save(state);
      const url = new URL("https://x.com/i/oauth2/authorize");
      url.search = new URLSearchParams({ response_type: "code", client_id: clientId,
        redirect_uri: `${origin}/api/auth/x/callback`, scope: bot ? "tweet.read users.read tweet.write offline.access" : "tweet.read users.read",
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
      if (flow.bot) {
        if (!botConfigured || data.username.toLowerCase() !== botHandle.toLowerCase()) fail("Wrong bot account.");
        const scopes = new Set(String(token.scope || "").split(" "));
        if (!["tweet.read", "users.read", "tweet.write", "offline.access"].every(scope => scopes.has(scope)) || !token.refresh_token || !Number.isFinite(token.expires_in) || token.expires_in <= 0) fail("Incomplete bot authorization.");
        const latest = await load();
        if (latest.bot && latest.bot.account.id !== data.id) fail("Bot identity changed; operator intervention required.");
        latest.bot = { account: { id: data.id, username: data.username }, tokens: seal({ accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: now() + token.expires_in * 1000 }) };
        await store.save(latest);
        return { bot: true, cookies: [cookie("tagtip_oauth", "", 0)] };
      }
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
    async findId(id) { return (await load()).accounts[id] || null; },
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
