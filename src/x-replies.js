const validId = value => typeof value === "string" && /^\d{1,30}$/.test(value);

export function createXReplySender({ token, enabled = false, store, fetcher = fetch, now = Date.now, maxPosts = 5 }) {
  const configured = enabled && typeof token === "string" && token.length >= 20;
  return {
    configured,
    async run() {
      if (!configured) throw new Error("X reply sender disabled or incomplete configuration.");
      const checkpoint = await store.load();
      if (!checkpoint?.replyOutbox || typeof checkpoint.replyOutbox !== "object") return { ok: true, attempted: 0, results: [] };
      let recovered = false;
      for (const item of Object.values(checkpoint.replyOutbox)) {
        if (item.status === "sending" && Date.parse(item.sendingAt) + 10 * 60_000 <= now()) {
          item.status = "unknown"; item.reason = "worker_stopped_during_send"; recovered = true;
        }
      }
      if (recovered) await store.save(checkpoint);
      const queue = Object.values(checkpoint.replyOutbox).filter(item => item.status === "pending" && (!item.nextAttemptAt || item.nextAttemptAt <= now()))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, maxPosts);
      const results = [];
      for (const item of queue) {
        if (!validId(item.replyToPostId) || typeof item.text !== "string" || !item.text || item.text.length > 280) {
          item.status = "failed"; item.reason = "invalid_outbox_record"; results.push({ id: item.id, status: item.status }); await store.save(checkpoint); continue;
        }
        item.status = "sending"; item.sendingAt = new Date(now()).toISOString();
        await store.save(checkpoint);
        let response;
        try {
          response = await fetcher("https://api.x.com/2/tweets", { method: "POST", signal: AbortSignal.timeout(8_000),
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ text: item.text, reply: { in_reply_to_tweet_id: item.replyToPostId } }) });
        } catch {
          item.status = "unknown"; item.reason = "network_outcome_unknown"; await store.save(checkpoint);
          results.push({ id: item.id, status: item.status }); continue;
        }
        if (response.status === 429) {
          item.status = "pending";
          const reset = Number(response.headers?.get("x-rate-limit-reset")) * 1000;
          item.nextAttemptAt = Math.max(now() + 60_000, Number.isFinite(reset) ? reset : 0);
        } else if (response.ok) {
          const body = await response.json();
          if (!validId(body.data?.id)) { item.status = "unknown"; item.reason = "success_response_missing_post_id"; }
          else { item.status = "sent"; item.postId = body.data.id; item.sentAt = new Date(now()).toISOString(); }
        } else if (response.status >= 500) {
          item.status = "unknown"; item.reason = `x_${response.status}_outcome_unknown`;
        } else {
          item.status = "failed"; item.reason = `x_${response.status}_rejected`;
        }
        await store.save(checkpoint);
        results.push({ id: item.id, status: item.status, postId: item.postId });
      }
      return { ok: true, attempted: results.length, recoveredUnknown: recovered, results };
    },
  };
}
