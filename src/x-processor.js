import { parseTipCommand } from "./core.js";

const validId = value => typeof value === "string" && /^\d{1,30}$/.test(value);
export function createXProcessor({ token, botId, botHandle = "TagTip", initialSinceId, enabled = false,
  store, applyEvent, fetcher = fetch, now = Date.now, maxCalls = 10 }) {
  const configured = enabled && Boolean(token) && validId(botId) && validId(initialSinceId) && /^[A-Za-z0-9_]{1,15}$/.test(botHandle);
  return {
    configured,
    async run() {
      if (!configured) throw new Error("X processor disabled or incomplete configuration.");
      const checkpoint = await store.load() || { sinceId: initialSinceId, lastRun: null, results: [] };
      checkpoint.pendingResults ||= {};
      if (checkpoint.nextAllowedAt > now()) return { ok: true, deferred: true, nextAllowedAt: checkpoint.nextAllowedAt };
      let calls = 0;
      async function get(url) {
        if (calls >= maxCalls) {
          checkpoint.nextAllowedAt = now() + 60_000;
          await store.save(checkpoint);
          throw new Error("X request budget reached. Progress retained; retry later.");
        }
        calls++;
        const response = await fetcher(url, { signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${token}` } });
        if (response.status === 429) {
          const reset = Number(response.headers?.get("x-rate-limit-reset")) * 1000;
          checkpoint.nextAllowedAt = Math.max(now() + 60_000, Number.isFinite(reset) ? reset : 0);
          await store.save(checkpoint);
          throw new Error("X rate limit reached. Processor paused until the reset time.");
        }
        if (!response.ok) throw new Error(`X API request failed (${response.status}). Checkpoint retained.`);
        const body = await response.json();
        if (body.errors?.length) throw new Error("X returned partial errors. Checkpoint retained.");
        return body;
      }
      const posts = [];
      let pagination;
      for (let page = 0; page < 3; page++) {
        const url = new URL(`https://api.x.com/2/users/${botId}/mentions`);
        url.search = new URLSearchParams({ since_id: checkpoint.sinceId, max_results: "100", "post.fields": "created_at", expansions: "author_id" }).toString();
        if (pagination) url.searchParams.set("pagination_token", pagination);
        const body = await get(url.href);
        for (const post of body.data || []) {
          if (!validId(post.id) || !validId(post.author_id) || typeof post.text !== "string") throw new Error("Invalid X event payload.");
          if (BigInt(post.id) > BigInt(checkpoint.sinceId)) posts.push(post);
        }
        pagination = body.meta?.next_token;
        if (!pagination) break;
      }
      if (pagination) throw new Error("Mention backlog exceeds three pages. No commands applied; checkpoint retained.");
      posts.sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);
      const results = [];
      for (const post of posts) {
        if (checkpoint.pendingResults[post.id]) { results.push(checkpoint.pendingResults[post.id]); continue; }
        // Normalize only the configured bot mention, preserving the strict grammar.
        const normalized = post.text.replace(new RegExp(`^@${botHandle}\\b`, "i"), "@TagTip");
        const command = parseTipCommand(normalized);
        if (!command.ok || post.author_id === botId) { results.push({ tweetId: post.id, status: "ignored" }); continue; }
        const lookup = await get(`https://api.x.com/2/users/by/username/${command.recipient.slice(1)}`);
        if (!validId(lookup.data?.id) || !/^[A-Za-z0-9_]{1,15}$/.test(lookup.data?.username || "")) throw new Error("Recipient identity could not be resolved.");
        const result = await applyEvent({ tweetId: post.id, senderId: post.author_id,
          recipientId: lookup.data.id, recipientHandle: lookup.data.username, amount: String(command.amount) });
        const receipt = { tweetId: post.id, ...result };
        results.push(receipt);
        checkpoint.pendingResults[post.id] = receipt;
        await store.save(checkpoint);
      }
      if (posts.length) checkpoint.sinceId = posts.at(-1).id;
      checkpoint.lastRun = new Date(now()).toISOString();
      checkpoint.nextAllowedAt = now() + 60_000;
      checkpoint.results = [...checkpoint.results, ...results].slice(-100);
      checkpoint.pendingResults = {};
      await store.save(checkpoint);
      return { ok: true, mode: "sandbox", realFundsEnabled: false, xCalls: calls, processed: results.length, results, sinceId: checkpoint.sinceId };
    },
  };
}
