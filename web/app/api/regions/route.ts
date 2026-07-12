import { NextRequest, NextResponse } from "next/server";
import {
  createMemoryService,
  getPool,
  isMock,
  MockMemoryService,
  regionLiveness,
} from "@blackbox/memory";
import { DEMO_REGIONS } from "@/lib/demoData";
import { getRegionsCache, setRegionsCache } from "@/lib/regionsCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION_RE = /^[a-z0-9-]{1,64}$/;

/**
 * Region + replication status for the survivability panel.
 *
 * `?exclude=<region>` powers the failure drill: the distribution is re-queried
 * with that region excluded, so the "surviving memories" count is a REAL query
 * answered without the downed region's rows — not client-side arithmetic.
 */
export async function GET(req: NextRequest) {
  const excludeRaw = req.nextUrl.searchParams.get("exclude");
  const exclude = excludeRaw && REGION_RE.test(excludeRaw) ? excludeRaw : null;

  // Offline mock mode: real counts from the shared in-memory store.
  if (isMock()) {
    const memory = createMemoryService();
    const dist =
      memory instanceof MockMemoryService
        ? memory.regionDistribution()
        : DEMO_REGIONS.map((r) => ({ region: r.region, rows: 0 }));
    const distribution = exclude ? dist.filter((d) => d.region !== exclude) : dist;
    return NextResponse.json({
      live: false,
      mock: true,
      regions: DEMO_REGIONS,
      distribution,
      survivalGoal: "region",
    });
  }

  // Serve the cached live response for the common (no-exclude) case.
  if (!exclude) {
    const cached = getRegionsCache();
    if (cached) return NextResponse.json(cached);
  }

  try {
    const pool = getPool();

    // Resolve the connected database rather than assuming its name.
    const dbRes = await pool.query(`SELECT current_database() AS db`);
    const db: string = dbRes.rows[0].db;

    // Per-region memory counts. With ?exclude, the downed region's rows are
    // omitted from the query itself — surviving replicas answer it.
    const filter = exclude ? `WHERE m.crdb_region::string != $1` : "";

    // The region list, distribution, survival goal, and liveness are all
    // independent — run them concurrently instead of four serial RTTs.
    const [regions, distribution, survivability, livenessRes] = await Promise.all([
      pool.query(`SHOW REGIONS FROM DATABASE "${db.replace(/"/g, '""')}"`),
      pool.query(
        `SELECT m.crdb_region::string AS region, count(*)::int AS rows FROM (
           SELECT crdb_region FROM incidents
           UNION ALL SELECT crdb_region FROM runbooks
           UNION ALL SELECT crdb_region FROM agent_memory
         ) AS m ${filter} GROUP BY m.crdb_region ORDER BY region`,
        exclude ? [exclude] : [],
      ),
      pool.query(
        `SELECT survival_goal FROM [SHOW DATABASES] WHERE database_name = current_database()`,
      ),
      // True node liveness per region from gossip — the UI shows genuinely-down
      // regions, not client-side toggles. Best-effort (gossip view can lag).
      regionLiveness().then(
        ({ regions: rh }) =>
          rh.map((r) => ({ region: r.region, liveNodes: r.liveNodes, totalNodes: r.totalNodes })),
        () => [] as { region: string; liveNodes: number; totalNodes: number }[],
      ),
    ]);
    const liveness = livenessRes;

    const body = {
      live: true,
      regions: regions.rows,
      // count(*)::int comes back as a string via the int8 type parser (db.ts);
      // coerce here so every client gets numbers, not "1170".
      distribution: distribution.rows.map((r: { region: string; rows: number | string }) => ({
        region: r.region,
        rows: Number(r.rows),
      })),
      survivalGoal: survivability.rows[0]?.survival_goal ?? "unknown",
      liveness,
    };
    if (!exclude) setRegionsCache(body);
    return NextResponse.json(body);
  } catch (err) {
    // No live cluster yet — return the intended demo topology so the UI renders.
    // Log the detail server-side; never leak connection/error internals to the client.
    console.error("[/api/regions] falling back to demo topology:", err);
    return NextResponse.json({
      live: false,
      regions: DEMO_REGIONS,
      distribution: [
        { region: "aws-us-east-1", rows: 8 },
        { region: "aws-eu-west-1", rows: 5 },
        { region: "aws-ap-south-1", rows: 3 },
      ].filter((d) => d.region !== exclude),
      survivalGoal: "region",
    });
  }
}
