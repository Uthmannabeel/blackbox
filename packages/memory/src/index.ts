import { MemoryService } from "./memory.js";
import { MockMemoryService } from "./mockMemory.js";
import { isMock } from "./env.js";
import type { IMemoryService } from "./types.js";

export { MemoryService } from "./memory.js";
export { MockMemoryService } from "./mockMemory.js";
export { getPool, closePool } from "./db.js";
export { embed, EMBED_DIM } from "./embeddings.js";
export { isMock, isMockEmbeddings, loadEnv } from "./env.js";
export { regionLiveness, clusterHealth } from "./clusterHealth.js";
export type { RegionHealth, ClusterHealth } from "./clusterHealth.js";
export { snapshotAsOf, residencyProof } from "./timeTravel.js";
export type { MemorySnapshot, ResidencyProof } from "./timeTravel.js";
export { hitRateLimit } from "./rateLimit.js";
export {
  CONFIDENCE,
  DUPLICATE_DISTANCE,
  CONTRADICTION_DISTANCE,
  gateRunbookContent,
  tokenOverlap,
  classifyLearnedWrite,
} from "./hygiene.js";
export type { RateResult } from "./rateLimit.js";
export * from "./types.js";

/**
 * Return the shared memory backend for the current environment: the in-memory
 * mock when BLACKBOX_MOCK is set, otherwise the CockroachDB-backed service.
 *
 * Singleton by design — agents and API routes must see the same store. The
 * real service is stateless over the pg pool, and in mock mode a shared
 * instance is what makes the memory behave like one database.
 */
let shared: IMemoryService | undefined;

export function createMemoryService(): IMemoryService {
  if (!shared) {
    shared = isMock() ? new MockMemoryService() : new MemoryService();
  }
  return shared;
}
