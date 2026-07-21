// One-off audit: exact-duplicate incidents from non-idempotent seed re-runs.
//   node scripts/audit-dupes.mjs          — report only
//   node scripts/audit-dupes.mjs --fix    — delete dupes, keep earliest per group
import { getPool, closePool, loadEnv } from "../packages/memory/dist/index.js";

loadEnv();
const fix = process.argv.includes("--fix");
const pool = getPool();

const { rows: dupes } = await pool.query(`
  SELECT title, summary, count(*) AS n
    FROM incidents
   GROUP BY title, summary
  HAVING count(*) > 1
   ORDER BY n DESC`);
const extra = dupes.reduce((s, r) => s + Number(r.n) - 1, 0);
console.log(`duplicate groups: ${dupes.length}, redundant rows: ${extra}`);
for (const r of dupes.slice(0, 15)) console.log(`  x${r.n}  ${r.title.slice(0, 70)}`);

if (fix && extra > 0) {
  // Keep the earliest row of each (title, summary) group; never touch rows that
  // are referenced by live incident_state or carry postmortem provenance.
  const { rows } = await pool.query(`
    DELETE FROM incidents
     WHERE id IN (
       SELECT id FROM (
         SELECT id,
                row_number() OVER (PARTITION BY title, summary ORDER BY opened_at ASC, id ASC) AS rn
           FROM incidents
       ) WHERE rn > 1
     )
     AND id NOT IN (SELECT incident_id FROM incident_state)
     AND (signals->>'source' IS DISTINCT FROM 'public-postmortem')
     RETURNING id`);
  console.log(`deleted ${rows.length} duplicate rows`);
}
await closePool();
