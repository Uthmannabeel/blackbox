import { getPool, toVectorLiteral } from "./db.js";
import { embed } from "./embeddings.js";
import type {
  Incident,
  IncidentPhase,
  IncidentStateRecord,
  MemoryItem,
  MemoryKind,
  RecallHit,
  Runbook,
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
export class MemoryService {
  private readonly beamSize: number;

  constructor(opts: { beamSize?: number } = {}) {
    this.beamSize = opts.beamSize ?? 64;
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
    const client = await getPool().connect();
    try {
      await client.query(`SET vector_search_beam_size = ${this.beamSize}`);
      const { rows } = await client.query(
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
    } finally {
      client.release();
    }
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
    const client = await getPool().connect();
    try {
      await client.query(`SET vector_search_beam_size = ${this.beamSize}`);
      const { rows } = await client.query(
        `SELECT id, title, body, tags, crdb_region::string AS region,
                embedding <-> $1 AS distance
           FROM runbooks
          ORDER BY embedding <-> $1
          LIMIT $2`,
        [q, limit],
      );
      return rows.map((r) => ({ item: mapRunbook(r), distance: Number(r.distance) }));
    } finally {
      client.release();
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

  /** Semantic recall over the agent's own memory stream, importance-weighted. */
  async recallMemories(query: string, limit = 6): Promise<RecallHit<MemoryItem>[]> {
    const q = toVectorLiteral(await embed(query));
    const client = await getPool().connect();
    try {
      await client.query(`SET vector_search_beam_size = ${this.beamSize}`);
      const { rows } = await client.query(
        `SELECT id, session_id, incident_id, kind, content, importance,
                crdb_region::string AS region, created_at,
                embedding <-> $1 AS distance
           FROM agent_memory
          ORDER BY (embedding <-> $1) * (1.0 - 0.3 * importance)
          LIMIT $2`,
        [q, limit],
      );
      return rows.map((r) => ({ item: mapMemory(r), distance: Number(r.distance) }));
    } finally {
      client.release();
    }
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
    await getPool().query(
      `UPSERT INTO incident_state
         (incident_id, phase, hypotheses, actions_taken, next_steps, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())`,
      [
        input.incidentId,
        input.phase,
        JSON.stringify(input.hypotheses),
        JSON.stringify(input.actionsTaken),
        JSON.stringify(input.nextSteps),
      ],
    );
  }
}

// ---- row mappers -----------------------------------------------------------

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
