import { getPool } from "./db.js";

/**
 * Cluster self-observation: BlackBox's memory *is* a CockroachDB cluster, and
 * these read-only introspection queries let both the UI and the agent see the
 * health of the very system that stores their memories.
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
}

/** Per-region node liveness, parsed from gossip. */
export async function regionLiveness(): Promise<RegionHealth[]> {
  const { rows } = await getPool().query(
    `SELECT node_id::int AS id,
            is_live,
            split_part(split_part(locality::string || ',', 'region=', 2), ',', 1) AS region
       FROM crdb_internal.gossip_nodes
      ORDER BY node_id`,
  );
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

/** Full health snapshot — what the agent's diagnose_memory tool reports. */
export async function clusterHealth(): Promise<ClusterHealth> {
  const pool = getPool();
  const [regions, gateway, survival, memories] = await Promise.all([
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
  return {
    regions,
    gatewayRegion: gateway.rows[0]?.region ?? "unknown",
    survivalGoal: survival.rows[0]?.survival_goal ?? "unknown",
    totalMemories: Number(memories.rows[0]?.total ?? 0),
  };
}
