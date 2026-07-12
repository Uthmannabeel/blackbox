"use client";

import { useEffect, useState } from "react";
import { fetchStats } from "@/lib/liveData";

/** Live figures for the hero — real counts pulled from the running cluster. */
export function LiveStat() {
  const [stat, setStat] = useState<{ total: number | null; recallMs: number | null; regions: number }>(
    { total: null, recallMs: null, regions: 3 },
  );

  useEffect(() => {
    let mounted = true;
    fetchStats()
      .then((d) => {
        if (!mounted) return;
        setStat({
          total: typeof d.totalMemories === "number" ? d.totalMemories : null,
          recallMs: typeof d.recallMs === "number" ? d.recallMs : null,
          regions: d.regionsTotal || 3,
        });
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="hero-meta">
      <span>
        <b>{stat.total !== null ? stat.total.toLocaleString() : "—"}</b> incidents in memory
      </span>
      <span>
        <b>{stat.regions}</b> regions
      </span>
      <span>
        semantic recall{" "}
        <b>{stat.recallMs !== null ? `${stat.recallMs} ms` : "sub-second"}</b>
      </span>
    </div>
  );
}
