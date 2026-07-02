import { NextResponse } from "next/server";
import {
  clusterHealth,
  createMemoryService,
  isMock,
  MockMemoryService,
} from "@blackbox/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live proof strip: memory-corpus size, a genuinely-timed semantic recall,
 * and region health. Numbers, not adjectives.
 */
export async function GET() {
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
      return NextResponse.json({
        totalMemories: total,
        recallMs,
        regionsLive: 3,
        regionsTotal: 3,
        mock: true,
      });
    }

    const h = await clusterHealth();
    return NextResponse.json({
      totalMemories: h.totalMemories,
      recallMs,
      regionsLive: h.regions.filter((r) => r.liveNodes > 0).length,
      regionsTotal: h.regions.length,
      survivalGoal: h.survivalGoal,
    });
  } catch (err) {
    console.error("[/api/stats]", err);
    return NextResponse.json({ totalMemories: 0, recallMs: null, regionsLive: 0, regionsTotal: 0 });
  }
}
