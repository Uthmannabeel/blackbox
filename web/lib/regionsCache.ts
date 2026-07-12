/**
 * Tiny per-instance cache for the /api/regions live response. Shared as a
 * module so the chaos route can invalidate it the instant it drains a region —
 * otherwise a stale topology (up to CACHE_TTL old) makes the "kill region"
 * button look like a no-op until the cache expires.
 */
const CACHE_TTL = 10_000;

let entry: { at: number; body: unknown } | null = null;

export function getRegionsCache(): unknown | null {
  if (entry && Date.now() - entry.at < CACHE_TTL) return entry.body;
  return null;
}

export function setRegionsCache(body: unknown): void {
  entry = { at: Date.now(), body };
}

export function bustRegionsCache(): void {
  entry = null;
}
