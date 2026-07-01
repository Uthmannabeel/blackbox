import { getPool, closePool, toVectorLiteral } from "../db.js";
import { embed } from "../embeddings.js";
import { loadEnv } from "../env.js";
import { HISTORICAL_INCIDENTS, RUNBOOKS, SERVICES } from "../seedData.js";

loadEnv();

/**
 * Seed a sample fleet, resolved historical incidents (embedded for recall), and
 * remediation runbooks into CockroachDB.  Usage: npm run db:seed
 */
async function main() {
  const pool = getPool();

  console.log("Seeding services ...");
  const serviceIds = new Map<string, string>();
  for (const s of SERVICES) {
    const { rows } = await pool.query(
      `INSERT INTO services (name, environment, owner_team)
       VALUES ($1, 'production', $2)
       ON CONFLICT (name, environment) DO UPDATE SET owner_team = excluded.owner_team
       RETURNING id`,
      [s.name, s.team],
    );
    serviceIds.set(s.name, rows[0].id);
  }

  console.log("Seeding historical incidents (embedding each) ...");
  for (const inc of HISTORICAL_INCIDENTS) {
    const embedding = await embed(`${inc.title}\n\n${inc.summary}`);
    await pool.query(
      `INSERT INTO incidents
         (service_id, title, summary, severity, status, resolution, embedding, resolved_at)
       VALUES ($1, $2, $3, $4, 'resolved', $5, $6, now())`,
      [
        serviceIds.get(inc.service),
        inc.title,
        inc.summary,
        inc.severity,
        inc.resolution,
        toVectorLiteral(embedding),
      ],
    );
  }

  console.log("Seeding runbooks (embedding each) ...");
  for (const rb of RUNBOOKS) {
    const embedding = await embed(`${rb.title}\n\n${rb.body}`);
    await pool.query(
      `INSERT INTO runbooks (title, body, tags, embedding) VALUES ($1, $2, $3, $4)`,
      [rb.title, rb.body, rb.tags, toVectorLiteral(embedding)],
    );
  }

  console.log("✓ Seed complete.");
}

main()
  .catch((err) => {
    console.error("✗ Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(closePool);
