import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Load the repo-root .env exactly once, for any consumer of the memory package
 * (CLI, seed scripts, and the Next.js server). Node's built-in loader (>=20.6)
 * does not override variables already present in the environment.
 *
 * Both src (ts-node) and dist live one level under packages/memory, so the
 * relative path to the repo root is the same in either case.
 */
let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    (process as any).loadEnvFile?.(resolve(here, "../../../.env"));
  } catch {
    /* .env is optional when vars are already set (e.g. CI, Lambda) */
  }
}

/** True when running against fakes instead of real CockroachDB + Bedrock. */
export function isMock(): boolean {
  loadEnv();
  const v = process.env.BLACKBOX_MOCK;
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Embeddings-only mock: real CockroachDB, deterministic fake embeddings.
 * Used by the local chaos rig and scale seeding before Bedrock is configured.
 * Full mock mode implies it.
 */
export function isMockEmbeddings(): boolean {
  loadEnv();
  const v = process.env.BLACKBOX_MOCK_EMBEDDINGS;
  return v === "1" || v === "true" || v === "yes" || isMock();
}

loadEnv();
