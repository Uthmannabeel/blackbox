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
 * Two recalled episodes closer than this to each other are the SAME failure
 * signature seen on different days, not two independent pieces of evidence.
 * Chosen from live measurements: repeat firings of one seeded failure mode sit
 * at ~0.01-0.06 apart, while genuinely distinct incidents are >0.3 apart.
 */
export const EPISODE_DUPLICATE_DISTANCE = 0.15;

/**
 * How many rows to fetch before consolidating down to `limit` episodes.
 *
 * Sized from live measurement, not guesswork. On the production corpus the
 * single most common failure signature accounts for ~74 of the nearest 150
 * rows, so a narrow over-fetch returns one episode where the caller asked for
 * five. Measured against the 3-region managed cluster:
 *
 *   LIMIT  40 -> 1 distinct episode
 *   LIMIT  80 -> 2 distinct episodes
 *   LIMIT 150 -> 5 distinct episodes, ~1.2s
 *   LIMIT 300 -> 5 distinct episodes, ~1.24s
 *   LIMIT 600 -> 5 distinct episodes, ~1.8s   (paying for nothing)
 *
 * 30x the requested limit, capped at 300, sits on the flat part of that curve.
 */
export function overfetchFor(limit: number): number {
  return Math.min(300, Math.max(limit * 30, 60));
}

/** A recall candidate that can be consolidated: needs a vector and a label. */
export interface Consolidatable {
  distance: number;
  /** Full-precision embedding, when available, for pairwise comparison. */
  embedding?: number[];
  /** Fallback signature when no embedding is at hand (normalised title). */
  signature: string;
}

/** L2 distance between two unit vectors — matches CockroachDB's `<->`. */
export function l2(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    s += d * d;
  }
  return Math.sqrt(s);
}

/**
 * Collapse an over-fetched candidate list into DISTINCT episodes.
 *
 * Episodic memory in an SRE fleet is inherently repetitive: the same failure
 * mode fires dozens of times across months. Returning the five nearest rows
 * therefore returns one memory five times, which wastes the agent's context
 * and makes the evidence ledger look like a padded corpus.
 *
 * Consolidation keeps the nearest representative of each cluster and reports
 * how many times that signature recurred. Recurrence is not noise — "we have
 * seen this 47 times" is the single most useful thing institutional memory can
 * tell an on-call engineer, so it is surfaced rather than discarded.
 *
 * Candidates must already be sorted nearest-first.
 */
export function consolidateEpisodes<T extends Consolidatable>(
  candidates: T[],
  limit: number,
  threshold = EPISODE_DUPLICATE_DISTANCE,
): { representative: T; occurrences: number; nearestDuplicate: number | null }[] {
  const clusters: { representative: T; occurrences: number; nearestDuplicate: number | null }[] = [];

  for (const c of candidates) {
    // Same episode if EITHER signal says so. The signature catches templated
    // repeats whose embeddings drift apart on the varying numbers; the vector
    // catches restatements of one event under different titles. Using only
    // whichever signal happens to be present would make the SQL-backed and
    // in-memory services disagree on identical data.
    const existing = clusters.find((cluster) => {
      const rep = cluster.representative;
      if (rep.signature === c.signature) return true;
      return Boolean(
        rep.embedding && c.embedding && l2(rep.embedding, c.embedding) < threshold,
      );
    });
    if (existing) {
      existing.occurrences++;
      if (existing.nearestDuplicate === null) existing.nearestDuplicate = c.distance;
      continue;
    }
    clusters.push({ representative: c, occurrences: 1, nearestDuplicate: null });
  }

  return clusters.slice(0, limit);
}

/** Normalise an episode title into a comparison signature (digits elided). */
export function episodeSignature(title: string): string {
  return title
    .toLowerCase()
    .replace(/\d+(\.\d+)?/g, "#")
    .replace(/[^a-z#\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
