import type { PoolClient } from "pg";
import { beamSize, getPool, toVectorLiteral } from "./db.js";
import { embed } from "./embeddings.js";
import {
  ARCHIVE_AFTER_DAYS,
  CONFIDENCE,
  DECAY_AFTER_DAYS,
  classifyLearnedWrite,
  consolidateEpisodes,
  episodeSignature,
  gateRunbookContent,
  overfetchFor,
} from "./hygiene.js";
import { isStreamKind } from "./types.js";
import type {
  CompleteIncidentOutcome,
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

/** Anything we can run SQL on: the pool itself or a transaction's client. */
type Queryable = Pick<PoolClient, "query">;

/** Longest service name we will accept from model output. */
const MAX_SERVICE_NAME = 64;

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
 *    from the default 32 and apply it once per pooled connection (db.ts), so
 *    a recall is one round trip rather than BEGIN/SET LOCAL/query/COMMIT.
 *  - Episodic recall CONSOLIDATES: fleets repeat their failure modes, so the
 *    k nearest rows are often k copies of one memory. We over-fetch, cluster,
 *    and return distinct lessons with a recurrence count.
 *  - Two memory tables, split by access pattern: `agent_memory` (embedded,
 *    similarity-searched) and `agent_stream` (append-only, read by recency).
 */
export class MemoryService implements IMemoryService {
  private readonly beam: number;

  constructor(opts: { beamSize?: number } = {}) {
    this.beam = opts.beamSize
      ? Math.max(1, Math.min(2048, Math.floor(opts.beamSize)))
      : beamSize();
  }

  /**
   * Run one vector-search statement. The beam size is already applied to every
   * pooled connection at setup (see db.ts), so this is a single round trip —
   * no BEGIN/SET LOCAL/COMMIT wrapper. Inside an explicit transaction the
   * caller passes its own client.
   */
  private async search(sql: string, params: unknown[], on: Queryable = getPool()): Promise<any[]> {
    const { rows } = await on.query(sql, params);
    return rows;
  }

  /** Run a unit of work as one CockroachDB transaction, or roll it all back. */
  private async inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* connection may already be gone */
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

  /**
   * Agents refer to services by name; resolve (or lazily create) the record.
   * The name arrives from model output on a public endpoint, so it is
   * normalised and bounded here — an unbounded lazy INSERT is a write
   * amplification primitive for anyone who can talk to the agent.
   */
  async resolveService(name: string): Promise<Service> {
    const normalized = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_SERVICE_NAME);
    if (!normalized) throw new Error("service name must contain at least one alphanumeric character");
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
   *
   * Real fleets fail the same way over and over, so the k nearest ROWS are
   * frequently k copies of ONE memory. We over-fetch, consolidate near-
   * identical episodes into a single representative, and report how often the
   * signature recurred — so the agent gets `limit` DISTINCT lessons plus the
   * frequency signal, instead of one lesson `limit` times.
   */
  async recallSimilarIncidents(
    situation: string,
    limit = 5,
  ): Promise<RecallHit<Incident>[]> {
    const q = toVectorLiteral(await embed(situation));
    // Over-fetch enough to survive heavy clustering without a second query.
    const overfetch = overfetchFor(limit);
    const rows = await this.search(
      `SELECT id, service_id, title, summary, severity, status, signals,
              resolution, crdb_region::string AS region, opened_at, resolved_at,
              embedding <-> $1 AS distance
         FROM incidents
        WHERE status = 'resolved' AND resolution IS NOT NULL
        ORDER BY embedding <-> $1
        LIMIT $2`,
      [q, overfetch],
    );

    const candidates = rows.map((r) => ({
      distance: Number(r.distance),
      signature: episodeSignature(String(r.title)),
      row: r,
    }));

    return consolidateEpisodes(candidates, limit).map((c) => ({
      item: mapIncident(c.representative.row),
      distance: c.representative.distance,
      occurrences: c.occurrences,
    }));
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
    const rows = await this.search(
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
    trusted?: boolean;
  }): Promise<LearnOutcome> {
    return this.commitLearnedRunbookOn(getPool(), input);
  }

  /** The gate itself, runnable on the pool or inside a caller's transaction. */
  private async commitLearnedRunbookOn(
    on: Queryable,
    input: {
      incidentId: string;
      title: string;
      body: string;
      tags?: string[];
      trusted?: boolean;
    },
  ): Promise<LearnOutcome> {
    // Fail closed: only an explicitly trusted caller writes into live recall.
    const trusted = input.trusted === true;

    const gate = gateRunbookContent(input.body);
    if (!gate.ok) {
      await this.logHygiene(on, "rejected", "runbook", null, `write rejected: ${gate.reason} (incident ${input.incidentId})`);
      return { action: "rejected", detail: gate.reason };
    }

    const embedding = await embed(`${input.title}\n\n${input.body}`);
    const q = toVectorLiteral(embedding);
    const nearestRows = await this.search(
      `SELECT ${RUNBOOK_COLS}, embedding <-> $1 AS distance
         FROM runbooks
        WHERE status = 'active'
        ORDER BY embedding <-> $1
        LIMIT 1`,
      [q],
      on,
    );
    const nearest = nearestRows[0]
      ? { row: mapRunbook(nearestRows[0]), distance: Number(nearestRows[0].distance) }
      : null;

    const decision = classifyLearnedWrite(
      nearest ? { distance: nearest.distance, body: nearest.row.body } : null,
      input.body,
    );

    // Consolidating into an existing ACTIVE runbook also reinforces it. That is
    // a write into trusted knowledge, so an untrusted session must not reach it
    // — otherwise anonymous input could promote curated content's ranking
    // without ever being reviewed. Untrusted writes always land in quarantine.
    if (decision.kind === "merge" && nearest && trusted) {
      await on.query(
        `UPDATE runbooks
            SET reinforced_count = reinforced_count + 1,
                confidence = LEAST($2, confidence + $3),
                updated_at = now()
          WHERE id = $1`,
        [nearest.row.id, CONFIDENCE.max, CONFIDENCE.reinforceStep],
      );
      const detail = `consolidated into "${nearest.row.title}" (distance ${nearest.distance.toFixed(3)}) instead of duplicating`;
      await this.logHygiene(on, "merged", "runbook", nearest.row.id, detail);
      return { action: "merged", runbookId: nearest.row.id, detail };
    }

    const contradicts = decision.kind === "contradiction" && nearest ? nearest.row : null;
    const confidence = contradicts ? CONFIDENCE.contradicted : CONFIDENCE.learned;
    const status = trusted ? "active" : "quarantined";
    const origin = trusted ? "trusted" : "anonymous";
    const { rows } = await on.query(
      `INSERT INTO runbooks (title, body, tags, embedding, source, status, origin, confidence)
       VALUES ($1, $2, $3, $4, 'learned', $5, $6, $7)
       RETURNING ${RUNBOOK_COLS}`,
      [input.title, input.body, input.tags ?? [], q, status, origin, confidence],
    );
    const created = mapRunbook(rows[0]);

    if (!trusted) {
      const detail =
        "written by an unauthenticated session — quarantined pending operator " +
        "review; stored and auditable, but never recalled";
      await this.logHygiene(on, "quarantined", "runbook", created.id, detail);
      return { action: "quarantined", runbookId: created.id, detail };
    }

    if (contradicts) {
      const detail =
        `new fix disagrees with "${contradicts.title}" for a similar situation; ` +
        `kept both, new one on probation (confidence ${confidence})`;
      await this.logHygiene(on, "contradiction", "runbook", created.id, detail);
      return { action: "accepted", runbookId: created.id, contradictsId: contradicts.id, detail };
    }

    const detail = `learned runbook accepted (confidence ${confidence}) from incident ${input.incidentId}`;
    await this.logHygiene(on, "accepted", "runbook", created.id, detail);
    return { action: "accepted", runbookId: created.id, detail };
  }

  /**
   * The learning loop, atomically. Resolving an incident, distilling the fix,
   * reinforcing what helped and recording the reflection are ONE unit of work:
   * a partially-applied lesson leaves the store claiming knowledge it never
   * finished writing. CockroachDB gives us a serializable transaction across
   * four tables in three regions — so we use one.
   */
  async completeIncident(input: {
    incidentId: string;
    resolution: string;
    sessionId: string;
    recalledRunbookIds: string[];
    trusted?: boolean;
  }): Promise<CompleteIncidentOutcome> {
    // Embed OUTSIDE the transaction. A Bedrock round trip takes seconds and
    // must not hold locks (or risk a transaction timeout) while it runs.
    const incidentRows = await this.search(`SELECT title FROM incidents WHERE id = $1`, [
      input.incidentId,
    ]);
    const title: string = incidentRows[0]?.title ?? "untitled incident";
    const reflection = `Resolved "${title}". Learned: ${input.resolution}`;
    const reflectionVector = toVectorLiteral(await embed(reflection));

    return this.inTransaction(async (client) => {
      await client.query(
        `UPDATE incidents
            SET status = 'resolved', resolution = $2, resolved_at = now()
          WHERE id = $1`,
        [input.incidentId, input.resolution],
      );

      const learn = await this.commitLearnedRunbookOn(client, {
        incidentId: input.incidentId,
        title: `Learned runbook: ${title}`,
        body:
          `Distilled from incident ${input.incidentId} ` +
          `(${new Date().toISOString().slice(0, 10)}):\n${input.resolution}`,
        tags: ["learned", "auto-postmortem"],
        trusted: input.trusted,
      });

      const reinforced = await this.reinforceRunbooksOn(client, input.recalledRunbookIds);

      const { rows } = await client.query(
        `INSERT INTO agent_memory (session_id, incident_id, kind, content, importance, embedding)
         VALUES ($1, $2, 'reflection', $3, 0.9, $4)
         RETURNING id`,
        [input.sessionId, input.incidentId, reflection, reflectionVector],
      );

      return { learn, reinforced, reflectionId: rows[0]?.id ?? null };
    });
  }

  /** Release a quarantined runbook into live recall (trusted-operator action). */
  async promoteRunbook(runbookId: string): Promise<boolean> {
    const { rows } = await getPool().query(
      `UPDATE runbooks
          SET status = 'active', origin = 'trusted', updated_at = now()
        WHERE id = $1 AND status = 'quarantined'
        RETURNING id, title`,
      [runbookId],
    );
    if (rows.length === 0) return false;
    await this.logHygiene(
      getPool(),
      "promoted",
      "runbook",
      rows[0].id,
      `"${rows[0].title}" promoted out of quarantine by a trusted operator`,
    );
    return true;
  }

  /** Quarantined learned knowledge awaiting operator review. */
  async listQuarantined(limit = 20): Promise<Runbook[]> {
    const capped = Math.max(1, Math.min(100, Math.floor(limit)));
    const { rows } = await getPool().query(
      `SELECT ${RUNBOOK_COLS} FROM runbooks
        WHERE status = 'quarantined'
        ORDER BY updated_at DESC LIMIT $1`,
      [capped],
    );
    return rows.map(mapRunbook);
  }

  /** Positive feedback: recalled runbooks that fed a real resolution earn trust. */
  async reinforceRunbooks(runbookIds: string[]): Promise<number> {
    return this.reinforceRunbooksOn(getPool(), runbookIds);
  }

  private async reinforceRunbooksOn(on: Queryable, runbookIds: string[]): Promise<number> {
    if (runbookIds.length === 0) return 0;
    const { rows } = await on.query(
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
        on,
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
      await this.logHygiene(getPool(), "decayed", "runbook", null, `${decayed.rows.length} unused learned runbook(s) lost confidence`);
    }
    for (const r of archived.rows) {
      await this.logHygiene(getPool(), "archived", "runbook", r.id, `"${r.title}" archived: never earned trust`);
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

  /**
   * Record a write-path decision. On the pool this never throws — losing an
   * audit row must not break the reasoning loop. Inside a transaction it DOES
   * propagate: a failed statement aborts the CockroachDB transaction anyway,
   * so swallowing the error would leave the caller running blind against a
   * dead transaction.
   */
  private async logHygiene(
    on: Queryable,
    action: HygieneAction,
    targetKind: "runbook" | "memory",
    targetId: string | null,
    detail: string,
  ): Promise<void> {
    const insert = on.query(
      `INSERT INTO memory_hygiene_events (action, target_kind, target_id, detail)
       VALUES ($1, $2, $3, $4)`,
      [action, targetKind, targetId, detail],
    );
    if (on === getPool()) {
      await insert.catch(() => {
        /* the decision still applied; only the audit row was lost */
      });
      return;
    }
    await insert;
  }

  // ---- Working + long-term stream: agent_memory ----------------------------

  /**
   * Append to memory. The KIND picks the table, so it is structurally
   * impossible to put an unembedded row in the semantic store:
   *
   *   stream kinds (user_msg/agent_msg/observation/action)
   *       -> agent_stream, no vector, no embedding call
   *   semantic kinds (reflection/insight)
   *       -> agent_memory, always embedded, always recallable
   */
  async remember(input: {
    sessionId: string;
    incidentId?: string | null;
    kind: MemoryKind;
    content: string;
    importance?: number;
  }): Promise<MemoryItem> {
    const importance = input.importance ?? 0.5;

    if (isStreamKind(input.kind)) {
      const { rows } = await getPool().query(
        `INSERT INTO agent_stream (session_id, incident_id, kind, content, importance)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, session_id, incident_id, kind, content, importance,
                   crdb_region::string AS region, created_at`,
        [input.sessionId, input.incidentId ?? null, input.kind, input.content, importance],
      );
      return mapMemory(rows[0]);
    }

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
        importance,
        toVectorLiteral(await embed(input.content)),
      ],
    );
    return mapMemory(rows[0]);
  }

  /**
   * Semantic recall over the agent's own durable memory, importance-weighted.
   * Every row in `agent_memory` carries a real embedding, so there is no kind
   * predicate here — the vector index serves the whole query. (It used to
   * filter out zero-vector stream rows, which the index could not help with
   * and which, on a live corpus, excluded 100% of the table.)
   * We over-fetch 3x and apply importance re-ranking in the application layer.
   */
  async recallMemories(query: string, limit = 6): Promise<RecallHit<MemoryItem>[]> {
    const q = toVectorLiteral(await embed(query));
    const rows = await this.search(
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

  /**
   * Most recent entries across BOTH tables, newest first — the console's
   * memory feed shows the conversation and the durable lessons interleaved.
   */
  async recentMemories(limit = 12, sessionId?: string): Promise<MemoryItem[]> {
    const capped = Math.max(1, Math.min(50, Math.floor(limit)));
    const cols = `id, session_id, incident_id, kind, content, importance,
                  crdb_region::string AS region, created_at`;
    const where = sessionId ? "WHERE session_id = $2" : "";
    const { rows } = await getPool().query(
      `SELECT * FROM (
         (SELECT ${cols} FROM agent_stream ${where} ORDER BY created_at DESC LIMIT $1)
         UNION ALL
         (SELECT ${cols} FROM agent_memory ${where} ORDER BY created_at DESC LIMIT $1)
       ) ORDER BY created_at DESC LIMIT $1`,
      sessionId ? [capped, sessionId] : [capped],
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
       source, status, origin, confidence, recall_count, reinforced_count, last_recalled_at`;

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
    origin: r.origin ?? "trusted",
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
