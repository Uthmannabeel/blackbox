/** Shared domain types for the BlackBox memory layer. */

export type Severity = "SEV1" | "SEV2" | "SEV3" | "SEV4";
export type IncidentStatus = "open" | "mitigated" | "resolved";
export type IncidentPhase = "triage" | "diagnose" | "mitigate" | "resolve";

/** The kind of thing stored in the agent's memory stream. */
export type MemoryKind =
  | "observation"
  | "action"
  | "reflection"
  | "user_msg"
  | "agent_msg";

export interface Service {
  id: string;
  name: string;
  environment: string;
  ownerTeam: string | null;
  region: string;
}

export interface Incident {
  id: string;
  serviceId: string;
  title: string;
  summary: string;
  severity: Severity;
  status: IncidentStatus;
  signals: unknown;
  resolution: string | null;
  region: string;
  openedAt: string;
  resolvedAt: string | null;
}

export type RunbookSource = "curated" | "learned";
export type RunbookStatus = "active" | "archived";

export interface Runbook {
  id: string;
  title: string;
  body: string;
  tags: string[];
  region: string;
  /** Where this runbook came from: human-curated or distilled by the agent. */
  source: RunbookSource;
  /** Archived runbooks are invisible to recall (decayed out, never deleted). */
  status: RunbookStatus;
  /** 0..1 — provisional learned knowledge starts low and earns trust. */
  confidence: number;
  recallCount: number;
  reinforcedCount: number;
  lastRecalledAt: string | null;
}

/** A memory-write-path decision recorded by the hygiene layer. */
export type HygieneAction =
  | "accepted"
  | "rejected"
  | "merged"
  | "contradiction"
  | "reinforced"
  | "archived"
  | "decayed";

export interface HygieneEvent {
  id: string;
  action: HygieneAction;
  targetKind: "runbook" | "memory";
  targetId: string | null;
  detail: string;
  createdAt: string;
}

/** Outcome of committing a learned runbook through the hygiene gate. */
export interface LearnOutcome {
  action: "accepted" | "merged" | "rejected";
  /** The runbook that now carries this knowledge (absent when rejected). */
  runbookId?: string;
  /** Set when the new knowledge disagrees with an existing similar runbook. */
  contradictsId?: string;
  detail: string;
}

export interface MemoryItem {
  id: string;
  sessionId: string;
  incidentId: string | null;
  kind: MemoryKind;
  content: string;
  importance: number;
  region: string;
  createdAt: string;
}

/** A recall hit: a memory row plus its similarity distance to the query. */
export interface RecallHit<T> {
  item: T;
  distance: number;
}

export interface IncidentStateRecord {
  incidentId: string;
  phase: IncidentPhase;
  hypotheses: string[];
  actionsTaken: string[];
  nextSteps: string[];
  region: string;
  updatedAt: string;
}

/**
 * The memory contract the agent depends on. Both the CockroachDB-backed
 * MemoryService and the in-memory MockMemoryService implement this, so the
 * agent works identically online and offline.
 */
export interface IMemoryService {
  listServices(): Promise<Service[]>;
  /** Find a service by name, creating it if unknown (agents pass names, not UUIDs). */
  resolveService(name: string): Promise<Service>;
  recordIncident(input: {
    serviceId: string;
    title: string;
    summary: string;
    severity: Severity;
    signals?: unknown;
  }): Promise<Incident>;
  getIncident(incidentId: string): Promise<Incident | null>;
  resolveIncident(incidentId: string, resolution: string): Promise<void>;
  recallSimilarIncidents(situation: string, limit?: number): Promise<RecallHit<Incident>[]>;
  upsertRunbook(input: { title: string; body: string; tags?: string[] }): Promise<Runbook>;
  recallRunbooks(situation: string, limit?: number): Promise<RecallHit<Runbook>[]>;
  /**
   * The learning loop's ONLY entry point for agent-distilled runbooks.
   * Unlike upsertRunbook (curated content), this runs the hygiene gate:
   * content filtering, near-duplicate consolidation, and contradiction
   * detection — and records every decision as a hygiene event.
   */
  commitLearnedRunbook(input: {
    incidentId: string;
    title: string;
    body: string;
    tags?: string[];
  }): Promise<LearnOutcome>;
  /** Positive feedback: these runbooks were recalled and the incident resolved. */
  reinforceRunbooks(runbookIds: string[]): Promise<number>;
  /** Maintenance: decay unused learned knowledge; archive what never earned trust. */
  decayRunbooks(): Promise<{ decayed: number; archived: number }>;
  /** Recent write-path decisions, for the console's hygiene feed. */
  recentHygieneEvents(limit?: number): Promise<HygieneEvent[]>;
  remember(input: {
    sessionId: string;
    incidentId?: string | null;
    kind: MemoryKind;
    content: string;
    importance?: number;
    /** Skip embedding this entry (default true). Used for high-volume stream
     *  writes that don't need semantic recall — saves embedding calls. */
    embed?: boolean;
  }): Promise<MemoryItem>;
  recallMemories(query: string, limit?: number): Promise<RecallHit<MemoryItem>[]>;
  /** Most recent entries in the agent's memory stream (for the UI feed). */
  recentMemories(limit?: number, sessionId?: string): Promise<MemoryItem[]>;
  getIncidentState(incidentId: string): Promise<IncidentStateRecord | null>;
  updateIncidentState(input: {
    incidentId: string;
    phase: IncidentPhase;
    hypotheses: string[];
    actionsTaken: string[];
    nextSteps: string[];
  }): Promise<void>;
}
