import { getPool, closePool, toVectorLiteral } from "../db.js";
import { embed } from "../embeddings.js";
import { loadEnv } from "../env.js";
import { SERVICES } from "../seedData.js";

loadEnv();

/**
 * Scale seeding: generate N synthetic resolved incidents (default 10,000) so
 * the distributed vector index has a realistic corpus to search — 11 rows
 * doesn't need C-SPANN; 10k+ does.
 *
 * Usage:
 *   npm run db:seed:scale             # 10,000 incidents
 *   npm run db:seed:scale -- 25000    # custom count
 *
 * Embeddings: set BLACKBOX_MOCK_EMBEDDINGS=1 to seed without Bedrock
 * (deterministic hashed embeddings — recall still ranks sensibly). With real
 * AWS creds, Titan v2 is used (~pennies per 10k).
 */

const COUNT = Math.max(1, Number(process.argv[2] ?? process.env.SEED_COUNT ?? 10_000));
const CONCURRENCY = 8;

// Failure-mode templates. {svc}/{dep}/{n}/{pct} are filled per incident.
const MODES = [
  {
    title: "{svc} p99 latency spike to {n}s from connection pool exhaustion",
    summary:
      "p99 latency on {svc} climbed to {n}s. Connection pool saturated at max_connections; slow downstream calls to {dep} held connections open.",
    fix: "Applied statement_timeout on {dep} calls, raised pool size, added circuit breaker.",
    sev: ["SEV1", "SEV2", "SEV2"],
  },
  {
    title: "{svc} elevated 5xx after deploy {n}",
    summary:
      "Error rate on {svc} rose to {pct}% following deploy {n}. New code path threw unhandled exceptions under load.",
    fix: "Rolled back deploy {n}; added regression test and canary gate.",
    sev: ["SEV2", "SEV3"],
  },
  {
    title: "{svc} consumer lag {n}M messages behind",
    summary:
      "The {svc} consumer group lagged by {n}M messages after message size doubled; downstream data went stale.",
    fix: "Scaled consumers, enabled batch compression, drained lag.",
    sev: ["SEV3"],
  },
  {
    title: "{svc} OOM-killed pods crash-looping",
    summary:
      "{svc} pods exceeded memory limits ({n}Gi) and were OOM-killed repeatedly; a cache grew without bound.",
    fix: "Added cache eviction policy and raised limits with alerting at {pct}% usage.",
    sev: ["SEV2", "SEV3"],
  },
  {
    title: "{svc} certificate expiry caused TLS handshake failures",
    summary:
      "Clients of {svc} failed TLS handshakes; the serving certificate expired without renewal automation.",
    fix: "Rotated the certificate and automated renewal with {n}-day pre-expiry alerts.",
    sev: ["SEV1", "SEV2"],
  },
  {
    title: "{svc} cache stampede overloaded {dep}",
    summary:
      "A bulk invalidation on {svc} sent {pct}% of traffic to {dep} at once; origin CPU pinned and served 503s.",
    fix: "Added request coalescing and staggered invalidations.",
    sev: ["SEV2"],
  },
  {
    title: "{svc} retry storm produced duplicate side-effects",
    summary:
      "Downstream 500s from {dep} triggered retries without idempotency keys on {svc}; users saw duplicates.",
    fix: "Introduced idempotency keys and dead-letter queue for poison messages.",
    sev: ["SEV3"],
  },
  {
    title: "{svc} disk full on {n} nodes halted writes",
    summary:
      "Log growth filled disks on {n} {svc} nodes; writes stalled and queues backed up.",
    fix: "Rotated logs, added disk-usage alerts at {pct}%, expanded volumes.",
    sev: ["SEV1", "SEV2"],
  },
  {
    title: "{svc} DNS resolution failures for {dep}",
    summary:
      "Intermittent NXDOMAIN for {dep} broke {pct}% of {svc} requests; a resolver config change was at fault.",
    fix: "Reverted resolver change and pinned critical endpoints with health-checked fallbacks.",
    sev: ["SEV2", "SEV3"],
  },
  {
    title: "{svc} thread pool starvation under burst traffic",
    summary:
      "A {n}x traffic burst exhausted {svc}'s worker threads; requests queued past their deadlines.",
    fix: "Added load shedding and autoscaling on queue depth.",
    sev: ["SEV2"],
  },
  {
    title: "{svc} config rollout flipped feature flag for all tenants",
    summary:
      "A config typo enabled an experimental path on {svc} for 100% of tenants instead of {pct}%.",
    fix: "Reverted flag, added schema validation and staged rollout tooling.",
    sev: ["SEV2", "SEV3"],
  },
  {
    title: "{svc} slow query regression after index drop",
    summary:
      "A migration dropped an index used by {svc}'s hot path; scans went from ms to {n}s.",
    fix: "Recreated the index and added EXPLAIN checks to migration CI.",
    sev: ["SEV2"],
  },
] as const;

const DEPS = ["payments-gateway", "user-db", "redis-cache", "kafka", "s3", "auth-provider", "search-cluster"];

// Deterministic PRNG so re-runs are reproducible.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? k);
}

async function main() {
  const pool = getPool();
  const rand = mulberry32(1337);

  console.log(`Scale-seeding ${COUNT} resolved incidents (concurrency ${CONCURRENCY}) ...`);

  // Distribute home regions explicitly. In production every region's app
  // instances write via their local gateway, so rows naturally spread across
  // regions; a single-gateway seeder must simulate that or every row would be
  // pinned to the seeder's region.
  const { rows: regionRows } = await pool.query(`SELECT region FROM [SHOW REGIONS FROM DATABASE]`);
  const regions: string[] = regionRows.map((r: any) => r.region);
  if (regions.length === 0) throw new Error("database has no regions configured");
  console.log(`Distributing rows across: ${regions.join(", ")}`);

  // Ensure services exist; collect ids.
  const serviceIds: string[] = [];
  for (const s of SERVICES) {
    const { rows } = await pool.query(
      `INSERT INTO services (name, environment, owner_team)
       VALUES ($1, 'production', $2)
       ON CONFLICT (name, environment) DO UPDATE SET owner_team = excluded.owner_team
       RETURNING id`,
      [s.name, s.team],
    );
    serviceIds.push(rows[0].id);
  }

  const startedAt = Date.now();
  let inserted = 0;
  let errors = 0;

  async function insertOne(i: number): Promise<void> {
    const mode = MODES[Math.floor(rand() * MODES.length)]!;
    const svcIdx = Math.floor(rand() * SERVICES.length);
    const vars = {
      svc: SERVICES[svcIdx]!.name,
      dep: DEPS[Math.floor(rand() * DEPS.length)]!,
      n: String(1 + Math.floor(rand() * 30)),
      pct: String(5 + Math.floor(rand() * 90)),
    };
    const title = fill(mode.title, vars);
    const summary = fill(mode.summary, vars) + ` (case #${i})`;
    const resolution = fill(mode.fix, vars);
    const severity = mode.sev[Math.floor(rand() * mode.sev.length)]!;
    // Spread openings over the past ~2 years.
    const openedAt = new Date(Date.now() - Math.floor(rand() * 730) * 86_400_000);

    const embedding = await embed(`${title}\n\n${summary}`);
    const region = regions[i % regions.length]!;
    await pool.query(
      `INSERT INTO incidents
         (crdb_region, service_id, title, summary, severity, status, resolution, embedding, opened_at, resolved_at)
       VALUES ($8::crdb_internal_region, $1, $2, $3, $4, 'resolved', $5, $6, $7, $7)`,
      [
        serviceIds[svcIdx],
        title,
        summary,
        severity,
        resolution,
        toVectorLiteral(embedding),
        openedAt.toISOString(),
        region,
      ],
    );
  }

  // Simple worker pool: CONCURRENCY in-flight single-row inserts (per docs,
  // avoid large batch inserts into vector-indexed tables).
  let next = 0;
  async function worker(): Promise<void> {
    while (next < COUNT) {
      const i = next++;
      try {
        await insertOne(i);
        inserted++;
      } catch (err) {
        errors++;
        if (errors <= 5) console.error(`  insert #${i} failed:`, (err as Error).message);
      }
      if (inserted % 500 === 0 && inserted > 0) {
        const rate = inserted / ((Date.now() - startedAt) / 1000);
        console.log(`  ${inserted}/${COUNT} (${rate.toFixed(0)} rows/s)`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`✓ Seeded ${inserted} incidents in ${secs}s (${errors} errors).`);
}

main()
  .catch((err) => {
    console.error("✗ Scale seed failed:", err);
    process.exitCode = 1;
  })
  .finally(closePool);
