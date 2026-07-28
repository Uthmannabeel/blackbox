import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MemoryService, closePool, getPool } from "@blackbox/memory";

/**
 * Integration tests for the REAL, CockroachDB-backed MemoryService.
 *
 * The rest of the suite exercises MockMemoryService, which shares the pure
 * hygiene logic but none of the SQL — so every vector operator, REGIONAL BY ROW
 * default, UPSERT and transaction in the file that IS the submission was
 * previously untested. These cover that path.
 *
 * Opt-in, because they write to a live cluster:
 *
 *   BLACKBOX_INTEGRATION_DB=1 DATABASE_URL=postgresql://... npm test
 *
 * Every row created here carries a unique run tag and is deleted in afterAll,
 * so running against the demo cluster leaves no residue.
 */

const ENABLED = process.env.BLACKBOX_INTEGRATION_DB === "1" && Boolean(process.env.DATABASE_URL);
const d = ENABLED ? describe : describe.skip;

// Unique per run, so parallel/repeat runs cannot collide.
const TAG = `itest-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const SESSION = "00000000-0000-4000-8000-0000000000ff";

d("MemoryService against CockroachDB", () => {
  const mem = new MemoryService();
  let serviceId: string;

  beforeAll(async () => {
    const svc = await mem.resolveService(`${TAG}-svc`);
    serviceId = svc.id;
  }, 120_000);

  afterAll(async () => {
    const pool = getPool();
    // Order matters: children before parents.
    await pool.query(`DELETE FROM agent_memory WHERE content LIKE $1`, [`%${TAG}%`]);
    await pool.query(`DELETE FROM agent_stream WHERE content LIKE $1`, [`%${TAG}%`]);
    await pool.query(`DELETE FROM runbooks WHERE title LIKE $1 OR body LIKE $1`, [`%${TAG}%`]);
    await pool.query(
      `DELETE FROM incident_state WHERE incident_id IN (SELECT id FROM incidents WHERE title LIKE $1)`,
      [`%${TAG}%`],
    );
    await pool.query(`DELETE FROM incidents WHERE title LIKE $1`, [`%${TAG}%`]);
    await pool.query(`DELETE FROM memory_hygiene_events WHERE detail LIKE $1`, [`%${TAG}%`]);
    await pool.query(`DELETE FROM services WHERE name LIKE $1`, [`${TAG}%`]);
    await closePool();
  }, 120_000);

  test("stream kinds land in agent_stream, semantic kinds in agent_memory", async () => {
    const streamRow = await mem.remember({
      sessionId: SESSION,
      kind: "observation",
      content: `${TAG} observation about a noisy neighbour`,
    });
    const semanticRow = await mem.remember({
      sessionId: SESSION,
      kind: "reflection",
      content: `${TAG} resolved the noisy neighbour by capping its IOPS budget`,
      importance: 0.9,
    });

    const pool = getPool();
    const inStream = await pool.query(`SELECT id FROM agent_stream WHERE id = $1`, [streamRow.id]);
    const inSemantic = await pool.query(`SELECT id FROM agent_memory WHERE id = $1`, [
      semanticRow.id,
    ]);
    expect(inStream.rows).toHaveLength(1);
    expect(inSemantic.rows).toHaveLength(1);

    // And crucially, NOT in the other table.
    const streamLeak = await pool.query(`SELECT id FROM agent_memory WHERE id = $1`, [streamRow.id]);
    expect(streamLeak.rows).toHaveLength(0);
  }, 120_000);

  test("recallMemories finds a semantic memory and never returns stream rows", async () => {
    await mem.remember({
      sessionId: SESSION,
      kind: "reflection",
      content: `${TAG} resolved a quasar-telemetry backlog by resharding the ingest topic`,
      importance: 0.9,
    });
    const hits = await mem.recallMemories(`${TAG} quasar telemetry backlog reshard ingest`, 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => ["reflection", "insight"].includes(h.item.kind))).toBe(true);
  }, 120_000);

  test("agent_memory contains no zero-vector placeholder rows", async () => {
    // The defect this schema split fixed: unembedded rows were stored with a
    // 1024-dim zero vector to satisfy the C-SPANN index, then filtered out of
    // recall by a predicate the index could not serve.
    const { rows } = await getPool().query(
      `SELECT count(*)::int AS n FROM agent_memory
        WHERE kind IN ('user_msg','agent_msg','observation','action')`,
    );
    expect(Number(rows[0].n)).toBe(0);
  }, 120_000);

  test("recallSimilarIncidents consolidates repeats of one signature", async () => {
    for (let i = 0; i < 6; i++) {
      const inc = await mem.recordIncident({
        serviceId,
        title: `${TAG} zephyr-gateway p99 latency spike to ${i + 3}s from handle exhaustion`,
        summary: `p99 climbed to ${i + 3}s; file handles exhausted under burst load.`,
        severity: "SEV2",
      });
      await mem.resolveIncident(inc.id, "Raised the handle ulimit and added a saturation alert.");
    }
    const hits = await mem.recallSimilarIncidents(
      `${TAG} zephyr-gateway handle exhaustion latency`,
      5,
    );
    const mine = hits.filter((h) => h.item.title.includes(TAG));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.occurrences).toBeGreaterThan(1);
  }, 180_000);

  test("completeIncident commits resolve + learn + reflect atomically", async () => {
    const inc = await mem.recordIncident({
      serviceId,
      title: `${TAG} orion-billing duplicate charge storm`,
      summary: "Retries without idempotency keys produced duplicate charges.",
      severity: "SEV1",
    });
    const out = await mem.completeIncident({
      incidentId: inc.id,
      resolution: `${TAG}: introduced idempotency keys on the charge endpoint and a dead-letter queue for poison messages, then backfilled refunds for the duplicates.`,
      sessionId: SESSION,
      recalledRunbookIds: [],
      trusted: true,
    });

    expect(out.learn.action).toBe("accepted");
    expect(out.reflectionId).toBeTruthy();

    const pool = getPool();
    const incident = await pool.query(`SELECT status, resolution FROM incidents WHERE id = $1`, [
      inc.id,
    ]);
    expect(incident.rows[0].status).toBe("resolved");

    const reflection = await pool.query(
      `SELECT kind FROM agent_memory WHERE id = $1`,
      [out.reflectionId],
    );
    expect(reflection.rows[0].kind).toBe("reflection");

    const runbook = await pool.query(`SELECT status, origin FROM runbooks WHERE id = $1`, [
      out.learn.runbookId,
    ]);
    expect(runbook.rows[0].status).toBe("active");
    expect(runbook.rows[0].origin).toBe("trusted");
  }, 180_000);

  test("an untrusted completion quarantines the lesson and never reaches recall", async () => {
    const inc = await mem.recordIncident({
      serviceId,
      title: `${TAG} nebula-search shard hotspot`,
      summary: "One shard absorbed most of the query volume.",
      severity: "SEV3",
    });
    const out = await mem.completeIncident({
      incidentId: inc.id,
      resolution: `${TAG}: split the hot nebula-search shard, moved replicas to underloaded nodes, and enabled a shard-size alert to catch hotspots early.`,
      sessionId: SESSION,
      recalledRunbookIds: [],
      // trusted omitted on purpose — the default must fail closed.
    });

    expect(out.learn.action).toBe("quarantined");

    const { rows } = await getPool().query(`SELECT status, origin FROM runbooks WHERE id = $1`, [
      out.learn.runbookId,
    ]);
    expect(rows[0].status).toBe("quarantined");
    expect(rows[0].origin).toBe("anonymous");

    // Invisible to recall...
    const hits = await mem.recallRunbooks(`${TAG} nebula-search shard hotspot split replicas`, 10);
    expect(hits.some((h) => h.item.id === out.learn.runbookId)).toBe(false);

    // ...but visible to audit, and promotable by an operator.
    const pending = await mem.listQuarantined(50);
    expect(pending.map((r) => r.id)).toContain(out.learn.runbookId);
    expect(await mem.promoteRunbook(out.learn.runbookId!)).toBe(true);

    const after = await mem.recallRunbooks(`${TAG} nebula-search shard hotspot split replicas`, 10);
    expect(after.some((h) => h.item.id === out.learn.runbookId)).toBe(true);
  }, 180_000);

  test("resolveService normalises and bounds names from model output", async () => {
    const svc = await mem.resolveService(`  ${TAG}-Weird Name!!/../../etc/passwd  `);
    expect(svc.name).toMatch(/^[a-z0-9._-]+$/);
    expect(svc.name.length).toBeLessThanOrEqual(64);
    await expect(mem.resolveService("!!!")).rejects.toThrow();
  }, 120_000);

  test("incident_state is pinned to its incident's home region", async () => {
    const inc = await mem.recordIncident({
      serviceId,
      title: `${TAG} vega-api slow query regression`,
      summary: "A migration dropped a hot-path index.",
      severity: "SEV2",
    });
    await mem.updateIncidentState({
      incidentId: inc.id,
      phase: "diagnose",
      hypotheses: ["dropped index"],
      actionsTaken: [],
      nextSteps: ["recreate index"],
    });
    // Updating twice must UPDATE, not create a second (region, id) row.
    await mem.updateIncidentState({
      incidentId: inc.id,
      phase: "mitigate",
      hypotheses: ["dropped index"],
      actionsTaken: ["recreated index"],
      nextSteps: [],
    });

    const { rows } = await getPool().query(
      `SELECT crdb_region::string AS region, phase FROM incident_state WHERE incident_id = $1`,
      [inc.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].region).toBe(inc.region);
    expect(rows[0].phase).toBe("mitigate");
  }, 180_000);

  test("recentMemories interleaves stream and semantic rows, newest first", async () => {
    await mem.remember({ sessionId: SESSION, kind: "user_msg", content: `${TAG} feed A` });
    await mem.remember({
      sessionId: SESSION,
      kind: "reflection",
      content: `${TAG} feed B resolved by rolling the deploy back`,
      importance: 0.8,
    });
    const rows = await mem.recentMemories(20, SESSION);
    const kinds = new Set(rows.map((r) => r.kind));
    expect(rows.length).toBeGreaterThan(1);
    expect(kinds.size).toBeGreaterThan(1);
    for (let i = 1; i < rows.length; i++) {
      expect(new Date(rows[i - 1]!.createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(rows[i]!.createdAt).getTime(),
      );
    }
  }, 120_000);
});
