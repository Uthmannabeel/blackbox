/** Shared domain types for the BlackBox memory layer. */

export type Severity = "SEV1" | "SEV2" | "SEV3" | "SEV4";
export type IncidentStatus = "open" | "mitigated" | "resolved";
export type IncidentPhase = "triage" | "diagnose" | "mitigate" | "resolve";

/**
 * Conversational/working record: high volume, read by recency, never embedded.
 * Stored in `agent_stream`.
 */
export type StreamKind = "user_msg" | "agent_msg" | "observation" | "action";

/**
 * Durable semantic memory: always embedded, recallable by similarity.
 * Stored in `agent_memory`.
 */
export type SemanticKind = "reflection" | "insight";

/** Anything the agent can write to its memory layer. */
export type MemoryKind = StreamKind | SemanticKind;

const STREAM_KINDS: readonly StreamKind[] = ["user_msg", "agent_msg", "observation", "action"];

/** Which physical table a memory write belongs in. */
export function isStreamKind(kind: MemoryKind): kind is StreamKind {
  return (STREAM_KINDS as readonly string[]).includes(kind);
}

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
export type RunbookStatus = "active" | "quarantined" | "archived";
/** Trust level of whoever caused this runbook to be written. */
export type RunbookOrigin = "trusted" | "anonymous";

export interface Runbook {
  id: string;
  title: string;
  body: string;
  tags: string[];
  region: string;
  /** Where this runbook came from: human-curated or distilled by the agent. */
  source: RunbookSource;
  /**
   * active      — recallable.
   * quarantined — written by an unauthenticated session; auditable but never
   *               recalled until promoted by a trusted operator.
   * archived    — decayed out (never earned trust); kept for the audit trail.
   */
  status: RunbookStatus;
  /** Whether the writing session was authenticated. */
  origin: RunbookOrigin;
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
  | "quarantined"
  | "promoted"
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
  action: "accepted" | "merged" | "rejected" | "quarantined";
  /** The runbook that now carries this knowledge (absent when rejected). */
  runbookId?: string;
  /** Set when the new knowledge disagrees with an existing similar runbook. */
  contradictsId?: string;
  detail: string;
}

/** Everything the atomic incident-completion transaction reports back. */
export interface CompleteIncidentOutcome {
  learn: LearnOutcome;
  /** How many recalled runbooks earned confidence from this resolution. */
  reinforced: number;
  /** The reflection written to semantic memory (null if the incident vanished). */
  reflectionId: string | null;
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
  /**
   * How many near-identical episodes this hit stands for after consolidation.
   * 1 = a one-off. >1 = a recurring failure signature, and the count is itself
   * evidence ("we have seen this 47 times"). Absent on non-consolidated recalls.
   */
  occurrences?: number;
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
    /**
     * False when the writing session is unauthenticated (the public console).
     * Untrusted writes are quarantined: kept and auditable, never recalled,
     * until an operator promotes them. Defaults to false — a caller must opt
     * IN to trust, so forgetting the flag fails closed.
     */
    trusted?: boolean;
  }): Promise<LearnOutcome>;
  /**
   * Resolve an incident, distil its fix through the hygiene gate, reinforce the
   * runbooks that helped, and write the reflection — as ONE transaction.
   * Either the whole learning loop lands or none of it does; a half-written
   * lesson is worse than no lesson.
   */
  completeIncident(input: {
    incidentId: string;
    resolution: string;
    sessionId: string;
    /** Runbook ids recalled during this investigation (they earn confidence). */
    recalledRunbookIds: string[];
    trusted?: boolean;
  }): Promise<CompleteIncidentOutcome>;
  /** Release a quarantined runbook into recall (trusted-operator action). */
  promoteRunbook(runbookId: string): Promise<boolean>;
  /** Quarantined learned knowledge awaiting operator review. */
  listQuarantined(limit?: number): Promise<Runbook[]>;
  /** Positive feedback: these runbooks were recalled and the incident resolved. */
  reinforceRunbooks(runbookIds: string[]): Promise<number>;
  /** Maintenance: decay unused learned knowledge; archive what never earned trust. */
  decayRunbooks(): Promise<{ decayed: number; archived: number }>;
  /** Recent write-path decisions, for the console's hygiene feed. */
  recentHygieneEvents(limit?: number): Promise<HygieneEvent[]>;
  /**
   * Write to memory. The KIND decides the destination, not a caller flag:
   * stream kinds append to `agent_stream` unembedded, semantic kinds are
   * always embedded into `agent_memory`. There is no way to write an
   * unembedded row into the semantic table.
   */
  remember(input: {
    sessionId: string;
    incidentId?: string | null;
    kind: MemoryKind;
    content: string;
    importance?: number;
  }): Promise<MemoryItem>;
  /** Similarity search over semantic memory. Every row here is truly embedded. */
  recallMemories(query: string, limit?: number): Promise<RecallHit<MemoryItem>[]>;
  /** Most recent entries across stream + semantic memory (for the UI feed). */
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
