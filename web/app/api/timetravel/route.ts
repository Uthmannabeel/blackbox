import { NextRequest, NextResponse } from "next/server";
import { snapshotAsOf, isMock, createMemoryService, MockMemoryService } from "@blackbox/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Memory as of a moment in the past, via CockroachDB AS OF SYSTEM TIME.
 * `?seconds=N` rewinds N seconds. Bounded by the cluster GC window.
 */
export async function GET(req: NextRequest) {
  const raw = Number(req.nextUrl.searchParams.get("seconds") ?? 0);
  const seconds = Math.max(0, Math.min(86_400, Number.isFinite(raw) ? raw : 0));

  // Offline mock: approximate by dropping memories created within the window.
  if (isMock()) {
    const mem = createMemoryService();
    const rows = mem instanceof MockMemoryService ? await mem.recentMemories(50) : [];
    const cutoff = Date.now() - seconds * 1000;
    const past = rows.filter((m) => new Date(m.createdAt).getTime() <= cutoff);
    return NextResponse.json({
      seconds,
      total: past.length,
      sample: past.slice(0, 6).map((m) => ({ id: m.id, kind: m.kind, content: m.content, region: m.region, createdAt: m.createdAt })),
      mock: true,
    });
  }

  try {
    const snap = await snapshotAsOf(seconds);
    return NextResponse.json({ seconds, total: snap.total, sample: snap.sample, asOf: snap.asOf });
  } catch (err) {
    // Outside the GC window, or unreachable — report gracefully.
    console.error("[/api/timetravel]", err);
    return NextResponse.json(
      { seconds, total: null, sample: [], error: "snapshot unavailable (outside GC window?)" },
      { status: 200 },
    );
  }
}
