import { getPool, closePool, toVectorLiteral } from "../db.js";
import { embed } from "../embeddings.js";

/**
 * Seed a sample fleet, a library of resolved historical incidents (embedded so
 * the agent can recall them), and remediation runbooks.
 *
 * Usage: npm run db:seed
 */

const SERVICES = [
  { name: "checkout-api", team: "payments" },
  { name: "auth-service", team: "identity" },
  { name: "search-indexer", team: "discovery" },
  { name: "notification-worker", team: "growth" },
  { name: "image-cdn", team: "platform" },
];

const HISTORICAL_INCIDENTS = [
  {
    service: "checkout-api",
    title: "Checkout latency spike from connection pool exhaustion",
    summary:
      "p99 latency on POST /checkout climbed to 8s. Pool saturated at max_connections; a slow downstream payment call held connections open.",
    severity: "SEV2",
    resolution:
      "Lowered statement_timeout on the payment call, raised pool size, and added a circuit breaker. Latency returned to 180ms p99.",
  },
  {
    service: "auth-service",
    title: "Login failures after JWT signing key rotation",
    summary:
      "Users could not log in; auth-service rejected tokens with 'kid not found'. A key rotation removed the old signing key before clients refreshed JWKS.",
    severity: "SEV1",
    resolution:
      "Re-published the previous key to the JWKS endpoint and extended the key overlap window to 24h in the rotation job.",
  },
  {
    service: "search-indexer",
    title: "Search results stale due to indexer consumer lag",
    summary:
      "New listings took >30 min to appear in search. The Kafka consumer group for the indexer lagged by 2M messages after a deploy doubled message size.",
    severity: "SEV3",
    resolution:
      "Scaled indexer consumers from 4 to 12 partitions-workers and enabled batch compression. Lag drained in 40 minutes.",
  },
  {
    service: "image-cdn",
    title: "Elevated 5xx from origin during cache purge storm",
    summary:
      "A bulk cache purge invalidated 90% of objects at once, stampeding the origin. Origin CPU hit 100% and served 503s.",
    severity: "SEV2",
    resolution:
      "Throttled purges, added origin shielding + request coalescing, and staggered future purges. 5xx dropped to baseline.",
  },
  {
    service: "notification-worker",
    title: "Duplicate push notifications after retry storm",
    summary:
      "Users received the same push 3-5 times. A downstream 500 caused the worker to retry without an idempotency key, re-enqueuing sends.",
    severity: "SEV3",
    resolution:
      "Added an idempotency key per notification and dead-lettered poison messages. Duplicates eliminated.",
  },
  {
    service: "checkout-api",
    title: "Payment webhooks dropped during database failover",
    summary:
      "During a primary DB failover, in-flight webhook writes were lost and orders were left in 'pending'. No strong consistency across the failover.",
    severity: "SEV1",
    resolution:
      "Moved webhook state to a strongly-consistent store and made handlers idempotent + replayable from the event log.",
  },
];

const RUNBOOKS = [
  {
    title: "Runbook: Connection pool exhaustion",
    tags: ["latency", "database", "pool"],
    body: "1. Check active vs max connections. 2. Find slow downstream calls holding connections. 3. Apply statement_timeout. 4. Add circuit breaker. 5. Scale pool only after capping tail latency.",
  },
  {
    title: "Runbook: Signing key / JWKS rotation incidents",
    tags: ["auth", "jwt", "rotation"],
    body: "1. Confirm 'kid not found' errors. 2. Re-publish previous key to JWKS. 3. Verify overlap window >= client refresh interval. 4. Fix rotation job to keep N-1 key live.",
  },
  {
    title: "Runbook: Consumer lag / stale downstream data",
    tags: ["kafka", "lag", "throughput"],
    body: "1. Inspect consumer group lag. 2. Correlate with recent deploys / message-size changes. 3. Scale workers or partitions. 4. Enable batch compression. 5. Watch lag drain rate.",
  },
  {
    title: "Runbook: Origin overload / cache stampede",
    tags: ["cdn", "cache", "5xx"],
    body: "1. Detect purge/invalidation events. 2. Enable request coalescing + origin shielding. 3. Throttle purges. 4. Stagger invalidations going forward.",
  },
  {
    title: "Runbook: Idempotency for retried work",
    tags: ["retries", "idempotency", "duplicates"],
    body: "1. Confirm duplicate side-effects. 2. Add idempotency key per unit of work. 3. Dead-letter poison messages. 4. Make handlers safe to replay.",
  },
];

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
