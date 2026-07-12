"use client";

import { useEffect, useState } from "react";
import { fetchRegions } from "@/lib/liveData";
import { DEMO_REGIONS } from "@/lib/demoData";

interface Region {
  region: string;
  rows: number;
  live: boolean;
}

/**
 * The signature element: a flight-recorder instrument strip showing each
 * region's live memory count. The recording pulse (amber) is the only warm
 * color in the whole design — the black box, still recording.
 */
export function RecorderStrip() {
  const [regions, setRegions] = useState<Region[]>(
    DEMO_REGIONS.map((r) => ({ region: r.region, rows: 0, live: true })),
  );
  const [survival, setSurvival] = useState("REGION");
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetchRegions()
      .then((d) => {
        if (!mounted) return;
        if (Array.isArray(d.distribution) && d.distribution.length) {
          setRegions(
            d.distribution.map((x) => ({ region: x.region, rows: Number(x.rows) || 0, live: true })),
          );
        }
        if (d.survivalGoal) setSurvival(String(d.survivalGoal).toUpperCase());
        setConnected(Boolean(d.live));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const total = regions.reduce((s, r) => s + r.rows, 0);

  return (
    <div className="recorder" aria-label="Flight recorder: per-region memory status">
      <div className="recorder-head">
        <span>memory · regional by row</span>
        <span className="rec-dot">
          <i /> recording
        </span>
      </div>
      <div className="recorder-body">
        {regions.map((r) => (
          <div className={`rec-region${r.live ? "" : " down"}`} key={r.region}>
            <div className="r-name">
              <span className="s" />
              {r.region}
            </div>
            <div className="r-count">{r.rows.toLocaleString()}</div>
            <div className="r-stat">memories pinned</div>
          </div>
        ))}
      </div>
      <div className="recorder-foot">
        <span>survive {survival.toLowerCase()} failure</span>
        <span>
          {connected ? "live" : "demo"} · {total.toLocaleString()} total
        </span>
      </div>
    </div>
  );
}
