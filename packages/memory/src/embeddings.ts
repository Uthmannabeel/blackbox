import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { isMockEmbeddings } from "./env.js";

/**
 * Embeddings via Amazon Bedrock — Titan Text Embeddings v2 (1024 dimensions),
 * matching the VECTOR(1024) columns in db/schema.sql.
 *
 * One AWS service (Bedrock) powers both embeddings (here) and reasoning (the
 * agent package). Swap BEDROCK_EMBED_MODEL_ID to use Cohere embeddings instead.
 */
const EMBED_DIM = 1024;

let client: BedrockRuntimeClient | undefined;

function getClient(): BedrockRuntimeClient {
  if (!client) {
    client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? "us-east-1" });
  }
  return client;
}

function isThrottle(err: unknown): boolean {
  const e = err as { name?: string; message?: string };
  return (
    e?.name === "ThrottlingException" ||
    /too many requests|throttl|rate exceeded/i.test(e?.message ?? "")
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Small per-instance cache of recent embeddings, keyed by exact input text.
 * The agent embeds near-identical situation strings 2-3x per turn (one per
 * recall tool), and endpoints like /api/stats embed a constant probe string on
 * every request — all of which collapse to one Bedrock call here. Bounded FIFO
 * so it can't grow without limit on a long-lived instance.
 */
const EMBED_CACHE_MAX = 256;
const embedCache = new Map<string, number[]>();

export async function embed(text: string): Promise<number[]> {
  if (isMockEmbeddings()) return mockEmbed(text);

  const cached = embedCache.get(text);
  if (cached) return cached;

  const modelId = process.env.BEDROCK_EMBED_MODEL_ID ?? "amazon.titan-embed-text-v2:0";

  const body = JSON.stringify({
    inputText: text,
    dimensions: EMBED_DIM,
    normalize: true, // unit vectors -> cosine distance is well-behaved
  });

  // Fresh AWS accounts have low Titan quotas; back off through throttles
  // rather than failing (protects both bulk seeding and live agent turns).
  let lastErr: unknown;
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      const res = await getClient().send(
        new InvokeModelCommand({
          modelId,
          contentType: "application/json",
          accept: "application/json",
          body,
        }),
      );
      const payload = JSON.parse(new TextDecoder().decode(res.body)) as {
        embedding: number[];
      };
      if (!payload.embedding || payload.embedding.length !== EMBED_DIM) {
        throw new Error(
          `Bedrock returned ${payload.embedding?.length ?? 0} dims, expected ${EMBED_DIM}`,
        );
      }
      if (embedCache.size >= EMBED_CACHE_MAX) {
        const oldest = embedCache.keys().next().value;
        if (oldest !== undefined) embedCache.delete(oldest);
      }
      embedCache.set(text, payload.embedding);
      return payload.embedding;
    } catch (err) {
      if (!isThrottle(err)) throw err;
      lastErr = err;
      // 1s, 2s, 4s, ... + jitter (deterministic-ish; jitter from attempt)
      await sleep(1000 * 2 ** attempt + 137 * attempt);
    }
  }
  throw lastErr;
}

/**
 * Deterministic offline embedding for mock mode: a hashed bag-of-words into
 * EMBED_DIM buckets, unit-normalized. Shared words produce overlapping
 * dimensions, so cosine/L2 recall still surfaces genuinely similar text —
 * good enough to demo the UX without calling Bedrock.
 */
function mockEmbed(text: string): number[] {
  const v = new Array<number>(EMBED_DIM).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % EMBED_DIM;
    v[idx] = (v[idx] ?? 0) + 1;
    // A second bucket reduces collisions between unrelated tokens.
    const idx2 = Math.abs(Math.imul(h, 40503)) % EMBED_DIM;
    v[idx2] = (v[idx2] ?? 0) + 0.5;
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

export { EMBED_DIM };
