// Live check of the Agent-Skill-based health procedure (reviewing-cluster-health, Standard tier).
// Usage: NODE_OPTIONS=--use-system-ca DB_CONNECT_TIMEOUT_MS=45000 node scripts/check-skill-health.mjs
import { standardTierHealthCheck, closePool } from "../packages/memory/dist/index.js";

const r = await standardTierHealthCheck();
console.log(r.citation);
for (const c of r.checks) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`);
console.log(r.allOk ? "all checks pass" : "some checks failed");
await closePool();
