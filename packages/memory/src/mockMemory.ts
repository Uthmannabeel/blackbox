import { randomUUID } from "node:crypto";
import { embed } from "./embeddings.js";
import { HISTORICAL_INCIDENTS, RUNBOOKS, SERVICES } from "./seedData.js";
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

const REGIONS = ["aws-us-east-1", "aws-eu-west-1", "aws-ap-south-1"];

interface Vec<T> {
  row: T;
  embedding: number[];
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
    };
    this.runbooks.push({ row, embedding: await embed(`${input.title}\n\n${input.body}`) });
    return row;
  }

  async recallRunbooks(situation: string, limit = 3): Promise<RecallHit<Runbook>[]> {
    await this.seeded;
    const q = await embed(situation);
    return this.runbooks
      .map((r) => ({ item: r.row, distance: l2(q, r.embedding) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
  }

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
