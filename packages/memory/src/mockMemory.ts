import { randomUUID } from "node:crypto";
import { embed } from "./embeddings.js";
import {
  CONFIDENCE,
  classifyLearnedWrite,
  consolidateEpisodes,
  episodeSignature,
  gateRunbookContent,
  overfetchFor,
} from "./hygiene.js";
import { HISTORICAL_INCIDENTS, RUNBOOKS, SERVICES } from "./seedData.js";
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

const REGIONS = ["aws-us-east-1", "aws-eu-west-1", "aws-ap-south-1"];

interface Vec<T> {
  row: T;
  embedding: number[];
}

/** Fresh hygiene fields for a new runbook row. */
function defaultHygiene(source: "curated" | "learned") {
  return {
    source,
    status: "active" as const,
    origin: "trusted" as const,
    confidence: source === "curated" ? 0.6 : CONFIDENCE.learned,
    recallCount: 0,
    reinforcedCount: 0,
    lastRecalledAt: null,
  };
}

/** L2 distance between unit vectors (matches the real service's `<->`). */
function l2(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return Math.sqrt(s);
}

/**
 * In-memory implementation of IMemoryService for offline/demo use. Region is
 * assigned round-robin to mimic REGIONAL BY ROW distribution so the UI's
 * survivability panel has realistic per-region counts.
 */
export class MockMemoryService implements IMemoryService {
  private incidents: Vec<Incident>[] = [];
  private runbooks: Vec<Runbook>[] = [];
  /** Semantic memory: reflections/insights, always embedded. */
  private memories: Vec<MemoryItem>[] = [];
  /** Conversational stream: never embedded, read by recency. */
  private stream: MemoryItem[] = [];
  /**
   * Monotonic write counter. Two writes in the same millisecond share a
   * created_at, so recency ordering needs a tiebreak the wall clock cannot
   * give us. CockroachDB has MVCC timestamps for this; the mock keeps a seq.
   */
  private seq = 0;
  private writeOrder = new Map<string, number>();
  private states = new Map<string, IncidentStateRecord>();
  private services: Service[] = [];
  private hygieneEvents: HygieneEvent[] = [];
  private seeded: Promise<void>;
  private regionCursor = 0;

  constructor() {
    this.seeded = this.seed();
  }

  private nextRegion(): string {
    const r = REGIONS[this.regionCursor % REGIONS.length]!;
    this.regionCursor++;
    return r;
  }

  private async seed(): Promise<void> {
    for (const s of SERVICES) {
      this.services.push({
        id: randomUUID(),
        name: s.name,
        environment: "production",
        ownerTeam: s.team,
        region: this.nextRegion(),
      });
    }

    for (const inc of HISTORICAL_INCIDENTS) {
      const embedding = await embed(`${inc.title}\n\n${inc.summary}`);
      this.incidents.push({
        embedding,
        row: {
          id: randomUUID(),
          serviceId: this.services.find((s) => s.name === inc.service)!.id,
          title: inc.title,
          summary: inc.summary,
          severity: inc.severity,
          status: "resolved",
          signals: null,
          resolution: inc.resolution,
          region: this.nextRegion(),
          openedAt: new Date(0).toISOString(),
          resolvedAt: new Date(0).toISOString(),
        },
      });
    }

    for (const rb of RUNBOOKS) {
      const embedding = await embed(`${rb.title}\n\n${rb.body}`);
      this.runbooks.push({
        embedding,
        row: {
          id: randomUUID(),
          title: rb.title,
          body: rb.body,
          tags: rb.tags,
          region: this.nextRegion(),
          ...defaultHygiene("curated"),
        },
      });
    }
  }

  async listServices(): Promise<Service[]> {
    await this.seeded;
    return [...this.services];
  }

  async resolveService(name: string): Promise<Service> {
    await this.seeded;
    const normalized = name.trim().toLowerCase();
    let svc = this.services.find((s) => s.name === normalized);
    if (!svc) {
      svc = {
        id: randomUUID(),
        name: normalized,
        environment: "production",
        ownerTeam: null,
        region: this.nextRegion(),
      };
      this.services.push(svc);
    }
    return svc;
  }

  async getIncident(incidentId: string): Promise<Incident | null> {
    await this.seeded;
    return this.incidents.find((i) => i.row.id === incidentId)?.row ?? null;
  }

  async recordIncident(input: {
    serviceId: string;
    title: string;
    summary: string;
    severity: Severity;
    signals?: unknown;
  }): Promise<Incident> {
    await this.seeded;
    const row: Incident = {
      id: randomUUID(),
      serviceId: input.serviceId,
      title: input.title,
      summary: input.summary,
      severity: input.severity,
      status: "open",
      signals: input.signals ?? null,
      resolution: null,
      region: this.nextRegion(),
      openedAt: new Date().toISOString(),
      resolvedAt: null,
    };
    this.incidents.push({ row, embedding: await embed(`${input.title}\n\n${input.summary}`) });
    return row;
  }

  async resolveIncident(incidentId: string, resolution: string): Promise<void> {
    await this.seeded;
    const hit = this.incidents.find((i) => i.row.id === incidentId);
    if (hit) {
      hit.row.status = "resolved";
      hit.row.resolution = resolution;
      hit.row.resolvedAt = new Date().toISOString();
    }
  }

  async recallSimilarIncidents(situation: string, limit = 5): Promise<RecallHit<Incident>[]> {
    await this.seeded;
    const q = await embed(situation);
    const candidates = this.incidents
      .filter((i) => i.row.status === "resolved" && i.row.resolution)
      .map((i) => ({
        distance: l2(q, i.embedding),
        embedding: i.embedding,
        signature: episodeSignature(i.row.title),
        row: i.row,
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, overfetchFor(limit));

    return consolidateEpisodes(candidates, limit).map((c) => ({
      item: c.representative.row,
      distance: c.representative.distance,
      occurrences: c.occurrences,
    }));
  }

  async upsertRunbook(input: { title: string; body: string; tags?: string[] }): Promise<Runbook> {
    await this.seeded;
    const row: Runbook = {
      id: randomUUID(),
      title: input.title,
      body: input.body,
      tags: input.tags ?? [],
      region: this.nextRegion(),
      ...defaultHygiene("curated"),
    };
    this.runbooks.push({ row, embedding: await embed(`${input.title}\n\n${input.body}`) });
    return row;
  }

  async recallRunbooks(situation: string, limit = 3): Promise<RecallHit<Runbook>[]> {
    await this.seeded;
    const q = await embed(situation);
    const hits = this.runbooks
      .filter((r) => r.row.status === "active")
      .map((r) => ({ item: r.row, distance: l2(q, r.embedding) }))
      .sort(
        (a, b) =>
          a.distance * (1 - 0.2 * (a.item.confidence - 0.5)) -
          b.distance * (1 - 0.2 * (b.item.confidence - 0.5)),
      )
      .slice(0, limit);
    for (const h of hits) {
      h.item.recallCount++;
      h.item.lastRecalledAt = new Date().toISOString();
    }
    return hits;
  }

  // ---- Memory hygiene (parity with MemoryService) ---------------------------

  async commitLearnedRunbook(input: {
    incidentId: string;
    title: string;
    body: string;
    tags?: string[];
    trusted?: boolean;
  }): Promise<LearnOutcome> {
    await this.seeded;
    // Fail closed, exactly as the CockroachDB-backed service does.
    const trusted = input.trusted === true;

    const gate = gateRunbookContent(input.body);
    if (!gate.ok) {
      this.logHygiene("rejected", null, `write rejected: ${gate.reason} (incident ${input.incidentId})`);
      return { action: "rejected", detail: gate.reason };
    }

    const embedding = await embed(`${input.title}\n\n${input.body}`);
    const active = this.runbooks.filter((r) => r.row.status === "active");
    const nearest = active
      .map((r) => ({ r, distance: l2(embedding, r.embedding) }))
      .sort((a, b) => a.distance - b.distance)[0];

    const decision = classifyLearnedWrite(
      nearest ? { distance: nearest.distance, body: nearest.r.row.body } : null,
      input.body,
    );

    if (decision.kind === "merge" && nearest && trusted) {
      nearest.r.row.reinforcedCount++;
      nearest.r.row.confidence = Math.min(
        CONFIDENCE.max,
        nearest.r.row.confidence + CONFIDENCE.reinforceStep,
      );
      const detail = `consolidated into "${nearest.r.row.title}" (distance ${nearest.distance.toFixed(3)}) instead of duplicating`;
      this.logHygiene("merged", nearest.r.row.id, detail);
      return { action: "merged", runbookId: nearest.r.row.id, detail };
    }

    const contradicts = decision.kind === "contradiction" && nearest ? nearest.r.row : null;
    const row: Runbook = {
      id: randomUUID(),
      title: input.title,
      body: input.body,
      tags: input.tags ?? [],
      region: this.nextRegion(),
      ...defaultHygiene("learned"),
      status: trusted ? "active" : "quarantined",
      origin: trusted ? "trusted" : "anonymous",
      confidence: contradicts ? CONFIDENCE.contradicted : CONFIDENCE.learned,
    };
    this.runbooks.push({ row, embedding });

    if (!trusted) {
      const detail =
        "written by an unauthenticated session — quarantined pending operator " +
        "review; stored and auditable, but never recalled";
      this.logHygiene("quarantined", row.id, detail);
      return { action: "quarantined", runbookId: row.id, detail };
    }

    if (contradicts) {
      const detail =
        `new fix disagrees with "${contradicts.title}" for a similar situation; ` +
        `kept both, new one on probation (confidence ${row.confidence})`;
      this.logHygiene("contradiction", row.id, detail);
      return { action: "accepted", runbookId: row.id, contradictsId: contradicts.id, detail };
    }
    const detail = `learned runbook accepted (confidence ${row.confidence}) from incident ${input.incidentId}`;
    this.logHygiene("accepted", row.id, detail);
    return { action: "accepted", runbookId: row.id, detail };
  }

  /**
   * The learning loop as one unit. The mock has no transaction manager, so it
   * mirrors the real service's ATOMICITY by snapshotting the mutable state and
   * restoring it if any step throws — same contract, same observable outcome.
   */
  async completeIncident(input: {
    incidentId: string;
    resolution: string;
    sessionId: string;
    recalledRunbookIds: string[];
    trusted?: boolean;
  }): Promise<CompleteIncidentOutcome> {
    await this.seeded;
    const snapshot = {
      runbooks: this.runbooks.map((r) => ({ ...r, row: { ...r.row } })),
      memories: [...this.memories],
      hygieneEvents: [...this.hygieneEvents],
      incidents: this.incidents.map((i) => ({ ...i, row: { ...i.row } })),
    };
    try {
      await this.resolveIncident(input.incidentId, input.resolution);
      const title = (await this.getIncident(input.incidentId))?.title ?? "untitled incident";
      const learn = await this.commitLearnedRunbook({
        incidentId: input.incidentId,
        title: `Learned runbook: ${title}`,
        body:
          `Distilled from incident ${input.incidentId} ` +
          `(${new Date().toISOString().slice(0, 10)}):\n${input.resolution}`,
        tags: ["learned", "auto-postmortem"],
        trusted: input.trusted,
      });
      const reinforced = await this.reinforceRunbooks(input.recalledRunbookIds);
      const reflection = await this.remember({
        sessionId: input.sessionId,
        incidentId: input.incidentId,
        kind: "reflection",
        content: `Resolved "${title}". Learned: ${input.resolution}`,
        importance: 0.9,
      });
      return { learn, reinforced, reflectionId: reflection.id };
    } catch (err) {
      this.runbooks = snapshot.runbooks;
      this.memories = snapshot.memories;
      this.hygieneEvents = snapshot.hygieneEvents;
      this.incidents = snapshot.incidents;
      throw err;
    }
  }

  async promoteRunbook(runbookId: string): Promise<boolean> {
    await this.seeded;
    const hit = this.runbooks.find((r) => r.row.id === runbookId && r.row.status === "quarantined");
    if (!hit) return false;
    hit.row.status = "active";
    hit.row.origin = "trusted";
    this.logHygiene(
      "promoted",
      hit.row.id,
      `"${hit.row.title}" promoted out of quarantine by a trusted operator`,
    );
    return true;
  }

  async listQuarantined(limit = 20): Promise<Runbook[]> {
    await this.seeded;
    return this.runbooks
      .filter((r) => r.row.status === "quarantined")
      .slice(0, Math.max(1, Math.min(100, limit)))
      .map((r) => r.row);
  }

  async reinforceRunbooks(runbookIds: string[]): Promise<number> {
    await this.seeded;
    let count = 0;
    for (const r of this.runbooks) {
      if (runbookIds.includes(r.row.id) && r.row.status === "active") {
        r.row.confidence = Math.min(CONFIDENCE.max, r.row.confidence + CONFIDENCE.reinforceStep);
        r.row.reinforcedCount++;
        count++;
      }
    }
    if (count > 0) {
      this.logHygiene("reinforced", null, `${count} recalled runbook(s) reinforced after successful resolution`);
    }
    return count;
  }

  async decayRunbooks(): Promise<{ decayed: number; archived: number }> {
    await this.seeded;
    // The mock has no long-lived clock; decay everything learned and unused.
    let decayed = 0;
    let archived = 0;
    for (const r of this.runbooks) {
      if (r.row.source !== "learned" || r.row.status !== "active") continue;
      if (r.row.recallCount === 0 && r.row.reinforcedCount === 0) {
        r.row.confidence = Math.max(CONFIDENCE.floor, r.row.confidence - CONFIDENCE.decayStep);
        decayed++;
        if (r.row.confidence < CONFIDENCE.archiveBelow) {
          r.row.status = "archived";
          archived++;
          this.logHygiene("archived", r.row.id, `"${r.row.title}" archived: never earned trust`);
        }
      }
    }
    if (decayed > 0) this.logHygiene("decayed", null, `${decayed} unused learned runbook(s) lost confidence`);
    return { decayed, archived };
  }

  async recentHygieneEvents(limit = 20): Promise<HygieneEvent[]> {
    await this.seeded;
    return this.hygieneEvents.slice(-Math.max(1, Math.min(100, limit))).reverse();
  }

  private logHygiene(action: HygieneAction, targetId: string | null, detail: string): void {
    this.hygieneEvents.push({
      id: randomUUID(),
      action,
      targetKind: "runbook",
      targetId,
      detail,
      createdAt: new Date().toISOString(),
    });
  }

  /** Kind routes the write, exactly as in the CockroachDB-backed service. */
  async remember(input: {
    sessionId: string;
    incidentId?: string | null;
    kind: MemoryKind;
    content: string;
    importance?: number;
  }): Promise<MemoryItem> {
    await this.seeded;
    const row: MemoryItem = {
      id: randomUUID(),
      sessionId: input.sessionId,
      incidentId: input.incidentId ?? null,
      kind: input.kind,
      content: input.content,
      importance: input.importance ?? 0.5,
      region: this.nextRegion(),
      createdAt: new Date().toISOString(),
    };
    this.writeOrder.set(row.id, this.seq++);
    if (isStreamKind(input.kind)) {
      this.stream.push(row);
    } else {
      this.memories.push({ row, embedding: await embed(input.content) });
    }
    return row;
  }

  async recallMemories(query: string, limit = 6): Promise<RecallHit<MemoryItem>[]> {
    await this.seeded;
    const q = await embed(query);
    return this.memories
      .map((m) => ({
        item: m.row,
        distance: l2(q, m.embedding) * (1 - 0.3 * m.row.importance),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
  }

  async recentMemories(limit = 12, sessionId?: string): Promise<MemoryItem[]> {
    await this.seeded;
    const capped = Math.max(1, Math.min(50, Math.floor(limit)));
    const all = [...this.stream, ...this.memories.map((m) => m.row)];
    return all
      .filter((m) => !sessionId || m.sessionId === sessionId)
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
        return (this.writeOrder.get(b.id) ?? 0) - (this.writeOrder.get(a.id) ?? 0);
      })
      .slice(0, capped);
  }

  async getIncidentState(incidentId: string): Promise<IncidentStateRecord | null> {
    await this.seeded;
    return this.states.get(incidentId) ?? null;
  }

  async updateIncidentState(input: {
    incidentId: string;
    phase: IncidentPhase;
    hypotheses: string[];
    actionsTaken: string[];
    nextSteps: string[];
  }): Promise<void> {
    await this.seeded;
    this.states.set(input.incidentId, {
      incidentId: input.incidentId,
      phase: input.phase,
      hypotheses: input.hypotheses,
      actionsTaken: input.actionsTaken,
      nextSteps: input.nextSteps,
      region: this.states.get(input.incidentId)?.region ?? REGIONS[0]!,
      updatedAt: new Date().toISOString(),
    });
  }

  /** For the mock /api/regions route: per-region memory counts. */
  regionDistribution(): { region: string; rows: number }[] {
    const counts = new Map<string, number>();
    for (const r of REGIONS) counts.set(r, 0);
    for (const i of this.incidents) counts.set(i.row.region, (counts.get(i.row.region) ?? 0) + 1);
    for (const r of this.runbooks) counts.set(r.row.region, (counts.get(r.row.region) ?? 0) + 1);
    for (const m of this.memories) counts.set(m.row.region, (counts.get(m.row.region) ?? 0) + 1);
    for (const s of this.stream) counts.set(s.region, (counts.get(s.region) ?? 0) + 1);
    return REGIONS.map((region) => ({ region, rows: counts.get(region) ?? 0 }));
  }
}
