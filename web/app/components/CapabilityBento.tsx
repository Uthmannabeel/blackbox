"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RegionMap } from "./RegionMap";
import { fetchRegions, fetchStats } from "@/lib/liveData";
import { DEMO_REGIONS, shortRegion } from "@/lib/demoData";

interface MapNode {
  region: string;
  rows: number | null;
  down: boolean;
  primary?: boolean;
}

interface Stats {
  total: number | null;
  recallMs: number | null;
}

/**
 * Evidence rows captured verbatim from a live recall against the production
 * cluster (2026-07-09) — same shape the console ledger renders. Kept static so
 * the home page costs no model call; the caption says exactly where it's from.
 */
const CAPTURED_EVIDENCE = [
  { kind: "incident", title: "checkout-api p99 latency spike to 20s from connection pool exhaustion", region: "us-east-1", dist: "0.67" },
  { kind: "incident", title: "checkout-api p99 latency spike to 18s from connection pool exhaustion", region: "eu-west-1", dist: "0.67" },
  { kind: "incident", title: "checkout-api p99 latency spike to 28s from connection pool exhaustion", region: "ap-south-1", dist: "0.68" },
  { kind: "runbook", title: "Runbook: Connection pool exhaustion", region: "eu-west-1", dist: "1.28" },
] as const;

const FALLBACK_REGIONS: MapNode[] = DEMO_REGIONS.map((r) => ({
  region: r.region,
  rows: null,
  down: false,
  primary: r.primary,
}));

/** Home capabilities as a bento — every live cell reads the production cluster. */
export function CapabilityBento() {
  const [nodes, setNodes] = useState<MapNode[]>(FALLBACK_REGIONS);
  const [stats, setStats] = useState<Stats>({ total: null, recallMs: null });

  useEffect(() => {
    let mounted = true;

    fetchRegions()
      .then((d) => {
        if (!mounted || !Array.isArray(d.distribution) || !d.distribution.length) return;
        const primary = new Set((d.regions ?? []).filter((r) => r.primary).map((r) => r.region));
        const downed = new Set(
          (d.liveness ?? []).filter((l) => l.liveNodes === 0).map((l) => l.region),
        );
        const mapped: MapNode[] = d.distribution.map((x) => ({
          region: x.region,
          rows: Number(x.rows) || 0,
          down: downed.has(x.region),
          primary: primary.has(x.region),
        }));
        // Primary region at the top of the triangle (index 1).
        const ordered = [...mapped].sort((a, b) => Number(a.primary ?? false) - Number(b.primary ?? false));
        setNodes(ordered.length === 3 ? [ordered[0], ordered[2], ordered[1]] : mapped);
      })
      .catch(() => {});

    fetchStats()
      .then((d) => {
        if (!mounted) return;
        setStats({
          total: typeof d.totalMemories === "number" ? d.totalMemories : null,
          recallMs: typeof d.recallMs === "number" ? d.recallMs : null,
        });
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  const maxRows = Math.max(1, ...nodes.map((n) => n.rows ?? 0));
  const bars = [...nodes].sort((a, b) => a.region.localeCompare(b.region));

  return (
    <div className="bento">
      <div className="card b-7 b-r2">
        <div className="k">Survive</div>
        <h3>Kill a region. The memory keeps answering.</h3>
        <RegionMap nodes={nodes} />
        <p>
          Every memory replicates across three AWS regions under{" "}
          <span className="mono">SURVIVE REGION FAILURE</span>. Lose one mid-incident and recall
          keeps serving from the survivors — including rows homed in the dead region. The counts
          above are live from the production cluster.
        </p>
        <div className="b-fact">
          <span>last validated drill</span>
          <span>primary region killed · top-5 recall identical · 136 ms</span>
        </div>
        <Link href="/survivability" className="b-link">
          Watch the failure drill →
        </Link>
      </div>

      <div className="card b-5">
        <div className="k">Recall</div>
        <h3>Institutional memory, in milliseconds</h3>
        <div className="b-stats">
          <div>
            <div className="v">{stats.recallMs !== null ? `${stats.recallMs} ms` : "—"}</div>
            <div className="l">semantic recall, measured live</div>
          </div>
          <div>
            <div className="v">{stats.total !== null ? stats.total.toLocaleString() : "—"}</div>
            <div className="l">memories on record</div>
          </div>
        </div>
        <p>
          The vector index is distributed like everything else — search runs next to the data in
          each region, so recall survives whatever the data survives.
        </p>
      </div>

      <div className="card b-5">
        <div className="k">Evidence</div>
        <h3>Every answer cites its memory</h3>
        <div className="ledger">
          <div className="ledger-h">recall captured 2026-07-09, production cluster · lower = closer</div>
          {CAPTURED_EVIDENCE.map((e, i) => (
            <div className="ledger-row" key={i}>
              <span className="ln">[{i + 1}]</span>
              <span className="lt">{e.title}</span>
              <span className="lm">
                {e.region} · {e.dist}
              </span>
            </div>
          ))}
        </div>
        <Link href="/console" className="b-link">
          Run your own recall in the console →
        </Link>
      </div>

      <div className="card b-4">
        <div className="k">Compliant</div>
        <h3>Pinned to its home region</h3>
        <div className="b-bars">
          {bars.map((n) => (
            <div className="res-bar-row" key={n.region}>
              <span className="res-bar-label">{shortRegion(n.region)}</span>
              <span className="res-bar-track">
                <span className="res-bar-fill" style={{ width: `${Math.round(((n.rows ?? 0) / maxRows) * 100)}%` }} />
              </span>
              <span className="res-bar-val">{n.rows ? n.rows.toLocaleString() : "—"}</span>
            </div>
          ))}
        </div>
        <p>
          <span className="mono">REGIONAL BY ROW</span> domiciles each memory where the incident
          happened. An EU incident&rsquo;s data physically stays in the EU — no second database.
        </p>
      </div>

      <div className="card b-4">
        <div className="k">Learn</div>
        <h3>Runbooks that compound</h3>
        <p>
          Resolving an incident distils what worked into a new runbook, written back to the same
          memory. The next similar incident recalls it first — the agent gets sharper with every
          failure it survives.
        </p>
        <Link href="/product" className="b-link">
          How the agent works →
        </Link>
      </div>

      <div className="card b-4">
        <div className="k">Introspect</div>
        <h3>Reads its own cluster</h3>
        <div className="b-code">inspect_cluster → select_query, via the Managed MCP Server</div>
        <p>
          Through CockroachDB&rsquo;s Managed MCP Server the agent queries the very database it
          runs on — mid-drill, it diagnosed its own region outage and reported memory still
          serving.
        </p>
        <Link href="/architecture" className="b-link">
          Why CockroachDB, in depth →
        </Link>
      </div>
    </div>
  );
}
