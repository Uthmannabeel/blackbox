import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { embed, hitRateLimit, isMock } from "@blackbox/memory";
import { clientKey, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The per-region latency race.
 *
 * One query is embedded once, then raced against all three regional gateways
 * of the SAME cluster simultaneously. Each leg is a follower read
 * (`AS OF SYSTEM TIME follower_read_timestamp()`), so every region answers
 * from its local replicas instead of shipping the read to a distant
 * leaseholder — geography decides the podium, and all three answers are
 * identical. `gateway_region()` is returned per leg as proof the query really
 * entered through that region.
 */

const RACE_REGIONS = ["aws-us-east-1", "aws-eu-west-1", "aws-ap-south-1"] as const;
const MAX_QUERY_CHARS = 200;

const PER_MIN = 6;
const PER_DAY = 60;
const GLOBAL_PER_DAY = 600;

// One small pool per regional endpoint, cached across invocations on a warm
// serverless instance so repeat races measure the query, not the TLS setup.
const regionalPools = new Map<string, Pool>();

function regionalPool(region: string): Pool {
  const cached = regionalPools.get(region);
  if (cached) return cached;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set");
  // Global SQL DNS -> region-scoped SQL DNS for the same cluster.
  const scoped = base.replace(
    ".j77.cockroachlabs.cloud",
    `.j77.${region}.cockroachlabs.cloud`,
  );
  const pool = new Pool({ connectionString: scoped, max: 1, connectionTimeoutMillis: 15_000 });
  regionalPools.set(region, pool);
  return pool;
}

export async function POST(req: NextRequest) {
  if (isMock()) {
    return NextResponse.json({ error: "race unavailable in mock mode" }, { status: 503 });
  }

  const key = clientKey(req.headers);
  try {
    const [m, d, g] = await Promise.all([
      hitRateLimit(`race:min:${key}`, PER_MIN, 60),
      hitRateLimit(`race:day:${key}`, PER_DAY, 86_400),
      hitRateLimit(`race:global:day`, GLOBAL_PER_DAY, 86_400),
    ]);
    if (!m.ok || !d.ok || !g.ok) {
      return NextResponse.json({ error: "rate limited — try again shortly" }, { status: 429 });
    }
  } catch {
    if (!rateLimit(`race:${key}`).ok) {
      return NextResponse.json({ error: "rate limited" }, { status: 429 });
    }
  }

  let query: string;
  try {
    const body = await req.json();
    query = String(body?.query ?? "").trim();
  } catch {
    return NextResponse.json({ error: "body must be JSON: { query }" }, { status: 400 });
  }
  if (!query || query.length < 3 || query.length > MAX_QUERY_CHARS) {
    return NextResponse.json(
      { error: `query must be 3–${MAX_QUERY_CHARS} characters` },
      { status: 400 },
    );
  }

  try {
    const vec = `[${(await embed(query)).join(",")}]`;

    const legs = await Promise.all(
      RACE_REGIONS.map(async (region) => {
        const started = Date.now();
        try {
          const { rows } = await regionalPool(region).query(
            `SELECT gateway_region()::string AS gw, title,
                    embedding <-> $1 AS distance
               FROM incidents AS OF SYSTEM TIME follower_read_timestamp()
              WHERE status = 'resolved' AND resolution IS NOT NULL
              ORDER BY embedding <-> $1
              LIMIT 1`,
            [vec],
          );
          return {
            region,
            gateway: String(rows[0]?.gw ?? "unknown"),
            ms: Date.now() - started,
            top: rows[0]
              ? { title: String(rows[0].title), distance: Number(Number(rows[0].distance).toFixed(3)) }
              : null,
            error: null as string | null,
          };
        } catch (err) {
          return {
            region,
            gateway: "unreachable",
            ms: Date.now() - started,
            top: null,
            error: err instanceof Error ? err.message.slice(0, 80) : "failed",
          };
        }
      }),
    );

    const answered = legs.filter((l) => l.top);
    const consistent =
      answered.length > 1 && answered.every((l) => l.top!.title === answered[0].top!.title);

    return NextResponse.json({
      query,
      legs: [...legs].sort((a, b) => a.ms - b.ms),
      consistent,
    });
  } catch (err) {
    console.error("[/api/race]", err);
    return NextResponse.json({ error: "race failed" }, { status: 500 });
  }
}
