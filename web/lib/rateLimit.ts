/**
 * Minimal fixed-window rate limiter (in-memory, per instance). Enough to
 * protect the demo endpoint from runaway loops / abuse. For multi-instance
 * production, back this with a shared store (Redis, or a CockroachDB table).
 */
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 20;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, now: number = Date.now()): RateLimitResult {
  // Opportunistic sweep so the map can't grow without bound.
  if (buckets.size > 5_000) {
    for (const [k, b] of buckets) {
      if (now >= b.resetAt) buckets.delete(k);
    }
  }

  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true, remaining: MAX_REQUESTS - 1, retryAfterSeconds: 0 };
  }

  if (bucket.count >= MAX_REQUESTS) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }

  bucket.count += 1;
  return { ok: true, remaining: MAX_REQUESTS - bucket.count, retryAfterSeconds: 0 };
}

/**
 * Client key for abuse control. Uses ONLY the platform-provided client IP
 * (`x-real-ip`, which Vercel sets to the true client and a client cannot
 * forge). We deliberately do NOT parse `x-forwarded-for` (a client can prepend
 * arbitrary values to it) or fall back to a client-supplied sessionId — either
 * would let an attacker rotate the value per request and bypass the caps that
 * protect the Bedrock budget. If no trusted IP is present (e.g. local dev), all
 * requests share one bucket — fail closed, not open.
 */
export function clientKey(headers: Headers): string {
  const ip = headers.get("x-real-ip")?.trim();
  return ip || "shared";
}
