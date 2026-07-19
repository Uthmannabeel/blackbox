import { NextResponse } from "next/server";
import { createMemoryService, getPool, isMock } from "@blackbox/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only feed of memory write-path decisions plus knowledge-base composition.
// Cached per warm instance: the console polls this alongside the memory stream.
let cache: { at: number; body: unknown } | null = null;
const CACHE_TTL = 8_000;

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_TTL) {
    return NextResponse.json(cache.body);
  }
  try {
    const memory = createMemoryService();
    const events = await memory.recentHygieneEvents(20);

    let composition: unknown = null;
    if (!isMock()) {
      const { rows } = await getPool().query(
        `SELECT source, status, COUNT(*)::INT AS n, ROUND(AVG(confidence)::NUMERIC, 2)::FLOAT AS avg_confidence
           FROM runbooks GROUP BY source, status ORDER BY source, status`,
      );
      composition = rows.map((r) => ({
        source: r.source,
        status: r.status,
        count: Number(r.n),
        avgConfidence: Number(r.avg_confidence),
      }));
    }

    const body = { events, composition };
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[/api/hygiene]", err);
    return NextResponse.json({ events: [], composition: null });
  }
}
