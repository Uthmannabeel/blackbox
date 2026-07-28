import { closePool, getPool } from "../db.js";
import { loadEnv } from "../env.js";

loadEnv();

/**
 * Prune abandoned incidents: rows opened by a demo session that was closed
 * mid-investigation, so they sit `open` forever with no state and no
 * resolution. They are not memories — nothing was learned — and they inflate
 * the corpus with noise an operator would have closed out.
 *
 * Deliberately conservative:
 *  - only `status = 'open'`
 *  - only rows with NO incident_state (never even reached triage)
 *  - only older than AGE_DAYS (default 2)
 *  - dry-run by default; pass --apply to delete
 *
 *   npm run db:prune-abandoned            # report only
 *   npm run db:prune-abandoned -- --apply # actually delete
 */

const AGE_DAYS = Math.max(1, Number(process.env.PRUNE_AGE_DAYS ?? 2));
const APPLY = process.argv.includes("--apply");

const SELECTOR = `
  FROM incidents i
 WHERE i.status = 'open'
   AND i.resolution IS NULL
   AND i.opened_at < now() - ($1::INT * INTERVAL '1 day')
   AND NOT EXISTS (SELECT 1 FROM incident_state s WHERE s.incident_id = i.id)`;

async function main() {
  const pool = getPool();

  const { rows } = await pool.query(
    `SELECT i.id, i.title, i.opened_at, i.crdb_region::string AS region ${SELECTOR}
      ORDER BY i.opened_at LIMIT 100`,
    [AGE_DAYS],
  );

  if (rows.length === 0) {
    console.log(`No abandoned incidents older than ${AGE_DAYS} day(s).`);
    return;
  }

  console.log(`Abandoned incidents older than ${AGE_DAYS} day(s): ${rows.length}`);
  for (const r of rows) {
    console.log(`  ${r.opened_at.toISOString?.() ?? r.opened_at}  [${r.region}]  ${r.title}`);
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to delete these rows.");
    return;
  }

  const deleted = await pool.query(
    `DELETE FROM incidents WHERE id IN (SELECT i.id ${SELECTOR}) RETURNING id`,
    [AGE_DAYS],
  );
  console.log(`\n✓ Deleted ${deleted.rows.length} abandoned incident(s).`);
}

main()
  .catch((err) => {
    console.error("✗ Prune failed:", err);
    process.exitCode = 1;
  })
  .finally(closePool);
