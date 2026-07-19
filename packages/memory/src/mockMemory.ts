import { randomUUID } from "node:crypto";
import { embed } from "./embeddings.js";
import { CONFIDENCE, classifyLearnedWrite, gateRunbookContent } from "./hygiene.js";
import { HISTORICAL_INCIDENTS, RUNBOOKS, SERVICES } from "./seedData.js";
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
  private memories: Vec<MemoryItem>[] = [];
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
    return this.incidents
      .filter((i) => i.row.status === "resolved" && i.row.resolution)
      .map((i) => ({ item: i.row, distance: l2(q, i.embedding) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
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
  }): Promise<LearnOutcome> {
    await this.seeded;
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

    if (decision.kind === "merge" && nearest) {
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
      confidence: contradicts ? CONFIDENCE.contradicted : CONFIDENCE.learned,
    };
    this.runbooks.push({ row, embedding });

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

  async remember(input: {
    sessionId: string;
    incidentId?: string | null;
    kind: MemoryKind;
    content: string;
    importance?: number;
    embed?: boolean;
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
    this.memories.push({ row, embedding: await embed(input.content) });
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
    const rows = sessionId
      ? this.memories.filter((m) => m.row.sessionId === sessionId)
      : this.memories;
    return rows
      .slice(-capped)
      .reverse()
      .map((m) => m.row);
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
    return REGIONS.map((region) => ({ region, rows: counts.get(region) ?? 0 }));
  }
}
