import { getPool } from "./db.js";

/**
 * Cluster self-observation: BlackBox's memory *is* a CockroachDB cluster, and
 * these read-only introspection queries let both the UI and the agent see the
 * health of the very system that stores their memories.
 *
 * Two deployment shapes are supported:
 *  - Local chaos rig (`cockroach demo`): full admin — per-node liveness from
 *    crdb_internal.gossip_nodes, so we can show a region genuinely go 0/3 when
 *    its nodes are killed.
 *  - CockroachDB Cloud (managed, multi-tenant): raw KV-node tables are not
 *    exposed to tenant SQL users, so we fall back to database-level region
 *    metadata and report each configured region as serving. `nodeDetail`
 *    tells callers which mode produced the result.
 */

export interface RegionHealth {
  region: string;
  liveNodes: number;
  totalNodes: number;
  nodeIds: { id: number; live: boolean }[];
}

export interface ClusterHealth {
  regions: RegionHealth[];
  gatewayRegion: string;
  survivalGoal: string;
  totalMemories: number;
  /** True when per-node liveness is available (local rig); false on managed Cloud. */
  nodeDetail: boolean;
}

/** Per-node liveness from gossip. Throws on managed Cloud (table restricted). */
async function nodeLevelLiveness(): Promise<RegionHealth[]> {
  const { rows } = await getPool().query(
    `SELECT node_id::int AS id,
            is_live,
            split_part(split_part(locality::string || ',', 'region=', 2), ',', 1) AS region
       FROM crdb_internal.gossip_nodes
      ORDER BY node_id`,
  );
  if (rows.length === 0) throw new Error("gossip_nodes empty");
  const byRegion = new Map<string, RegionHealth>();
  for (const r of rows) {
    const region = r.region || "unknown";
    let h = byRegion.get(region);
    if (!h) {
      h = { region, liveNodes: 0, totalNodes: 0, nodeIds: [] };
      byRegion.set(region, h);
    }
    h.totalNodes++;
    if (r.is_live) h.liveNodes++;
    h.nodeIds.push({ id: Number(r.id), live: Boolean(r.is_live) });
  }
  return [...byRegion.values()].sort((a, b) => a.region.localeCompare(b.region));
}

/** Database-level regions (works everywhere, incl. managed Cloud). */
async function databaseRegions(): Promise<RegionHealth[]> {
  const { rows } = await getPool().query(`SHOW REGIONS FROM DATABASE`);
  return rows
    .map((r: { region: string; zones?: string[] }) => {
      const n = Array.isArray(r.zones) && r.zones.length > 0 ? r.zones.length : 1;
      return { region: r.region, liveNodes: n, totalNodes: n, nodeIds: [] };
    })
    .sort((a, b) => a.region.localeCompare(b.region));
}

/**
 * Per-region health. Prefers real node liveness (local rig); falls back to
 * database region metadata on managed Cloud. The boolean tells the caller
 * which happened.
 */
export async function regionLiveness(): Promise<{
  regions: RegionHealth[];
  nodeDetail: boolean;
}> {
  try {
    return { regions: await nodeLevelLiveness(), nodeDetail: true };
  } catch {
    return { regions: await databaseRegions(), nodeDetail: false };
  }
}

/**
 * Full health snapshot — what the agent's diagnose_memory tool reports.
 * Each sub-query is independently fault-tolerant: a restricted or slow query
 * degrades that one field rather than zeroing the whole response.
 */
export async function clusterHealth(): Promise<ClusterHealth> {
  const pool = getPool();
  const [regionsRes, gateway, survival, memories] = await Promise.allSettled([
    regionLiveness(),
    pool.query(`SELECT gateway_region() AS region`),
    pool.query(
      `SELECT survival_goal FROM [SHOW DATABASES] WHERE database_name = current_database()`,
    ),
    pool.query(
      `SELECT (SELECT count(*) FROM incidents)
            + (SELECT count(*) FROM runbooks)
            + (SELECT count(*) FROM agent_memory) AS total`,
    ),
  ]);

  const regionsValue =
    regionsRes.status === "fulfilled"
      ? regionsRes.value
      : { regions: [] as RegionHealth[], nodeDetail: false };

  return {
    regions: regionsValue.regions,
    nodeDetail: regionsValue.nodeDetail,
    gatewayRegion:
      gateway.status === "fulfilled" ? (gateway.value.rows[0]?.region ?? "unknown") : "unknown",
    survivalGoal:
      survival.status === "fulfilled"
        ? (survival.value.rows[0]?.survival_goal ?? "unknown")
        : "unknown",
    totalMemories:
      memories.status === "fulfilled" ? Number(memories.value.rows[0]?.total ?? 0) : 0,
  };
}
