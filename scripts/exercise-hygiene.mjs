// Live end-to-end exercise of the gated learning loop against the real cluster.
// Leaves genuine hygiene events (accepted -> merged -> rejected) in the store.
// Usage: NODE_OPTIONS=--use-system-ca DB_CONNECT_TIMEOUT_MS=45000 node scripts/exercise-hygiene.mjs
import { MemoryService, closePool } from "../packages/memory/dist/index.js";

const memory = new MemoryService();

const FIX =
  "Raised pgbouncer default_pool_size from 200 to 400 for checkout-api, recycled stuck server " +
  "connections, and added a saturation alert at 80 percent so pool exhaustion pages before requests queue.";

console.log("1) commit a substantive learned fix (expect: accepted)");
const first = await memory.commitLearnedRunbook({
  incidentId: "00000000-0000-0000-0000-000000000001",
  title: "Learned runbook: checkout-api connection pool exhaustion",
  body: FIX,
  tags: ["learned", "auto-postmortem"],
});
console.log("   ->", first.action, "-", first.detail);

console.log("2) re-learn the same fix (expect: merged/consolidated)");
const second = await memory.commitLearnedRunbook({
  incidentId: "00000000-0000-0000-0000-000000000002",
  title: "Learned runbook: checkout-api connection pool exhaustion",
  body: FIX,
  tags: ["learned", "auto-postmortem"],
});
console.log("   ->", second.action, "-", second.detail);

console.log("3) commit an inadmissible resolution (expect: rejected)");
const third = await memory.commitLearnedRunbook({
  incidentId: "00000000-0000-0000-0000-000000000003",
  title: "Learned runbook: intermittent 502s",
  body: "not sure what happened, it recovered on its own after a while",
});
console.log("   ->", third.action, "-", third.detail);

console.log("4) recall-visibility: gated knowledge is recallable");
const hits = await memory.recallRunbooks("connection pool exhausted, requests queueing", 3);
for (const h of hits)
  console.log(`   ${h.distance.toFixed(3)} [${h.item.source}/${h.item.confidence}] ${h.item.title}`);

console.log("5) recent hygiene events");
for (const e of await memory.recentHygieneEvents(5)) console.log(`   ${e.action}: ${e.detail}`);

await closePool();
