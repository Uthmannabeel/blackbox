import { closePool, getPool, toVectorLiteral } from "../db.js";
import { embed } from "../embeddings.js";
import { loadEnv } from "../env.js";

loadEnv();

/**
 * Migration: split the conversational stream out of semantic memory.
 *
 * `agent_memory` used to hold both embedded reflections AND high-volume
 * conversational rows. The conversational rows had no useful embedding, so they
 * were written with a placeholder zero vector — which polluted the C-SPANN
 * index and forced recall to post-filter them with `kind NOT IN (...)`, a
 * predicate the vector index cannot serve. On the live corpus that predicate
 * excluded every row, so `recall_memories` could only ever return nothing.
 *
 * This moves the stream kinds into `agent_stream` (no vector column) and
 * removes them from `agent_memory`, preserving id, region, timestamps and all
 * content. Idempotent: re-running it is a no-op once the stream rows are gone.
 *
 *   npm run db:migrate:stream
 */

const STREAM_KINDS = ["user_msg", "agent_msg", "observation", "action"];

async function main() {
  const pool = getPool();

  console.log("Ensuring agent_stream exists ...");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_stream (
        id          UUID NOT NULL DEFAULT gen_random_uuid(),
        session_id  UUID NOT NULL,
        incident_id UUID,
        kind        STRING NOT NULL,
        content     STRING NOT NULL,
        importance  FLOAT NOT NULL DEFAULT 0.5,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        crdb_region crdb_internal_region NOT NULL DEFAULT default_to_database_primary_region(gateway_region())::crdb_internal_region,
        CONSTRAINT agent_stream_pkey PRIMARY KEY (crdb_region, id),
        INDEX agent_stream_recent_idx (created_at DESC),
        INDEX agent_stream_session_idx (session_id, created_at DESC)
    ) LOCALITY REGIONAL BY ROW`);

  console.log("Ensuring runbooks.origin exists ...");
  await pool.query(
    `ALTER TABLE runbooks ADD COLUMN IF NOT EXISTS origin STRING NOT NULL DEFAULT 'trusted'`,
  );

  const { rows: before } = await pool.query(
    `SELECT count(*)::int AS n FROM agent_memory WHERE kind = ANY($1)`,
    [STREAM_KINDS],
  );
  const pending = Number(before[0]?.n ?? 0);
  console.log(`Stream rows still living in agent_memory: ${pending}`);

  if (pending > 0) {
    // One transaction: the rows exist in exactly one table at every instant.
    // crdb_region is carried across so a memory does not change home region
    // just because it changed table.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const moved = await client.query(
        `INSERT INTO agent_stream
           (crdb_region, id, session_id, incident_id, kind, content, importance, created_at)
         SELECT crdb_region, id, session_id, incident_id, kind, content, importance, created_at
           FROM agent_memory WHERE kind = ANY($1)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [STREAM_KINDS],
      );
      const removed = await client.query(
        `DELETE FROM agent_memory WHERE kind = ANY($1) RETURNING id`,
        [STREAM_KINDS],
      );
      await client.query("COMMIT");
      console.log(`  moved ${moved.rows.length}, removed ${removed.rows.length}`);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // Backfill semantic memory from the REAL public postmortems. Each one is a
  // genuinely resolved incident with a genuine resolution, so a reflection
  // distilled from it is real durable knowledge, not synthetic filler — and it
  // gives recall_memories a defensible corpus from the first request rather
  // than an empty table waiting for someone to resolve something.
  const { rows: candidates } = await pool.query(
    `SELECT i.id, i.title, i.resolution
       FROM incidents i
      WHERE i.signals->>'source' = 'public-postmortem'
        AND i.resolution IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM agent_memory m
           WHERE m.incident_id = i.id AND m.kind = 'reflection'
        )`,
  );
  if (candidates.length > 0) {
    console.log(`\nBackfilling ${candidates.length} reflection(s) from real postmortems ...`);
    // A fixed session id so these are identifiable as the seeded baseline.
    const SEED_SESSION = "00000000-0000-4000-8000-000000000001";
    let done = 0;
    for (const c of candidates) {
      const content = `Resolved "${c.title}". Learned: ${c.resolution}`;
      await pool.query(
        `INSERT INTO agent_memory (session_id, incident_id, kind, content, importance, embedding)
         VALUES ($1, $2, 'reflection', $3, 0.85, $4)`,
        [SEED_SESSION, c.id, content, toVectorLiteral(await embed(content))],
      );
      done++;
      if (done % 5 === 0) console.log(`  ${done}/${candidates.length}`);
    }
    console.log(`  backfilled ${done}`);
  }

  const { rows: after } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM agent_memory) AS semantic,
       (SELECT count(*)::int FROM agent_stream) AS stream,
       (SELECT count(*)::int FROM agent_memory WHERE kind = ANY($1)) AS leftover`,
    [STREAM_KINDS],
  );
  const a = after[0];
  console.log(
    `\nagent_memory (semantic, recallable): ${a.semantic}` +
      `\nagent_stream (conversational):      ${a.stream}` +
      `\nstream rows left in agent_memory:   ${a.leftover}`,
  );
  if (Number(a.leftover) !== 0) throw new Error("migration incomplete: stream rows remain");
  console.log("\n✓ Migration complete.");
}

main()
  .catch((err) => {
    console.error("✗ Migration failed:", err);
    process.exitCode = 1;
  })
  .finally(closePool);
