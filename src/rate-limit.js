// Bounded per-instance abuse protection. Use a distributed edge limit before launch.
export function createRateLimiter({ now = Date.now, maxKeys = 10_000 } = {}) {
  const buckets = new Map();
  return {
    check(key, limit, windowMs = 60_000) {
      const time = now();
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= time) {
        if (buckets.size >= maxKeys) {
          for (const [oldKey, item] of buckets) if (item.resetAt <= time) buckets.delete(oldKey);
          if (buckets.size >= maxKeys && !buckets.has(key)) return { allowed: false, retryAfter: Math.ceil(windowMs / 1000) };
        }
        bucket = { count: 0, resetAt: time + windowMs }; buckets.set(key, bucket);
      }
      bucket.count++;
      return { allowed: bucket.count <= limit, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - time) / 1000)) };
    },
  };
}
