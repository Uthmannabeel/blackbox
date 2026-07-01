import { NextRequest, NextResponse } from "next/server";
import { createMemoryService, getPool, isMock, MockMemoryService } from "@blackbox/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION_RE = /^[a-z0-9-]{1,64}$/;

const DEMO_REGIONS = [
  { region: "aws-us-east-1", primary: true },
  { region: "aws-eu-west-1", primary: false },
  { region: "aws-ap-south-1", primary: false },
];

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

  try {
    const pool = getPool();

    // Resolve the connected database rather than assuming its name.
    const dbRes = await pool.query(`SELECT current_database() AS db`);
    const db: string = dbRes.rows[0].db;
    const regions = await pool.query(
      `SHOW REGIONS FROM DATABASE "${db.replace(/"/g, '""')}"`,
    );

    // Per-region memory counts. With ?exclude, the downed region's rows are
    // omitted from the query itself — surviving replicas answer it.
    const filter = exclude ? `WHERE m.crdb_region::string != $1` : "";
    const distribution = await pool.query(
      `SELECT m.crdb_region::string AS region, count(*)::int AS rows FROM (
         SELECT crdb_region FROM incidents
         UNION ALL SELECT crdb_region FROM runbooks
         UNION ALL SELECT crdb_region FROM agent_memory
       ) AS m ${filter} GROUP BY m.crdb_region ORDER BY region`,
      exclude ? [exclude] : [],
    );

    const survivability = await pool.query(
      `SELECT survival_goal FROM [SHOW DATABASES] WHERE database_name = current_database()`,
    );

    return NextResponse.json({
      live: true,
      regions: regions.rows,
      distribution: distribution.rows,
      survivalGoal: survivability.rows[0]?.survival_goal ?? "unknown",
    });
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
