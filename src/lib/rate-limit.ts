import { createHash } from "node:crypto";
import { getPublicEnvStatus } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Sliding-window & distributed PostgreSQL rate limiter.
 *
 * Authentication endpoints use PostgreSQL-backed `consume_rate_limit` via
 * `service_role` so counters are shared across Vercel serverless instances
 * without extra paid Redis services, falling back to in-memory sliding windows
 * in offline/mocked environments.
 */

interface BucketEntry {
  timestamps: number[];
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  source?: "postgres" | "memory";
}

const buckets = new Map<string, BucketEntry>();

export function hashRateLimitIdentifier(rawValue: string): string {
  return createHash("sha256").update(rawValue.trim().toLowerCase()).digest("hex").slice(0, 32);
}

export function checkRateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
  nowMs?: number;
  increment?: boolean;
}): RateLimitResult {
  const now = params.nowMs ?? Date.now();
  const windowStart = now - params.windowMs;
  const shouldIncrement = params.increment !== false;

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
      source: "memory",
    };
  }

  if (shouldIncrement) {
    activeTimestamps.push(now);
    buckets.set(params.key, { timestamps: activeTimestamps });
  } else if (existing) {
    buckets.set(params.key, { timestamps: activeTimestamps });
  }

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
    source: "memory",
  };
}

function canUsePostgresRateLimitStore(): boolean {
  const status = getPublicEnvStatus();
  return (
    status.configured &&
    status.serviceRoleConfigured &&
    Boolean(status.supabaseUrl) &&
    !status.supabaseUrl!.includes("example.supabase.co")
  );
}

export async function checkDistributedRateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
  increment?: boolean;
}): Promise<RateLimitResult> {
  const shouldIncrement = params.increment !== false;

  if (!canUsePostgresRateLimitStore()) {
    return checkRateLimit({
      key: params.key,
      limit: params.limit,
      windowMs: params.windowMs,
      increment: shouldIncrement,
    });
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("consume_rate_limit", {
      p_bucket_key: params.key,
      p_limit: params.limit,
      p_window_ms: params.windowMs,
      p_increment: shouldIncrement,
    });

    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row || typeof row.allowed !== "boolean") {
      return checkRateLimit({
        key: params.key,
        limit: params.limit,
        windowMs: params.windowMs,
        increment: shouldIncrement,
      });
    }

    return {
      allowed: Boolean(row.allowed),
      remaining: Number(row.remaining ?? 0),
      retryAfterSeconds: Number(row.retry_after_seconds ?? 0),
      source: "postgres",
    };
  } catch {
    return checkRateLimit({
      key: params.key,
      limit: params.limit,
      windowMs: params.windowMs,
      increment: shouldIncrement,
    });
  }
}

export async function resetDistributedRateLimit(key: string): Promise<void> {
  buckets.delete(key);
  if (!canUsePostgresRateLimitStore()) return;
  try {
    const admin = createSupabaseAdminClient();
    await admin.rpc("reset_rate_limit_bucket", { p_bucket_key: key });
  } catch {
    // Non-blocking reset
  }
}

export function resetRateLimitForTests(): void {
  buckets.clear();
}
