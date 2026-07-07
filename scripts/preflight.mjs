// Demo pre-flight: verify every video beat is live before recording.
//   node scripts/preflight.mjs [baseUrl]
const BASE = process.argv[2] || "https://blackbox-web-eight.vercel.app";
const sid = "preflight-" + Math.floor(Date.now() / 1000);
let pass = 0, fail = 0;
const ok = (c, m) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}`); c ? pass++ : fail++; return c; };

async function get(p) { const r = await fetch(BASE + p); return { status: r.status, body: await r.json().catch(() => ({})) }; }
async function chat(message) {
  const r = await fetch(BASE + "/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: sid, message }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
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
ok(!c1.body.memoryDegraded, `memory writes durable (degraded=${c1.body.memoryDegraded})`);
ok(!!c1.body.incidentId, `incident opened: ${c1.body.incidentId}`);

// Beat III: self-diagnosis via MCP
console.log("\nAgent — self-diagnosis / MCP (Act III):");
const c2 = await chat("How many incidents are currently stored in your memory? Query the live cluster.");
ok(c2.status === 200, `reply ok`);
ok(tools(c2.body.events).some((x) => x === "inspect_cluster" || x === "diagnose_memory"), `introspected cluster (tools: ${tools(c2.body.events).join(", ")})`);

console.log(`\n${fail === 0 ? "ALL GREEN" : fail + " FAILED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
