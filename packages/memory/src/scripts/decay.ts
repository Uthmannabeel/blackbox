import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { closePool } from "../db.js";
import { MemoryService } from "../memory.js";

// Load repo-root .env (Node >=20.6 built-in).
try {
  const root = dirname(fileURLToPath(import.meta.url));
  (process as any).loadEnvFile?.(resolve(root, "../../../../.env"));
} catch {
  /* env may already be set */
}

/**
 * Memory maintenance: decay unused learned runbooks and archive the ones that
 * never earned trust. Safe to run any time (idempotent per day-window); in
 * production this would be a scheduled job.
 *
 * Usage: npm run db:decay
 */
async function main() {
  const memory = new MemoryService();
  const { decayed, archived } = await memory.decayRunbooks();
  console.log(`✓ Hygiene pass: ${decayed} learned runbook(s) decayed, ${archived} archived.`);
}

main()
  .catch((err) => {
    console.error("✗ Hygiene pass failed:", err);
    process.exitCode = 1;
  })
  .finally(closePool);
