import { NextResponse } from "next/server";
import { getPool } from "@blackbox/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Region + replication status for the "chaos" panel. Queries CockroachDB for
 * the database's configured regions and how memory rows are distributed across
 * them — proving the memory is genuinely multi-region replicated, not mocked.
 */
export async function GET() {
  try {
    const pool = getPool();

    const regions = await pool.query(
      `SHOW REGIONS FROM DATABASE blackbox`,
    );

    // Row counts per region across the memory tables (survivability evidence).
    const distribution = await pool.query(`
      SELECT crdb_region::string AS region, count(*)::int AS rows FROM (
        SELECT crdb_region FROM incidents
        UNION ALL SELECT crdb_region FROM runbooks
        UNION ALL SELECT crdb_region FROM agent_memory
      ) GROUP BY crdb_region ORDER BY region
    `);

    const survivability = await pool.query(
      `SELECT survival_goal FROM [SHOW DATABASES] WHERE database_name = 'blackbox'`,
    );

    return NextResponse.json({
      live: true,
      regions: regions.rows,
      distribution: distribution.rows,
      survivalGoal: survivability.rows[0]?.survival_goal ?? "unknown",
    });
  } catch (err) {
    // No live cluster yet — return the intended demo topology so the UI renders.
    return NextResponse.json({
      live: false,
      note: (err as Error).message,
      regions: [
        { region: "aws-us-east-1", primary: true },
        { region: "aws-eu-west-1", primary: false },
        { region: "aws-ap-south-1", primary: false },
      ],
      distribution: [
        { region: "aws-us-east-1", rows: 8 },
        { region: "aws-eu-west-1", rows: 5 },
        { region: "aws-ap-south-1", rows: 3 },
      ],
      survivalGoal: "region",
    });
  }
}
