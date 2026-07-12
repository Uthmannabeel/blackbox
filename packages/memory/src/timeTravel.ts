import { getPool } from "./db.js";

/**
 * Memory time-travel and data-residency proofs — two things that fall out of
 * CockroachDB for free and are hard to replicate elsewhere.
 *
 *  - snapshotAsOf(): reads the memory corpus AS OF SYSTEM TIME a moment in the
 *    past. The agent's mind, rewound. Bounded by the GC window (~25h default).
 *  - residencyProof(): shows a memory physically pinned to its home region via
 *    crdb_region — data residency as a per-row property.
 */

export interface MemorySnapshot {
  asOfSeconds: number;
  asOf: string;
  total: number;
  sample: { id: string; kind: string; content: string; region: string; createdAt: string }[];
}

/** Read totals + a recent sample as of `secondsAgo` seconds in the past. */
export async function snapshotAsOf(secondsAgo: number): Promise<MemorySnapshot> {
  const s = Math.max(0, Math.min(86_400, Math.floor(secondsAgo)));
  const client = await getPool().connect();
  try {
    // BEGIN + SET TRANSACTION AS OF SYSTEM TIME in one round-trip. AOST reads a
    // consistent historical snapshot; `s` is a clamped integer, not user SQL.
    await client.query(s > 0 ? `BEGIN; SET TRANSACTION AS OF SYSTEM TIME '-${s}s'` : "BEGIN");
    // Inside the AOST transaction now() already returns the historical
    // timestamp, so don't subtract the offset again — that would double it.
    const nowRes = await client.query(`SELECT now()::string AS at`);
    const totalRes = await client.query(
      `SELECT (SELECT count(*) FROM incidents)
            + (SELECT count(*) FROM runbooks)
            + (SELECT count(*) FROM agent_memory) AS total`,
    );
    const sampleRes = await client.query(
      `SELECT id, kind, content, crdb_region::string AS region, created_at
         FROM agent_memory ORDER BY created_at DESC LIMIT 6`,
    );
    await client.query("COMMIT");
    return {
      asOfSeconds: s,
      asOf: nowRes.rows[0]?.at ?? "",
      total: Number(totalRes.rows[0]?.total ?? 0),
      sample: sampleRes.rows.map((r: any) => ({
        id: r.id,
        kind: r.kind,
        content: r.content,
        region: r.region,
        createdAt: r.created_at,
      })),
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection may be gone */
    }
    throw err;
  } finally {
    client.release();
  }
}

export interface ResidencyProof {
  region: string;
  gateway: string;
  incident: { id: string; title: string } | null;
  perRegion: { region: string; rows: number }[];
}

/** Prove that memories are pinned to their home region (data residency by row). */
export async function residencyProof(region = "aws-eu-west-1"): Promise<ResidencyProof> {
  const pool = getPool();
  const [sample, gateway, dist] = await Promise.all([
    pool.query(
      `SELECT id, title FROM incidents WHERE crdb_region = $1::crdb_internal_region
        ORDER BY opened_at DESC LIMIT 1`,
      [region],
    ),
    pool.query(`SELECT gateway_region() AS region`),
    pool.query(
      `SELECT crdb_region::string AS region, count(*)::int AS rows
         FROM incidents GROUP BY crdb_region ORDER BY region`,
    ),
  ]);
  return {
    region,
    gateway: gateway.rows[0]?.region ?? "unknown",
    incident: sample.rows[0] ? { id: sample.rows[0].id, title: sample.rows[0].title } : null,
    perRegion: dist.rows.map((r: any) => ({ region: r.region, rows: Number(r.rows) })),
  };
}
