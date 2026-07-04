import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Pool } from "pg";
import { loadEnv } from "../env.js";

loadEnv();

/**
 * One-shot setup for the LOCAL CHAOS RIG (a `cockroach demo --global` cluster):
 *   1. discovers the cluster's regions,
 *   2. creates a multi-region `blackbox` database with SURVIVE REGION FAILURE,
 *   3. applies db/schema.sql.
 *
 * Works against any CockroachDB, but is written for the local demo cluster —
 * pass the connection URL the demo shell prints:
 *
 *   node packages/memory/dist/scripts/chaosSetup.js "<demo sql url>"
 *
 * Region names are discovered, not assumed, so the same script also works
 * against a real CockroachDB Cloud cluster later.
 */

const rawUrl = process.argv[2] ?? process.env.DATABASE_URL;
if (!rawUrl) {
  console.error("Usage: chaosSetup <connection-url>   (or set DATABASE_URL)");
  process.exit(1);
}

/** For local self-signed demo certs, disable verification (local rig only). */
function normalize(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  const local = u.hostname === "127.0.0.1" || u.hostname === "localhost";
  if (local && u.searchParams.get("sslmode") === "require") {
    u.searchParams.set("sslmode", "no-verify");
  }
  return u.toString();
}

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, "../../../../db/schema.sql");

async function main() {
  // Phase 1: cluster-level setup from the default database.
  const admin = new Pool({ connectionString: normalize(rawUrl!, "defaultdb"), max: 2 });
  try {
    const { rows: regionRows } = await admin.query(`SHOW REGIONS FROM CLUSTER`);
    let regions: string[] = regionRows.map((r: any) => r.region);
    // Prefer a us-east region as primary (closest to Bedrock + our gateway).
    const preferred = regions.find((r) => r.includes("us-east"));
    if (preferred) regions = [preferred, ...regions.filter((r) => r !== preferred)];
    if (regions.length < 3) {
      throw new Error(
        `Cluster reports ${regions.length} region(s); SURVIVE REGION FAILURE needs >= 3. ` +
          `Start the rig with: cockroach demo --global --nodes 9`,
      );
    }
    console.log(`Cluster regions: ${regions.join(", ")}`);

    await admin.query(`CREATE DATABASE IF NOT EXISTS blackbox`);
    await admin.query(`ALTER DATABASE blackbox SET PRIMARY REGION "${regions[0]}"`);
    for (const r of regions.slice(1)) {
      await admin.query(`ALTER DATABASE blackbox ADD REGION IF NOT EXISTS "${r}"`);
    }
    await admin.query(`ALTER DATABASE blackbox SURVIVE REGION FAILURE`);
    console.log(`✓ blackbox is multi-region (primary ${regions[0]}) and survives region failure.`);
  } finally {
    await admin.end();
  }

  // Phase 2: apply the memory schema inside the blackbox database.
  const blackboxUrl = normalize(rawUrl!, "blackbox");
  const db = new Pool({ connectionString: blackboxUrl, max: 2 });
  try {
    const sql = await readFile(schemaPath, "utf8");
    await db.query(sql);
    console.log("✓ Schema applied (regional-by-row tables + vector indexes).");
  } finally {
    await db.end();
  }

  console.log("\nNext steps:");
  console.log(`  1. Put this in .env:  DATABASE_URL="${blackboxUrl}"`);
  console.log("  2. Seed:   $env:BLACKBOX_MOCK_EMBEDDINGS='1'; npm run db:seed; npm run db:seed:scale");
  console.log("  3. Chaos:  in the demo shell, \\demo shutdown <node>  — memory survives.");
}

main().catch((err) => {
  console.error("✗ Chaos setup failed:", err.message ?? err);
  process.exit(1);
});
