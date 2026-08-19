"use client";

import { useState } from "react";

interface Leg {
  region: string;
  gateway: string;
  ms: number;
  top: { title: string; distance: number } | null;
  error: string | null;
}
interface RaceResult {
  query: string;
  legs: Leg[];
  consistent: boolean;
}

const RACE_QUERY = "checkout-api p99 latency spike, connection pool exhausted";

export function LatencyRace() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RaceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/race", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: RACE_QUERY }),
      });
      const data = await res.json();
      if (!res.ok) setError(data?.error ?? "race failed");
      else setResult(data as RaceResult);
    } catch {
      setError("network error — try again");
    } finally {
      setBusy(false);
    }
  };

  const maxMs = result ? Math.max(...result.legs.map((l) => l.ms), 1) : 1;

  return (
    <div className="race-box">
      <div className="race-head">
        <div>
          <div className="k">Same query · three regional gateways · follower reads</div>
          <p className="mono muted race-q">&ldquo;{RACE_QUERY}&rdquo;</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={run} disabled={busy}>
          {busy ? "racing…" : result ? "Race again" : "Run the race"}
        </button>
      </div>
      {error ? <div className="poison-error mono">{error}</div> : null}
      {result ? (
        <>
          <ul className="race-legs">
            {result.legs.map((l, i) => (
              <li key={l.region}>
                <span className="mono race-region">
                  {i === 0 ? "🥇 " : ""}
                  {l.region.replace("aws-", "")}
                </span>
                <span className="race-track">
                  <span className="race-bar" style={{ width: `${Math.max(4, (l.ms / maxMs) * 100)}%` }} />
                </span>
                <span className="mono race-ms">{l.ms} ms</span>
                <span className="mono muted race-gw">
                  {l.error ? l.error : `entered via ${l.gateway.replace("aws-", "")}`}
                </span>
              </li>
            ))}
          </ul>
          <p className={result.consistent ? "v-clean mono" : "v-breach"}>
            {result.consistent
              ? `all regions returned the same top memory — "${result.legs.find((l) => l.top)?.top?.title.slice(0, 70)}" — geography decides speed, never the answer`
              : "regions disagreed — this should not happen; please report it"}
          </p>
        </>
      ) : null}
    </div>
  );
}
