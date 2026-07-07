import { getPool } from "./db.js";

/**
 * Durable rate limiter backed by CockroachDB.
 *
 * The in-memory limiter was useless on serverless (each invocation is a fresh
 * instance, so the counter resets). This keeps the window in the same database
 * that stores everything else — one atomic UPSERT per check, correct across
 * every serverless instance, and on-theme (one system of record).
 */
let ready = false;

async function ensure(): Promise<void> {
  if (ready) return;
  await getPool().query(
    `CREATE TABLE IF NOT EXISTS rate_limits (
       bucket       STRING PRIMARY KEY,
       window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
       count        INT NOT NULL DEFAULT 0
     )`,
  );
  ready = true;
}

export interface RateResult {
  ok: boolean;
  count: number;
  limit: number;
}

/**
 * Atomically record a hit for `bucket` and report whether it's within `limit`
 * over a rolling `windowSeconds` window. The window resets in the same
 * statement when it has expired — race-safe under concurrency.
 */
export async function hitRateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<RateResult> {
  await ensure();
  const { rows } = await getPool().query(
    `INSERT INTO rate_limits (bucket, window_start, count)
     VALUES ($1, now(), 1)
     ON CONFLICT (bucket) DO UPDATE SET
       window_start = CASE WHEN rate_limits.window_start < now() - ($2 || 's')::INTERVAL
                           THEN now() ELSE rate_limits.window_start END,
       count = CASE WHEN rate_limits.window_start < now() - ($2 || 's')::INTERVAL
                    THEN 1 ELSE rate_limits.count + 1 END
     RETURNING count`,
    [bucket, String(Math.floor(windowSeconds))],
  );
  const count = Number(rows[0]?.count ?? 0);
  return { ok: count <= limit, count, limit };
}
