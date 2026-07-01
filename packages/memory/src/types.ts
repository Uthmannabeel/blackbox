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

export interface Runbook {
  id: string;
  title: string;
  body: string;
  tags: string[];
  region: string;
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
  recordIncident(input: {
    serviceId: string;
    title: string;
    summary: string;
    severity: Severity;
    signals?: unknown;
  }): Promise<Incident>;
  resolveIncident(incidentId: string, resolution: string): Promise<void>;
  recallSimilarIncidents(situation: string, limit?: number): Promise<RecallHit<Incident>[]>;
  upsertRunbook(input: { title: string; body: string; tags?: string[] }): Promise<Runbook>;
  recallRunbooks(situation: string, limit?: number): Promise<RecallHit<Runbook>[]>;
  remember(input: {
    sessionId: string;
    incidentId?: string | null;
    kind: MemoryKind;
    content: string;
    importance?: number;
  }): Promise<MemoryItem>;
  recallMemories(query: string, limit?: number): Promise<RecallHit<MemoryItem>[]>;
  getIncidentState(incidentId: string): Promise<IncidentStateRecord | null>;
  updateIncidentState(input: {
    incidentId: string;
    phase: IncidentPhase;
    hypotheses: string[];
    actionsTaken: string[];
    nextSteps: string[];
  }): Promise<void>;
}
