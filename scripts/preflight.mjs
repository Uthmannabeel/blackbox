// Demo pre-flight: verify every video beat is live before recording.
//   node scripts/preflight.mjs [baseUrl]
const BASE = process.argv[2] || "https://blackbox-web-eight.vercel.app";
import { randomUUID } from "node:crypto";
const sid = randomUUID(); // session_id is a UUID column — must be valid
let pass = 0, fail = 0;
const ok = (c, m) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}`); c ? pass++ : fail++; return c; };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Agent turns take ~20s, and a TLS-intercepting corporate proxy will happily
 * drop a connection that idle. That is a network fact, not a failed check —
 * retry transport errors so pre-flight reports on the app, not the office wifi.
 */
async function withRetry(fn, label, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const cause = err?.cause?.code ?? err?.code ?? "";
      console.log(`  ....  ${label}: transport error${cause ? ` (${cause})` : ""}, retry ${i + 1}/${attempts - 1}`);
      await sleep(2000 * (i + 1));
    }
  }
  throw lastErr;
}

async function get(p) {
  return withRetry(async () => {
    const r = await fetch(BASE + p);
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }, p);
}
async function chat(message) {
  return withRetry(async () => {
    const r = await fetch(BASE + "/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid, message }),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }, "/api/chat");
}
const tools = (evs) => (evs || []).filter((e) => e.type === "tool_call").map((e) => e.tool);

console.log(`\nPRE-FLIGHT → ${BASE}\n`);

// Marketing pages
console.log("Site pages:");
for (const p of ["/", "/product", "/architecture", "/survivability", "/console"]) {
  const r = await fetch(BASE + p);
  ok(r.status === 200, `${p} → ${r.status}`);
}

// Beat: stats + regions (Act III topology, stat bar)
console.log("\nCluster + memory:");
const stats = await get("/api/stats");
ok(stats.body.totalMemories > 0, `stats: ${stats.body.totalMemories} memories, recall ${stats.body.recallMs}ms, regions ${stats.body.regionsLive}/${stats.body.regionsTotal}`);
// The published latency figure must separate the database from the model, or
// we are back to blaming CockroachDB for a Bedrock round trip.
ok(
  typeof stats.body.searchMs === "number" && typeof stats.body.embedMs === "number",
  `latency split reported: search ${stats.body.searchMs}ms + embed ${stats.body.embedMs}ms`,
);
const regions = await get("/api/regions");
ok(regions.body.live === true, `regions live=${regions.body.live}, survivalGoal=${regions.body.survivalGoal}`);
ok((regions.body.distribution || []).length === 3, `distribution across ${(regions.body.distribution || []).length} regions`);

// Beat IV: time-travel
console.log("\nTime-travel (Act IV):");
const t0 = await get("/api/timetravel?seconds=0");
const t600 = await get("/api/timetravel?seconds=600");
ok(t0.body.total != null, `now → ${t0.body.total}`);
ok(t600.body.total != null, `10 min ago → ${t600.body.total}`);

// Beat V: residency
console.log("\nResidency proof (Act V):");
const res = await get("/api/residency");
ok(res.body.region === "aws-eu-west-1" && (res.body.perRegion || []).length >= 1, `pinned region=${res.body.region}, per-region rows present`);

// Beat I: recall + evidence + Bedrock reasoning (warms demo data too)
console.log("\nAgent — recall + evidence (Act I, warms data):");
const t = Date.now();
const c1 = await chat("checkout-api p99 latency just jumped to 8s and connections are maxed out. what do i do?");
const dt = ((Date.now() - t) / 1000).toFixed(1);
ok(c1.status === 200 && (c1.body.reply || "").length > 40, `Bedrock reply in ${dt}s (${(c1.body.reply || "").length} chars)`);
ok(tools(c1.body.events).includes("recall_similar_incidents"), `recalled incidents (tools: ${tools(c1.body.events).join(", ")})`);
ok((c1.body.evidence || []).length > 0, `evidence ledger: ${(c1.body.evidence || []).length} items`);
ok(!c1.body.memoryDegraded, `memory writes durable (degraded=${c1.body.memoryDegraded}${c1.body.memoryError ? " · err: " + c1.body.memoryError : ""})`);
ok(!!c1.body.incidentId, `incident opened: ${c1.body.incidentId}`);
// Consolidation: the ledger must show DISTINCT episodes. Duplicate titles here
// mean the k nearest rows are being returned raw again, which on camera reads
// as a padded corpus.
const titles = (c1.body.evidence || []).map((e) => e.title);
ok(
  new Set(titles).size === titles.length,
  `evidence rows are distinct episodes (${new Set(titles).size}/${titles.length} unique)`,
);
const recurring = (c1.body.evidence || []).filter((e) => (e.occurrences ?? 1) > 1);
ok(
  recurring.length > 0,
  `recurrence reported on ${recurring.length} row(s) (e.g. x${recurring[0]?.occurrences ?? "-"})`,
);
// Trust boundary: the public endpoint must report itself as untrusted.
ok(c1.body.trusted === false, `public session reports trusted=${c1.body.trusted} (must be false)`);

// Beat I addendum: real-postmortem recall with provenance (fresh session so the
// checkout investigation above can't steer the recall).
console.log("\nAgent — public-postmortem provenance:");
const pmSid = randomUUID();
const c3 = await withRetry(
  () =>
    fetch(BASE + "/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: pmSid,
        message:
          "An engineer accidentally deleted the production database data directory while troubleshooting replication lag. Have we seen anything like this before?",
      }),
    }).then((r) => r.json()),
  "/api/chat (postmortem)",
).catch(() => ({}));
const cited = (c3.evidence || []).filter((e) => (e.sourceUrl || "").startsWith("https://"));
ok(cited.length > 0, `evidence cites ${cited.length} real postmortem(s) (${cited[0]?.sourceCompany ?? "none"})`);

// Beat III: self-diagnosis via MCP
console.log("\nAgent — self-diagnosis / MCP (Act III):");
const c2 = await chat("How many incidents are currently stored in your memory? Query the live cluster.");
ok(c2.status === 200, `reply ok`);
ok(tools(c2.body.events).some((x) => x === "inspect_cluster" || x === "diagnose_memory"), `introspected cluster (tools: ${tools(c2.body.events).join(", ")})`);

// Trust boundary: quarantine is visible, and the release valve is guarded.
console.log("\nTrust boundary (Act III):");
const hyg = await get("/api/hygiene");
ok(Array.isArray(hyg.body.quarantined), `quarantine list exposed (${(hyg.body.quarantined || []).length} held)`);
const promoteRes = await withRetry(
  () =>
    fetch(BASE + "/api/quarantine/promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runbookId: "00000000-0000-4000-8000-000000000000" }),
    }),
  "/api/quarantine/promote",
);
ok(promoteRes.status === 401, `unauthenticated promote rejected → ${promoteRes.status} (must be 401)`);
if (!process.env.BLACKBOX_OPERATOR_TOKEN) {
  console.log("  NOTE  BLACKBOX_OPERATOR_TOKEN not set locally — Act III's promote step");
  console.log("        needs it set in Vercel AND on your clipboard for the recording.");
}

console.log(`\n${fail === 0 ? "ALL GREEN" : fail + " FAILED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
