import { getPool, closePool, toVectorLiteral } from "../db.js";
import { embed } from "../embeddings.js";
import { loadEnv } from "../env.js";
import { POSTMORTEM_SERVICE, PUBLIC_POSTMORTEMS } from "../postmortemData.js";

loadEnv();

/**
 * Ingest real public incident postmortems into episodic memory.
 * Idempotent: an entry whose source URL already exists in incidents.signals is
 * skipped, so re-running after a partial ingest (embedding throttle, network)
 * only fills the gaps. Usage: npm run db:ingest-postmortems
 */
async function main() {
  const pool = getPool();

  // Spread home regions like multi-gateway production writes would.
  const { rows: regionRows } = await pool.query(`SELECT region FROM [SHOW REGIONS FROM DATABASE]`);
  const regions: string[] = regionRows.map((r: any) => r.region);
  let rr = 0;
  const nextRegion = () => regions[rr++ % Math.max(1, regions.length)];

  const { rows: svcRows } = await pool.query(
    `INSERT INTO services (name, environment, owner_team)
     VALUES ($1, 'production', $2)
     ON CONFLICT (name, environment) DO UPDATE SET owner_team = excluded.owner_team
     RETURNING id`,
    [POSTMORTEM_SERVICE.name, POSTMORTEM_SERVICE.team],
  );
  const serviceId = svcRows[0].id;

  let inserted = 0;
  let skipped = 0;
  for (const pm of PUBLIC_POSTMORTEMS) {
    const { rows: existing } = await pool.query(
      `SELECT 1 FROM incidents WHERE signals->>'url' = $1 LIMIT 1`,
      [pm.url],
    );
    if (existing.length > 0) {
      skipped++;
      continue;
    }

    const embedding = await embed(`${pm.title}\n\n${pm.summary}`);
    const signals = JSON.stringify({
      source: "public-postmortem",
      company: pm.company,
      url: pm.url,
      year: Number(pm.date.slice(0, 4)),
    });
    await pool.query(
      `INSERT INTO incidents
         (crdb_region, service_id, title, summary, severity, status, signals,
          resolution, embedding, opened_at, resolved_at)
       VALUES ($8::crdb_internal_region, $1, $2, $3, $4, 'resolved', $5, $6, $7,
               $9::TIMESTAMPTZ, $9::TIMESTAMPTZ)`,
      [
        serviceId,
        `${pm.company} (${pm.date.slice(0, 4)}): ${pm.title}`,
        pm.summary,
        pm.severity,
        signals,
        pm.resolution,
        toVectorLiteral(embedding),
        nextRegion(),
        pm.date,
      ],
    );
    inserted++;
    console.log(`  + ${pm.company} ${pm.date}: ${pm.title}`);
  }

  console.log(
    `✓ Public postmortems ingested: ${inserted} new, ${skipped} already present (${PUBLIC_POSTMORTEMS.length} total).`,
  );
}

main()
  .catch((err) => {
    console.error("✗ Ingest failed:", err);
    process.exitCode = 1;
  })
  .finally(closePool);
