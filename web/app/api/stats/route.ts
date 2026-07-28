import { NextResponse } from "next/server";
import {
  clusterHealth,
  createMemoryService,
  embed,
  isMock,
  MockMemoryService,
  warmPool,
} from "@blackbox/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// This endpoint is hit on every home-page load and every chat turn, and each
// call runs a real vector search + cluster-health scan. Cache the response per
// warm instance for a few seconds so bursts don't re-run it (the recall is
// still genuinely timed on a cache miss).
let cache: { at: number; body: unknown } | null = null;
const CACHE_TTL = 8_000;

const PROBE = "latency spike and connection pool exhaustion";

/**
 * Live proof strip: memory-corpus size, a genuinely-timed semantic recall,
 * and region health. Numbers, not adjectives — which means the numbers have to
 * measure what their labels claim.
 *
 * `searchMs` is CockroachDB's distributed vector search alone. `embedMs` is the
 * Bedrock round trip that turns the question into a vector. `recallMs` is the
 * honest end-to-end sum. Reporting only the total made the database look slow
 * for work it never did — most of that number was Bedrock, and on a cold
 * serverless instance, connection setup. We warm the pool and the search path
 * before timing, so neither the TLS handshake nor cold-start query planning is
 * billed to "recall". These are steady-state numbers and the docs say so; the
 * cold-start figure is published alongside rather than quietly excluded.
 */
export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_TTL) {
    return NextResponse.json(cache.body);
  }
  try {
    const memory = createMemoryService();

    if (isMock()) {
      const t0 = Date.now();
      await memory.recallSimilarIncidents(PROBE, 5);
      const recallMs = Date.now() - t0;
      const total =
        memory instanceof MockMemoryService
          ? memory.regionDistribution().reduce((s, d) => s + d.rows, 0)
          : 0;
      const body = {
        totalMemories: total,
        recallMs,
        embedMs: 0,
        searchMs: recallMs,
        regionsLive: 3,
        regionsTotal: 3,
        mock: true,
      };
      cache = { at: Date.now(), body };
      return NextResponse.json(body);
    }

    // Pay connection setup BEFORE the stopwatch starts.
    await warmPool();

    const tEmbed = Date.now();
    await embed(PROBE);
    const embedMs = Date.now() - tEmbed;

    // Warm the search path too, then time the next one. On a cold serverless
    // instance the first vector query pays query planning and C-SPANN metadata
    // loading — around 5s against the managed cluster, versus ~0.9s steady
    // state. Timing that first call reports cold-start cost as if it were
    // search cost. What we publish is the steady-state figure, and the cold
    // number is documented rather than hidden (see DEVPOST.md).
    await memory.recallSimilarIncidents(PROBE, 5);

    // The embedding is cached per-instance by now, so this times the vector
    // search itself rather than repeating the Bedrock round trip.
    const tSearch = Date.now();
    await memory.recallSimilarIncidents(PROBE, 5);
    const searchMs = Date.now() - tSearch;

    const h = await clusterHealth();
    const body = {
      totalMemories: h.totalMemories,
      recallMs: embedMs + searchMs,
      embedMs,
      searchMs,
      regionsLive: h.regions.filter((r) => r.liveNodes > 0).length,
      regionsTotal: h.regions.length,
      survivalGoal: h.survivalGoal,
    };
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[/api/stats]", err);
    return NextResponse.json({
      totalMemories: 0,
      recallMs: null,
      embedMs: null,
      searchMs: null,
      regionsLive: 0,
      regionsTotal: 0,
    });
  }
}
