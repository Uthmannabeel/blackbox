import { NextResponse } from "next/server";
import { getPool, isMock } from "@blackbox/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The public survival ledger: how many automated region drills the memory has
 * survived, since when, and how many memories were lost across all of them
 * (the number this whole project exists to keep at zero). Read-only aggregate
 * over `drill_log`; see /api/cron/drill for how entries are produced.
 */
export async function GET() {
  if (isMock()) {
    return NextResponse.json({ drills: 0, since: null, lastAt: null, memoriesLost: 0 });
  }
  try {
    const { rows } = await getPool().query(
      `SELECT count(*) FILTER (WHERE ok)::int AS drills,
              min(at)                          AS since,
              max(at)                          AS last_at,
              coalesce(sum(total - surviving - excluded_rows), 0)::int AS lost
         FROM drill_log`,
    );
    const r = rows[0] ?? {};
    return NextResponse.json({
      drills: Number(r.drills ?? 0),
      since: r.since ?? null,
      lastAt: r.last_at ?? null,
      memoriesLost: Number(r.lost ?? 0),
    });
  } catch {
    // Table not created yet (no drill has run) — an empty ledger, not an error.
    return NextResponse.json({ drills: 0, since: null, lastAt: null, memoriesLost: 0 });
  }
}
