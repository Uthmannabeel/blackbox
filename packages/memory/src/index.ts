import { MemoryService } from "./memory.js";
import { MockMemoryService } from "./mockMemory.js";
import { isMock } from "./env.js";
import type { IMemoryService } from "./types.js";

export { MemoryService } from "./memory.js";
export { MockMemoryService } from "./mockMemory.js";
export { getPool, closePool } from "./db.js";
export { embed, EMBED_DIM } from "./embeddings.js";
export { isMock, loadEnv } from "./env.js";
export * from "./types.js";

/**
 * Return the right memory backend for the current environment: the in-memory
 * mock when BLACKBOX_MOCK is set, otherwise the CockroachDB-backed service.
 */
export function createMemoryService(): IMemoryService {
  return isMock() ? new MockMemoryService() : new MemoryService();
}
