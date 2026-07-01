import { getPool, toVectorLiteral } from "./db.js";
import { embed } from "./embeddings.js";
import type {
  IMemoryService,
  Incident,
  IncidentPhase,
  IncidentStateRecord,
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
      await client.query("BEGIN");
      await client.query(`SET LOCAL vector_search_beam_size = ${this.beamSize}`);
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
       RETURNING id, title, body, tags, crdb_region::string AS region`,
      [input.title, input.body, input.tags ?? [], toVectorLiteral(embedding)],
    );
    return mapRunbook(rows[0]);
  }

  /** Retrieve the runbooks most relevant to the current situation. */
  async recallRunbooks(situation: string, limit = 3): Promise<RecallHit<Runbook>[]> {
    const q = toVectorLiteral(await embed(situation));
    const rows = await this.searchWithBeam(
      `SELECT id, title, body, tags, crdb_region::string AS region,
              embedding <-> $1 AS distance
         FROM runbooks
        ORDER BY embedding <-> $1
        LIMIT $2`,
      [q, limit],
    );
    return rows.map((r) => ({ item: mapRunbook(r), distance: Number(r.distance) }));
  }

  // ---- Working + long-term stream: agent_memory ----------------------------

  /** Append a thought/observation/action to the agent's memory stream. */
  async remember(input: {
    sessionId: string;
    incidentId?: string | null;
    kind: MemoryKind;
    content: string;
    importance?: number;
  }): Promise<MemoryItem> {
    const embedding = await embed(input.content);
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
   */
  async recallMemories(query: string, limit = 6): Promise<RecallHit<MemoryItem>[]> {
    const q = toVectorLiteral(await embed(query));
    const rows = await this.searchWithBeam(
      `SELECT id, session_id, incident_id, kind, content, importance,
              crdb_region::string AS region, created_at,
              embedding <-> $1 AS distance
         FROM agent_memory
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
  return { id: r.id, title: r.title, body: r.body, tags: r.tags ?? [], region: r.region };
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
