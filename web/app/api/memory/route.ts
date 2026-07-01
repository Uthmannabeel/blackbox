import { NextRequest, NextResponse } from "next/server";
import { createMemoryService } from "@blackbox/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The agent's memory stream, newest first — makes the product's namesake
 * visible in the UI. Shares the same memory backend as the agent (singleton),
 * so in mock mode the feed shows exactly what the mock agent stored.
 */
export async function GET(req: NextRequest) {
  try {
    const raw = Number(req.nextUrl.searchParams.get("limit") ?? 12);
    const limit = Math.max(1, Math.min(50, Number.isFinite(raw) ? raw : 12));
    const sessionId = req.nextUrl.searchParams.get("sessionId") ?? undefined;

    const memories = await createMemoryService().recentMemories(limit, sessionId);
    return NextResponse.json({ memories });
  } catch (err) {
    // Unconfigured/unreachable DB → empty feed, never a client-visible error.
    console.error("[/api/memory]", err);
    return NextResponse.json({ memories: [] });
  }
}
