import { NextRequest, NextResponse } from "next/server";
import { createMemoryService, isMock } from "@blackbox/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Scheduled memory maintenance.
 *
 * Decay is the half of hygiene that cannot be demonstrated on demand: learned
 * knowledge nobody recalls loses confidence, and what never earns trust is
 * archived out of recall. Wiring it to a manual npm script meant it had never
 * run in production — a forgetting mechanism that never forgets is a claim,
 * not a feature. Vercel Cron calls this daily (see vercel.json).
 *
 * Auth: Vercel sends `Authorization: Bearer $CRON_SECRET` on scheduled
 * invocations. Without a configured secret the route refuses to run rather
 * than exposing a state-changing endpoint publicly.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await createMemoryService().decayRunbooks();
    return NextResponse.json({ ok: true, mock: isMock(), ...result, at: new Date().toISOString() });
  } catch (err) {
    console.error("[/api/cron/decay]", err);
    return NextResponse.json({ error: "decay pass failed" }, { status: 500 });
  }
}
