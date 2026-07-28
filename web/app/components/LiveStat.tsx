"use client";

import { useEffect, useState } from "react";
import { fetchStats } from "@/lib/liveData";

/** Live figures for the hero — real counts pulled from the running cluster. */
export function LiveStat() {
  const [stat, setStat] = useState<{ total: number | null; searchMs: number | null; regions: number }>(
    { total: null, searchMs: null, regions: 3 },
  );

  useEffect(() => {
    let mounted = true;
    fetchStats()
      .then((d) => {
        if (!mounted) return;
        setStat({
          total: typeof d.totalMemories === "number" ? d.totalMemories : null,
          searchMs:
            typeof d.searchMs === "number"
              ? d.searchMs
              : typeof d.recallMs === "number"
                ? d.recallMs
                : null,
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
      {/* "memories" not "incidents": the total spans incidents, runbooks,
          semantic memory and the conversational stream. */}
      <span>
        <b>{stat.total !== null ? stat.total.toLocaleString() : "—"}</b> memories on record
      </span>
      <span>
        <b>{stat.regions}</b> regions
      </span>
      {/* No adjective fallback — if we could not measure it, we say so. */}
      <span>
        vector search <b>{stat.searchMs !== null ? `${stat.searchMs} ms` : "—"}</b>
      </span>
    </div>
  );
}
