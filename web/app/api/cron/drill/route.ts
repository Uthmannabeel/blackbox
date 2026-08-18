import { NextRequest, NextResponse } from "next/server";
import { getPool, isMock } from "@blackbox/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Scheduled survivability drill — the survival ledger.
 *
 * The console's failure drill proves a region loss on demand; this proves it
 * unattended, every day, and keeps the receipts. Each run picks one region
 * (rotating daily), re-runs the memory distribution query with that region's
 * rows excluded — answered entirely by the surviving regions — and records the
 * outcome in `drill_log`. Both counts are read in ONE transaction, so
 * "memories lost" is computed against a consistent snapshot: 0 means 0, not
 * "0 modulo a write race".
 *
 * Auth: same contract as /api/cron/decay — Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET`; unset secret refuses to run.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (isMock()) {
    return NextResponse.json({ ok: false, skipped: "mock mode" });
  }

  const UNION = `SELECT crdb_region FROM incidents
       UNION ALL SELECT crdb_region FROM runbooks
       UNION ALL SELECT crdb_region FROM agent_memory
       UNION ALL SELECT crdb_region FROM agent_stream`;

  const client = await getPool().connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS drill_log (
         id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         at            TIMESTAMPTZ NOT NULL DEFAULT now(),
         excluded      STRING NOT NULL,
         surviving     INT NOT NULL,
         excluded_rows INT NOT NULL,
         total         INT NOT NULL,
         latency_ms    INT NOT NULL,
         ok            BOOL NOT NULL
       )`,
    );

    const started = Date.now();
    await client.query("BEGIN");
    const dist = await client.query(
      `SELECT m.crdb_region::string AS region, count(*)::int AS rows
         FROM (${UNION}) AS m GROUP BY 1 ORDER BY 1`,
    );
    const regions: { region: string; rows: number }[] = dist.rows.map(
      (r: { region: string; rows: number | string }) => ({ region: r.region, rows: Number(r.rows) }),
    );
    if (regions.length < 2) {
      await client.query("COMMIT");
      return NextResponse.json({ ok: false, skipped: "fewer than 2 regions" });
    }

    // Rotate the downed region daily so every region gets drilled.
    const dayIndex = Math.floor(Date.now() / 86_400_000) % regions.length;
    const excluded = regions[dayIndex].region;

    // The drill: the same aggregate, answered without the downed region's rows.
    const survRes = await client.query(
      `SELECT count(*)::int AS rows FROM (${UNION}) AS m
        WHERE m.crdb_region::string != $1`,
      [excluded],
    );
    await client.query("COMMIT");
    const latencyMs = Date.now() - started;

    const total = regions.reduce((s, r) => s + r.rows, 0);
    const surviving = Number(survRes.rows[0].rows);
    const excludedRows = regions[dayIndex].rows;
    const lost = total - surviving - excludedRows;
    const ok = lost === 0;

    await client.query(
      `INSERT INTO drill_log (excluded, surviving, excluded_rows, total, latency_ms, ok)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [excluded, surviving, excludedRows, total, latencyMs, ok],
    );

    return NextResponse.json({
      ok,
      excluded,
      surviving,
      excludedRows,
      total,
      lost,
      latencyMs,
      at: new Date().toISOString(),
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // already committed or connection gone — nothing to roll back
    }
    console.error("[/api/cron/drill]", err);
    return NextResponse.json({ error: "drill failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
