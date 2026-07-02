// Validate BlackBox's memory layer against the live cluster:
//   1. per-region row distribution (REGIONAL BY ROW is real)
//   2. query plan for semantic recall (C-SPANN vector index is serving it)
//   3. an actual recall through the app's MemoryService, timed
//
// Run before AND after killing a region — the point is that the output barely
// changes.
//
//   $env:DATABASE_URL="postgresql://root@127.0.0.1:26257/blackbox?sslmode=disable"
//   node infra/chaos/validate.mjs
process.env.BLACKBOX_MOCK_EMBEDDINGS ??= "1";

const { MemoryService, getPool, closePool, embed } = await import(
  "../../packages/memory/dist/index.js"
);

const pool = getPool();

console.log("── 1. Per-region memory distribution ──");
const dist = await pool.query(
  `SELECT m.crdb_region::string AS region, count(*)::int AS rows FROM (
     SELECT crdb_region FROM incidents
     UNION ALL SELECT crdb_region FROM runbooks
     UNION ALL SELECT crdb_region FROM agent_memory
   ) AS m GROUP BY m.crdb_region ORDER BY region`,
);
for (const r of dist.rows) console.log(`   ${r.region.padEnd(14)} ${r.rows} memories`);

console.log("\n── 2. Recall query plan (vector index?) ──");
const qvec = `[${(await embed("checkout latency spike, connection pool exhausted")).join(",")}]`;
const plan = await pool.query(
  `EXPLAIN SELECT id FROM incidents ORDER BY embedding <-> $1 LIMIT 5`,
  [qvec],
);
for (const r of plan.rows) console.log(`   ${r.info}`);

console.log("\n── 3. Timed recall through MemoryService ──");
const mem = new MemoryService();
const t0 = Date.now();
const hits = await mem.recallSimilarIncidents(
  "checkout latency is spiking and the connection pool is exhausted",
  5,
);
console.log(`   ${Date.now() - t0}ms for top-5 over the corpus:`);
for (const h of hits) {
  console.log(`   ${h.distance.toFixed(3)}  [${h.item.region.padEnd(12)}] ${h.item.title.slice(0, 64)}`);
}

await closePool();
console.log("\n✓ validation complete");
