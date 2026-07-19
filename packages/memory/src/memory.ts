import { getPool, toVectorLiteral } from "./db.js";
import { embed, EMBED_DIM } from "./embeddings.js";
import {
  ARCHIVE_AFTER_DAYS,
  CONFIDENCE,
  DECAY_AFTER_DAYS,
  classifyLearnedWrite,
  gateRunbookContent,
} from "./hygiene.js";
import type {
  HygieneAction,
  HygieneEvent,
  IMemoryService,
  Incident,
  IncidentPhase,
  IncidentStateRecord,
  LearnOutcome,
  MemoryItem,
  MemoryKind,
  RecallHit,
  Runbook,
  Service,
  Severity,
} from "./types.js";

/**
 * MemoryService — BlackBox's agentic memory layer over CockroachDB.
 *
 * Design notes for reviewers:
 *  - Writes never set crdb_region explicitly. The column defaults to
 *    gateway_region(), so a memory is born in whatever region served the
 *    write and stays pinned there (data residency by row).
 *  - Recall uses the distributed vector index via the L2 (`<->`) operator.
 *    Embeddings are unit-normalized (see embeddings.ts), so L2 distance is
 *    monotonic with cosine similarity and matches the index's default metric.
 *  - vector_search_beam_size trades recall accuracy for latency; we raise it
 *    from the default 32 for the (small) recall sets an incident needs.
 */
export class MemoryService implements IMemoryService {
  private readonly beamSize: number;

  constructor(opts: { beamSize?: number } = {}) {
    // Clamp to a safe integer: this value is interpolated into a SET statement
    // (SET does not accept bind parameters), so we never let it be arbitrary.
    const requested = Math.floor(opts.beamSize ?? 64);
    this.beamSize = Math.max(1, Math.min(2048, Number.isFinite(requested) ? requested : 64));
  }

  /**
   * Run one vector-search statement with the tuned beam size applied via
   * SET LOCAL inside a transaction, so the setting cannot leak onto the
   * pooled connection after release.
   */
  private async searchWithBeam(sql: string, params: unknown[]): Promise<any[]> {
    const client = await getPool().connect();
    try {
      // BEGIN + SET LOCAL in one simple-query round-trip (no bind params; the
      // beam size is already clamped to a safe integer in the constructor).
      // Against remote CockroachDB Cloud this saves a full RTT per recall.
      await client.query(`BEGIN; SET LOCAL vector_search_beam_size = ${this.beamSize}`);
      const { rows } = await client.query(sql, params);
      await client.query("COMMIT");
      return rows;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* connection may be gone; release below */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  // ---- Fleet: services ------------------------------------------------------

  async listServices(): Promise<Service[]> {
    const { rows } = await getPool().query(
      `SELECT id, name, environment, owner_team, crdb_region::string AS region
         FROM services ORDER BY name`,
    );
    return rows.map(mapService);
  }

  /** Agents refer to services by name; resolve (or lazily create) the record. */
  async resolveService(name: string): Promise<Service> {
    const normalized = name.trim().toLowerCase();
    const { rows } = await getPool().query(
      `INSERT INTO services (name, environment)
       VALUES ($1, 'production')
       ON CONFLICT (name, environment) DO UPDATE SET name = excluded.name
       RETURNING id, name, environment, owner_team, crdb_region::string AS region`,
      [normalized],
    );
    return mapService(rows[0]);
  }

  // ---- Episodic memory: incidents -----------------------------------------

  /** Record a new incident and embed it for future "seen this before?" recall. */
  async recordIncident(input: {
    serviceId: string;
    title: string;
    summary: string;
    severity: Severity;
    signals?: unknown;
  }): Promise<Incident> {
    const embedding = await embed(`${input.title}\n\n${input.summary}`);
    const { rows } = await getPool().query(
      `INSERT INTO incidents (service_id, title, summary, severity, signals, embedding)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, service_id, title, summary, severity, status, signals,
                 resolution, crdb_region::string AS region, opened_at, resolved_at`,
      [
        input.serviceId,
        input.title,
        input.summary,
        input.severity,
        JSON.stringify(input.signals ?? null),
        toVectorLiteral(embedding),
      ],
    );
    return mapIncident(rows[0]);
  }

  async getIncident(incidentId: string): Promise<Incident | null> {
    const { rows } = await getPool().query(
      `SELECT id, service_id, title, summary, severity, status, signals,
              resolution, crdb_region::string AS region, opened_at, resolved_at
         FROM incidents WHERE id = $1`,
      [incidentId],
    );
    return rows[0] ? mapIncident(rows[0]) : null;
  }

  /** Close out an incident with the resolution the agent (or human) applied. */
  async resolveIncident(incidentId: string, resolution: string): Promise<void> {
    await getPool().query(
      `UPDATE incidents
          SET status = 'resolved', resolution = $2, resolved_at = now()
        WHERE id = $1`,
      [incidentId, resolution],
    );
  }

  /**
   * Semantic recall of past resolved incidents most similar to a situation.
   * This is the core "institutional memory" query the agent leans on.
   */
  async recallSimilarIncidents(
    situation: string,
    limit = 5,
  ): Promise<RecallHit<Incident>[]> {
    const q = toVectorLiteral(await embed(situation));
    const rows = await this.searchWithBeam(
      `SELECT id, service_id, title, summary, severity, status, signals,
              resolution, crdb_region::string AS region, opened_at, resolved_at,
              embedding <-> $1 AS distance
         FROM incidents
        WHERE status = 'resolved' AND resolution IS NOT NULL
        ORDER BY embedding <-> $1
        LIMIT $2`,
      [q, limit],
    );
    return rows.map((r) => ({ item: mapIncident(r), distance: Number(r.distance) }));
  }

  // ---- Semantic/procedural memory: runbooks --------------------------------

  async upsertRunbook(input: {
    title: string;
    body: string;
    tags?: string[];
  }): Promise<Runbook> {
    const embedding = await embed(`${input.title}\n\n${input.body}`);
    const { rows } = await getPool().query(
      `INSERT INTO runbooks (title, body, tags, embedding)
       VALUES ($1, $2, $3, $4)
       RETURNING ${RUNBOOK_COLS}`,
      [input.title, input.body, input.tags ?? [], toVectorLiteral(embedding)],
    );
    return mapRunbook(rows[0]);
  }

  /**
   * Retrieve the runbooks most relevant to the current situation.
   * Hygiene-aware: archived rows are invisible, and ranking discounts
   * low-confidence (probationary) learned knowledge. The SQL orders by pure
   * distance so the vector index serves it; we over-fetch and re-rank in app.
   * Returned rows get their recall counters bumped (non-blocking) so decay
   * can distinguish used knowledge from dead weight.
   */
  async recallRunbooks(situation: string, limit = 3): Promise<RecallHit<Runbook>[]> {
    const q = toVectorLiteral(await embed(situation));
    const rows = await this.searchWithBeam(
      `SELECT ${RUNBOOK_COLS}, embedding <-> $1 AS distance
         FROM runbooks
        WHERE status = 'active'
        ORDER BY embedding <-> $1
        LIMIT $2`,
      [q, limit * 3],
    );
    const hits = rows
      .map((r) => ({ item: mapRunbook(r), distance: Number(r.distance) }))
      .sort(
        (a, b) =>
          a.distance * (1 - 0.2 * (a.item.confidence - 0.5)) -
          b.distance * (1 - 0.2 * (b.item.confidence - 0.5)),
      )
      .slice(0, limit);

    const ids = hits.map((h) => h.item.id);
    if (ids.length > 0) {
      // Fire-and-forget: recall must never block on bookkeeping.
      getPool()
        .query(
          `UPDATE runbooks
              SET recall_count = recall_count + 1, last_recalled_at = now()
            WHERE id = ANY($1)`,
          [ids],
        )
        .catch(() => {});
    }
    return hits;
  }

  // ---- Memory hygiene: the gated write path for learned knowledge ----------

  /**
   * Commit an agent-distilled runbook through the hygiene gate.
   * Decisions: reject (content gate), merge (near-duplicate of existing
   * knowledge -> reinforce it instead of duplicating), insert (with a
   * contradiction flag and lower confidence when it disagrees with an
   * existing similar runbook). Every decision is logged as a hygiene event.
   */
  async commitLearnedRunbook(input: {
    incidentId: string;
    title: string;
    body: string;
    tags?: string[];
  }): Promise<LearnOutcome> {
    const gate = gateRunbookContent(input.body);
    if (!gate.ok) {
      await this.logHygiene("rejected", "runbook", null, `write rejected: ${gate.reason} (incident ${input.incidentId})`);
      return { action: "rejected", detail: gate.reason };
    }

    const embedding = await embed(`${input.title}\n\n${input.body}`);
    const q = toVectorLiteral(embedding);
    const nearestRows = await this.searchWithBeam(
      `SELECT ${RUNBOOK_COLS}, embedding <-> $1 AS distance
         FROM runbooks
        WHERE status = 'active'
        ORDER BY embedding <-> $1
        LIMIT 1`,
      [q],
    );
    const nearest = nearestRows[0]
      ? { row: mapRunbook(nearestRows[0]), distance: Number(nearestRows[0].distance) }
      : null;

    const decision = classifyLearnedWrite(
      nearest ? { distance: nearest.distance, body: nearest.row.body } : null,
      input.body,
    );

    if (decision.kind === "merge" && nearest) {
      await getPool().query(
        `UPDATE runbooks
            SET reinforced_count = reinforced_count + 1,
                confidence = LEAST($2, confidence + $3),
                updated_at = now()
          WHERE id = $1`,
        [nearest.row.id, CONFIDENCE.max, CONFIDENCE.reinforceStep],
      );
      const detail = `consolidated into "${nearest.row.title}" (distance ${nearest.distance.toFixed(3)}) instead of duplicating`;
      await this.logHygiene("merged", "runbook", nearest.row.id, detail);
      return { action: "merged", runbookId: nearest.row.id, detail };
    }

    const contradicts = decision.kind === "contradiction" && nearest ? nearest.row : null;
    const confidence = contradicts ? CONFIDENCE.contradicted : CONFIDENCE.learned;
    const { rows } = await getPool().query(
      `INSERT INTO runbooks (title, body, tags, embedding, source, confidence)
       VALUES ($1, $2, $3, $4, 'learned', $5)
       RETURNING ${RUNBOOK_COLS}`,
      [input.title, input.body, input.tags ?? [], q, confidence],
    );
    const created = mapRunbook(rows[0]);

    if (contradicts) {
      const detail =
        `new fix disagrees with "${contradicts.title}" for a similar situation; ` +
        `kept both, new one on probation (confidence ${confidence})`;
      await this.logHygiene("contradiction", "runbook", created.id, detail);
      return { action: "accepted", runbookId: created.id, contradictsId: contradicts.id, detail };
    }

    const detail = `learned runbook accepted (confidence ${confidence}) from incident ${input.incidentId}`;
    await this.logHygiene("accepted", "runbook", created.id, detail);
    return { action: "accepted", runbookId: created.id, detail };
  }

  /** Positive feedback: recalled runbooks that fed a real resolution earn trust. */
  async reinforceRunbooks(runbookIds: string[]): Promise<number> {
    if (runbookIds.length === 0) return 0;
    const { rows } = await getPool().query(
      `UPDATE runbooks
          SET confidence = LEAST($2, confidence + $3),
              reinforced_count = reinforced_count + 1,
              updated_at = now()
        WHERE id = ANY($1) AND status = 'active'
        RETURNING id`,
      [runbookIds, CONFIDENCE.max, CONFIDENCE.reinforceStep],
    );
    if (rows.length > 0) {
      await this.logHygiene(
        "reinforced",
        "runbook",
        rows[0].id,
        `${rows.length} recalled runbook(s) reinforced after successful resolution`,
      );
    }
    return rows.length;
  }

  /**
   * Maintenance pass: learned knowledge nobody recalls slowly loses
   * confidence; learned rows that fall below the archive threshold without
   * ever being reinforced are archived (excluded from recall, never deleted —
   * the audit trail survives). Curated runbooks never decay.
   */
  async decayRunbooks(): Promise<{ decayed: number; archived: number }> {
    const decayed = await getPool().query(
      `UPDATE runbooks
          SET confidence = GREATEST($1, confidence - $2), updated_at = now()
        WHERE source = 'learned' AND status = 'active'
          AND confidence > $1
          AND COALESCE(last_recalled_at, updated_at) < now() - ($3::INT * INTERVAL '1 day')
        RETURNING id`,
      [CONFIDENCE.floor, CONFIDENCE.decayStep, DECAY_AFTER_DAYS],
    );
    const archived = await getPool().query(
      `UPDATE runbooks
          SET status = 'archived', updated_at = now()
        WHERE source = 'learned' AND status = 'active'
          AND confidence < $1 AND reinforced_count = 0
          AND COALESCE(last_recalled_at, updated_at) < now() - ($2::INT * INTERVAL '1 day')
        RETURNING id, title`,
      [CONFIDENCE.archiveBelow, ARCHIVE_AFTER_DAYS],
    );
    if (decayed.rows.length > 0) {
      await this.logHygiene("decayed", "runbook", null, `${decayed.rows.length} unused learned runbook(s) lost confidence`);
    }
    for (const r of archived.rows) {
      await this.logHygiene("archived", "runbook", r.id, `"${r.title}" archived: never earned trust`);
    }
    return { decayed: decayed.rows.length, archived: archived.rows.length };
  }

  async recentHygieneEvents(limit = 20): Promise<HygieneEvent[]> {
    const capped = Math.max(1, Math.min(100, Math.floor(limit)));
    const { rows } = await getPool().query(
      `SELECT id, action, target_kind, target_id, detail, created_at
         FROM memory_hygiene_events
        ORDER BY created_at DESC LIMIT $1`,
      [capped],
    );
    return rows.map(mapHygieneEvent);
  }

  /** Record a write-path decision. Never throws — bookkeeping must not break the loop. */
  private async logHygiene(
    action: HygieneAction,
    targetKind: "runbook" | "memory",
    targetId: string | null,
    detail: string,
  ): Promise<void> {
    try {
      await getPool().query(
        `INSERT INTO memory_hygiene_events (action, target_kind, target_id, detail)
         VALUES ($1, $2, $3, $4)`,
        [action, targetKind, targetId, detail],
      );
    } catch {
      /* the decision still applied; only the audit row was lost */
    }
  }

  // ---- Working + long-term stream: agent_memory ----------------------------

  /** Append a thought/observation/action to the agent's memory stream. */
  async remember(input: {
    sessionId: string;
    incidentId?: string | null;
    kind: MemoryKind;
    content: string;
    importance?: number;
    embed?: boolean;
  }): Promise<MemoryItem> {
    // High-volume stream writes skip the embedding API call to conserve quota.
    // We store a zero vector rather than NULL because the C-SPANN vector index
    // rejects NULL embeddings on insert. A zero vector is NOT a "never matches"
    // sentinel (it sits at distance 1.0 from any unit query), so recallMemories
    // filters these kinds out explicitly rather than relying on ranking.
    const embedding =
      input.embed === false ? new Array(EMBED_DIM).fill(0) : await embed(input.content);
    const { rows } = await getPool().query(
      `INSERT INTO agent_memory (session_id, incident_id, kind, content, importance, embedding)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, session_id, incident_id, kind, content, importance,
                 crdb_region::string AS region, created_at`,
      [
        input.sessionId,
        input.incidentId ?? null,
        input.kind,
        input.content,
        input.importance ?? 0.5,
        toVectorLiteral(embedding),
      ],
    );
    return mapMemory(rows[0]);
  }

  /**
   * Semantic recall over the agent's own memory stream, importance-weighted.
   * The SQL orders by pure distance so the C-SPANN vector index can serve it
   * (an expression ordering would force a full scan); we over-fetch 3x and
   * apply the importance re-ranking in the application layer.
   *
   * Only rows written WITH a real embedding are recallable. High-volume stream
   * writes (messages, action/observation logs) are stored with a zero vector to
   * conserve embedding quota (see remember()), and a zero vector sits at L2
   * distance 1.0 from any unit query — close enough to out-rank genuinely
   * dissimilar real memories. Excluding those kinds keeps recall meaningful.
   */
  async recallMemories(query: string, limit = 6): Promise<RecallHit<MemoryItem>[]> {
    const q = toVectorLiteral(await embed(query));
    const rows = await this.searchWithBeam(
      `SELECT id, session_id, incident_id, kind, content, importance,
              crdb_region::string AS region, created_at,
              embedding <-> $1 AS distance
         FROM agent_memory
        WHERE kind NOT IN ('user_msg', 'agent_msg', 'observation', 'action')
        ORDER BY embedding <-> $1
        LIMIT $2`,
      [q, limit * 3],
    );
    return rows
      .map((r) => ({ item: mapMemory(r), distance: Number(r.distance) }))
      .sort(
        (a, b) =>
          a.distance * (1 - 0.3 * a.item.importance) -
          b.distance * (1 - 0.3 * b.item.importance),
      )
      .slice(0, limit);
  }

  /** Most recent memory-stream entries, for the UI feed. */
  async recentMemories(limit = 12, sessionId?: string): Promise<MemoryItem[]> {
    const capped = Math.max(1, Math.min(50, Math.floor(limit)));
    const { rows } = sessionId
      ? await getPool().query(
          `SELECT id, session_id, incident_id, kind, content, importance,
                  crdb_region::string AS region, created_at
             FROM agent_memory WHERE session_id = $2
            ORDER BY created_at DESC LIMIT $1`,
          [capped, sessionId],
        )
      : await getPool().query(
          `SELECT id, session_id, incident_id, kind, content, importance,
                  crdb_region::string AS region, created_at
             FROM agent_memory
            ORDER BY created_at DESC LIMIT $1`,
          [capped],
        );
    return rows.map(mapMemory);
  }

  // ---- Structured live state: incident_state -------------------------------

  async getIncidentState(incidentId: string): Promise<IncidentStateRecord | null> {
    const { rows } = await getPool().query(
      `SELECT incident_id, phase, hypotheses, actions_taken, next_steps,
              crdb_region::string AS region, updated_at
         FROM incident_state WHERE incident_id = $1`,
      [incidentId],
    );
    return rows[0] ? mapState(rows[0]) : null;
  }

  /** Upsert the transactional, strongly-consistent state of a live incident. */
  async updateIncidentState(input: {
    incidentId: string;
    phase: IncidentPhase;
    hypotheses: string[];
    actionsTaken: string[];
    nextSteps: string[];
  }): Promise<void> {
    // Pin the state row to its incident's home region. Without this, the
    // crdb_region default (gateway region) means updates arriving through a
    // different region would UPSERT a *second* (region, incident_id) row
    // instead of updating the existing one.
    const { rows } = await getPool().query(
      `SELECT crdb_region::string AS region FROM incidents WHERE id = $1`,
      [input.incidentId],
    );
    const region: string | undefined = rows[0]?.region;

    const values = [
      input.incidentId,
      input.phase,
      JSON.stringify(input.hypotheses),
      JSON.stringify(input.actionsTaken),
      JSON.stringify(input.nextSteps),
    ];

    if (region) {
      await getPool().query(
        `UPSERT INTO incident_state
           (crdb_region, incident_id, phase, hypotheses, actions_taken, next_steps, updated_at)
         VALUES ($6::crdb_internal_region, $1, $2, $3, $4, $5, now())`,
        [...values, region],
      );
    } else {
      // Unknown incident id: fall back to the gateway-region default.
      await getPool().query(
        `UPSERT INTO incident_state
           (incident_id, phase, hypotheses, actions_taken, next_steps, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        values,
      );
    }
  }
}

// ---- row mappers -----------------------------------------------------------

/** Shared runbook projection: every runbook read returns the hygiene columns. */
const RUNBOOK_COLS = `id, title, body, tags, crdb_region::string AS region,
       source, status, confidence, recall_count, reinforced_count, last_recalled_at`;

function mapService(r: any): Service {
  return {
    id: r.id,
    name: r.name,
    environment: r.environment,
    ownerTeam: r.owner_team ?? null,
    region: r.region,
  };
}

function mapIncident(r: any): Incident {
  return {
    id: r.id,
    serviceId: r.service_id,
    title: r.title,
    summary: r.summary,
    severity: r.severity,
    status: r.status,
    signals: r.signals,
    resolution: r.resolution ?? null,
    region: r.region,
    openedAt: r.opened_at,
    resolvedAt: r.resolved_at ?? null,
  };
}

function mapRunbook(r: any): Runbook {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    tags: r.tags ?? [],
    region: r.region,
    source: r.source ?? "curated",
    status: r.status ?? "active",
    confidence: Number(r.confidence ?? 0.6),
    recallCount: Number(r.recall_count ?? 0),
    reinforcedCount: Number(r.reinforced_count ?? 0),
    lastRecalledAt: r.last_recalled_at ?? null,
  };
}

function mapHygieneEvent(r: any): HygieneEvent {
  return {
    id: r.id,
    action: r.action,
    targetKind: r.target_kind,
    targetId: r.target_id ?? null,
    detail: r.detail,
    createdAt: r.created_at,
  };
}

function mapMemory(r: any): MemoryItem {
  return {
    id: r.id,
    sessionId: r.session_id,
    incidentId: r.incident_id ?? null,
    kind: r.kind,
    content: r.content,
    importance: Number(r.importance),
    region: r.region,
    createdAt: r.created_at,
  };
}

function mapState(r: any): IncidentStateRecord {
  return {
    incidentId: r.incident_id,
    phase: r.phase,
    hypotheses: r.hypotheses ?? [],
    actionsTaken: r.actions_taken ?? [],
    nextSteps: r.next_steps ?? [],
    region: r.region,
    updatedAt: r.updated_at,
  };
}
