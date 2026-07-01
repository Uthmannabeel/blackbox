import { Pool, types } from "pg";
import "./env.js";

/**
 * A single shared connection pool to CockroachDB.
 *
 * CockroachDB speaks the PostgreSQL wire protocol, so the standard `pg` driver
 * works unchanged. In a multi-region cluster the DATABASE_URL points at the
 * nearest gateway; each `REGIONAL BY ROW` row is served from its home region.
 */
let pool: Pool | undefined;

export function getPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set (see .env.example)");
  }

  pool = new Pool({
    connectionString,
    // Keep the pool modest; CockroachDB prefers fewer, well-used connections.
    max: 10,
    idleTimeoutMillis: 30_000,
    // CockroachDB Cloud requires TLS. verify-full is enforced via the URL.
    application_name: "blackbox",
  });

  pool.on("error", (err) => {
    // A region can vanish mid-query; log and let callers retry idempotently.
    console.error("[db] idle client error:", err.message);
  });

  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

/**
 * Format a JS number[] as a CockroachDB/pgvector literal: '[1,2,3]'.
 * Used for both writes and `<=>` similarity queries.
 */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

// Ensure BIGINT/NUMERIC come back as strings, not lossy floats, where relevant.
types.setTypeParser(20, (v) => v); // int8 -> string
