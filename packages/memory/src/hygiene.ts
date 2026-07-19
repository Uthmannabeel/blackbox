/**
 * Memory hygiene — the write-path policy for agent-learned knowledge.
 *
 * The 2026 agent-memory literature is blunt about self-improving loops: one
 * bad write pollutes recall for every step downstream, and a store that only
 * appends is a log, not a memory. This module holds the deterministic policy
 * pieces (content gate, similarity thresholds, contradiction heuristic);
 * MemoryService applies them transactionally against CockroachDB.
 *
 * All thresholds are L2 distances between unit vectors (d = sqrt(2 - 2*cos)),
 * matching both the C-SPANN index metric and the mock embedder.
 */

/** Nearer than this to an existing runbook -> same knowledge; consolidate. */
export const DUPLICATE_DISTANCE = 0.45; // cos ~ 0.90

/**
 * Nearer than this (but not a duplicate) -> same situation. If the bodies
 * materially disagree, that is a contradiction worth flagging.
 */
export const CONTRADICTION_DISTANCE = 0.75; // cos ~ 0.72

/** Body-text overlap below this (for a similar situation) reads as disagreement. */
export const CONTRADICTION_OVERLAP = 0.25;

/** Confidence ladder for learned knowledge. */
export const CONFIDENCE = {
  /** A learned runbook that passed the gate cleanly. */
  learned: 0.5,
  /** A learned runbook that contradicts existing knowledge: kept, but on probation. */
  contradicted: 0.35,
  /** Bump when the same fix is re-learned (merged) or recalled into a real resolution. */
  reinforceStep: 0.08,
  /** Slow decay for learned knowledge nobody recalls. */
  decayStep: 0.05,
  max: 0.95,
  floor: 0.2,
  /** Learned rows that fall to the floor without ever being used get archived. */
  archiveBelow: 0.3,
} as const;

/** Days of disuse before a learned runbook starts decaying / gets archived. */
export const DECAY_AFTER_DAYS = 7;
export const ARCHIVE_AFTER_DAYS = 14;

export interface GateResult {
  ok: boolean;
  reason: string;
}

/**
 * Content gate for a distilled resolution. Deterministic and conservative:
 * it rejects writes that could not possibly be a reusable fix, and lets the
 * similarity layer handle everything semantic.
 */
export function gateRunbookContent(body: string): GateResult {
  const text = body.trim();
  const words = text.split(/\s+/).filter(Boolean);

  if (text.length < 40 || words.length < 8) {
    return { ok: false, reason: "too short to be a reusable fix" };
  }
  // A resolution that is mostly a question is not a resolution.
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const questions = (text.match(/\?/g) ?? []).length;
  if (questions >= Math.max(1, sentences.length)) {
    return { ok: false, reason: "reads as a question, not a fix" };
  }
  // Uncertainty markers: the agent must not commit "I'm not sure" to memory.
  if (/\b(i (do not|don't) know|not sure|cannot determine|unclear why|no idea)\b/i.test(text)) {
    return { ok: false, reason: "contains unresolved uncertainty" };
  }
  // Failure narrations are incident notes, not runbooks.
  if (/\b(unable to (resolve|fix|mitigate)|could not (resolve|fix|reproduce))\b/i.test(text)) {
    return { ok: false, reason: "describes a failure to fix, not a fix" };
  }
  return { ok: true, reason: "passed content gate" };
}

/**
 * Jaccard overlap of word sets — a cheap, embedding-independent signal for
 * whether two texts say the same thing. Used only to separate "same situation,
 * same fix" from "same situation, different fix" (a contradiction).
 */
export function tokenOverlap(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared++;
  return shared / (setA.size + setB.size - shared);
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 2);
}

/**
 * Classify a gated learned write against its nearest active neighbour.
 * Pure decision logic shared by the real and mock services.
 */
export function classifyLearnedWrite(
  nearest: { distance: number; body: string } | null,
  newBody: string,
):
  | { kind: "merge" }
  | { kind: "contradiction" }
  | { kind: "insert" } {
  if (!nearest) return { kind: "insert" };
  if (nearest.distance < DUPLICATE_DISTANCE) return { kind: "merge" };
  if (
    nearest.distance < CONTRADICTION_DISTANCE &&
    tokenOverlap(nearest.body, newBody) < CONTRADICTION_OVERLAP
  ) {
    return { kind: "contradiction" };
  }
  return { kind: "insert" };
}
