import { getPool } from "./db.js";

/**
 * Executable implementation of the CockroachDB Agent Skills Repo skill
 * `reviewing-cluster-health` v2.0 (cockroachlabs/cockroachdb-skills,
 * Apache-2.0), Standard-tier procedure — the tier BlackBox's memory cluster
 * runs on. Vendored skill text: skills/cockroachdb/reviewing-cluster-health/.
 *
 * The agent's diagnose_memory tool runs these checks against its own memory
 * layer and cites the skill in its diagnosis.
 */

export const HEALTH_SKILL_CITATION =
  "cockroachlabs/cockroachdb-skills · reviewing-cluster-health v2.0 (Standard tier)";

export interface SkillCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SkillHealthReport {
  citation: string;
  checks: SkillCheck[];
  allOk: boolean;
}

/** Run the skill's Standard-tier SQL checks. Read-only; each check isolated. */
export async function standardTierHealthCheck(): Promise<SkillHealthReport> {
  const pool = getPool();
  const checks: SkillCheck[] = [];

  // Check 1: connectivity (skill: `SELECT 1`)
  try {
    await pool.query("SELECT 1");
    checks.push({ name: "connectivity", ok: true, detail: "SELECT 1 round-trip OK" });
  } catch (err) {
    checks.push({ name: "connectivity", ok: false, detail: msg(err) });
  }

  // Check 2: version (skill: `SELECT version()`)
  try {
    const { rows } = await pool.query("SELECT version()");
    const v = String(rows[0]?.version ?? "unknown");
    const short = v.match(/CockroachDB CCL (v[\d.]+)/)?.[1] ?? v.slice(0, 40);
    checks.push({ name: "version", ok: true, detail: short });
  } catch (err) {
    checks.push({ name: "version", ok: false, detail: msg(err) });
  }

  // Check 3: recent failed jobs (skill: SHOW JOBS, failed, last 24h)
  try {
    const { rows } = await pool.query(
      `WITH j AS (SHOW JOBS)
       SELECT job_type, COUNT(*)::INT AS n FROM j
        WHERE status = 'failed' AND created > now() - INTERVAL '24 hours'
        GROUP BY job_type`,
    );
    const total = rows.reduce((s, r) => s + Number(r.n), 0);
    checks.push({
      name: "failed jobs (24h)",
      ok: total === 0,
      detail:
        total === 0
          ? "no failed jobs in the last 24 hours"
          : rows.map((r) => `${r.job_type}: ${r.n}`).join(", "),
    });
  } catch (err) {
    // SHOW JOBS can be restricted on some multi-tenant plans; report honestly.
    checks.push({ name: "failed jobs (24h)", ok: false, detail: `unavailable: ${msg(err)}` });
  }

  return {
    citation: HEALTH_SKILL_CITATION,
    checks,
    allOk: checks.every((c) => c.ok),
  };
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
