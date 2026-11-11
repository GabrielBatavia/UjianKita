/**
 * Sliding-window rate limiter for Phase 1 sensitive endpoints (login, password reset,
 * and administrative write endpoints).
 *
 * Architectural note: In multi-instance serverless deployments (e.g. Vercel),
 * in-memory state limits bursts per active warm instance. Phase 2 should pair
 * this with a centralized store (Supabase rate-limit RPC or Upstash) for global
 * enforcement across concurrent lambdas.
 */

interface BucketEntry {
  timestamps: number[];
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

const buckets = new Map<string, BucketEntry>();

export function checkRateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
  nowMs?: number;
}): RateLimitResult {
  const now = params.nowMs ?? Date.now();
  const windowStart = now - params.windowMs;

  const existing = buckets.get(params.key);
  const activeTimestamps = (existing?.timestamps ?? []).filter((ts) => ts > windowStart);

  if (activeTimestamps.length >= params.limit) {
    const oldest = activeTimestamps[0] ?? now;
    const retryAfterMs = Math.max(1000, oldest + params.windowMs - now);
    buckets.set(params.key, { timestamps: activeTimestamps });
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    };
  }

  activeTimestamps.push(now);
  buckets.set(params.key, { timestamps: activeTimestamps });

  // Prune stale keys periodically to bound memory growth
  if (buckets.size > 5000) {
    for (const [k, entry] of buckets.entries()) {
      const latest = entry.timestamps[entry.timestamps.length - 1];
      if (!latest || latest <= windowStart) {
        buckets.delete(k);
      }
    }
  }

  return {
    allowed: true,
    remaining: Math.max(0, params.limit - activeTimestamps.length),
    retryAfterSeconds: 0,
  };
}

export function resetRateLimitForTests(): void {
  buckets.clear();
}
