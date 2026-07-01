import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getPool, closePool } from "../db.js";

/**
 * Apply db/schema.sql to the configured CockroachDB cluster.
 * Idempotent: every statement uses IF NOT EXISTS.
 *
 * Usage: npm run db:schema
 */
const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, "../../../../db/schema.sql");

async function main() {
  const sql = await readFile(schemaPath, "utf8");
  console.log(`Applying schema from ${schemaPath} ...`);
  await getPool().query(sql);
  console.log("✓ Schema applied.");
}

main()
  .catch((err) => {
    console.error("✗ Schema apply failed:", err);
    process.exitCode = 1;
  })
  .finally(closePool);
