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

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

/**
 * C-SPANN beam width: how many partitions a vector search visits. Higher =
 * better recall, more work. Applied once per physical connection (below)
 * rather than per query: `SET LOCAL` needs an explicit transaction, and
 * BEGIN + SET LOCAL + COMMIT cost three extra round trips to a cross-region
 * managed cluster — measured at ~380ms per recall, which is pure overhead
 * when every connection in this pool wants the same value anyway.
 */
export function beamSize(): number {
  const raw = process.env.VECTOR_BEAM_SIZE;
  if (raw === "0") return 0; // escape hatch: leave the server default alone
  const requested = Math.floor(Number(raw ?? 64));
  return Math.max(1, Math.min(2048, Number.isFinite(requested) ? requested : 64));
}

export function getPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set (see .env.example)");
  }

  const beam = beamSize();

  pool = new Pool({
    connectionString,
    // Ship the beam size in the startup packet rather than issuing a SET after
    // connecting: a post-connect SET races the borrower's first query (the pool
    // hands the client out before the listener resolves), and costs a round
    // trip. Set VECTOR_BEAM_SIZE=0 to fall back to the server default.
    ...(beam > 0 ? { options: `-c vector_search_beam_size=${beam}` } : {}),
    // On Vercel every serverless instance keeps its own pool, so a burst of N
    // instances holds up to max*N connections against the cluster's limit —
    // keep max small. CockroachDB also prefers fewer, well-used connections.
    max: 3,
    idleTimeoutMillis: 30_000,
    // Fail fast instead of hanging on connect when a region is partitioned.
    // Overridable for environments behind slow TLS-intercepting proxies where
    // the handshake alone can take tens of seconds (local ops scripts).
    connectionTimeoutMillis: envInt("DB_CONNECT_TIMEOUT_MS", 5_000),
    keepAlive: true,
    // Let a frozen/idle serverless instance release its connections cleanly.
    allowExitOnIdle: true,
    // CockroachDB Cloud requires TLS. verify-full is enforced via the URL.
    application_name: "blackbox",
  });

  pool.on("error", (err) => {
    // A region can vanish mid-query; log and let callers retry idempotently.
    console.error("[db] idle client error:", err.message);
  });

  return pool;
}

/**
 * Open the pool and complete a round trip before anything is timed.
 * Serverless instances start cold: the first query pays TLS handshake +
 * authentication + session setup against a cross-region cluster. Folding that
 * into a "recall latency" measurement reports connection setup as if it were
 * search time. Callers that publish latency numbers must warm first.
 */
export async function warmPool(): Promise<void> {
  await getPool().query("SELECT 1");
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
