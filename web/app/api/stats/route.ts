import { NextResponse } from "next/server";
import {
  clusterHealth,
  createMemoryService,
  isMock,
  MockMemoryService,
} from "@blackbox/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// This endpoint is hit on every home-page load and every chat turn, and each
// call runs a real vector search + cluster-health scan. Cache the response per
// warm instance for a few seconds so bursts don't re-run it (the recall is
// still genuinely timed on a cache miss).
let cache: { at: number; body: unknown } | null = null;
const CACHE_TTL = 8_000;

/**
 * Live proof strip: memory-corpus size, a genuinely-timed semantic recall,
 * and region health. Numbers, not adjectives.
 */
export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_TTL) {
    return NextResponse.json(cache.body);
  }
  try {
    const memory = createMemoryService();

    const t0 = Date.now();
    await memory.recallSimilarIncidents("latency spike and connection pool exhaustion", 5);
    const recallMs = Date.now() - t0;

    if (isMock()) {
      const total =
        memory instanceof MockMemoryService
          ? memory.regionDistribution().reduce((s, d) => s + d.rows, 0)
          : 0;
      const body = { totalMemories: total, recallMs, regionsLive: 3, regionsTotal: 3, mock: true };
      cache = { at: Date.now(), body };
      return NextResponse.json(body);
    }

    const h = await clusterHealth();
    const body = {
      totalMemories: h.totalMemories,
      recallMs,
      regionsLive: h.regions.filter((r) => r.liveNodes > 0).length,
      regionsTotal: h.regions.length,
      survivalGoal: h.survivalGoal,
    };
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[/api/stats]", err);
    return NextResponse.json({ totalMemories: 0, recallMs: null, regionsLive: 0, regionsTotal: 0 });
  }
}
