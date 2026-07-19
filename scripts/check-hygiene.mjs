// Quick live-cluster smoke for the memory hygiene layer.
// Usage: NODE_OPTIONS=--use-system-ca DB_CONNECT_TIMEOUT_MS=45000 node scripts/check-hygiene.mjs
import { getPool, closePool } from "../packages/memory/dist/index.js";

const pool = getPool();

const cols = await pool.query(
  `SELECT column_name FROM information_schema.columns
    WHERE table_name = 'runbooks' AND column_name IN
      ('source','status','confidence','recall_count','reinforced_count','last_recalled_at')
    ORDER BY column_name`,
);
console.log("runbooks hygiene columns:", cols.rows.map((r) => r.column_name).join(", "));

const comp = await pool.query(
  `SELECT source, status, COUNT(*)::INT AS n, ROUND(AVG(confidence)::NUMERIC,2) AS avg_conf
     FROM runbooks GROUP BY source, status ORDER BY source, status`,
);
console.log("knowledge base composition:");
for (const r of comp.rows) console.log(`  ${r.source}/${r.status}: ${r.n} (avg confidence ${r.avg_conf})`);

const learned = await pool.query(
  `SELECT title, confidence, recall_count, reinforced_count, updated_at::DATE AS updated
     FROM runbooks WHERE source = 'learned' OR title ILIKE 'learned%' ORDER BY updated_at DESC LIMIT 10`,
);
console.log(`learned-titled runbooks (${learned.rows.length}):`);
for (const r of learned.rows)
  console.log(`  [${r.confidence}] ${r.title} (recalls ${r.recall_count}, reinforced ${r.reinforced_count}, ${r.updated})`);

const ev = await pool.query(`SELECT COUNT(*)::INT AS n FROM memory_hygiene_events`);
console.log("hygiene events:", ev.rows[0].n);

await closePool();
