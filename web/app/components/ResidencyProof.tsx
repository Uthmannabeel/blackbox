"use client";

import { useEffect, useState } from "react";

interface Proof {
  region: string;
  gateway: string;
  incident: { id: string; title: string } | null;
  perRegion: { region: string; rows: number }[];
}

/** Live data-residency proof: a memory pinned to eu-west-1, queried from us-east. */
export function ResidencyProof() {
  const [p, setP] = useState<Proof | null>(null);

  useEffect(() => {
    fetch("/api/residency")
      .then((r) => r.json())
      .then(setP)
      .catch(() => {});
  }, []);

  const max = p ? Math.max(1, ...p.perRegion.map((r) => r.rows)) : 1;

  return (
    <div className="residency">
      <div className="res-proof">
        <div className="res-badge">residency · EU</div>
        <p>
          {p?.incident
            ? `Incident "${p.incident.title}" is pinned to `
            : "This memory is pinned to "}
          <code>{p?.region ?? "aws-eu-west-1"}</code>. The query below runs from the{" "}
          <code>{p?.gateway ?? "aws-us-east-1"}</code> gateway, yet the row is served from — and
          only ever stored in — its home region.
        </p>
        <pre className="codeblock" style={{ margin: "14px 0 0" }}>
{`SELECT crdb_region, title
  FROM incidents
 WHERE crdb_region = 'aws-eu-west-1'
 LIMIT 1;
-- crdb_region  | title
-- aws-eu-west-1 | ${p?.incident?.title?.slice(0, 40) ?? "…"}`}
        </pre>
      </div>
      <div className="res-dist">
        <div className="res-dist-h">memories per region</div>
        {(p?.perRegion ?? []).map((r) => (
          <div className="res-bar-row" key={r.region}>
            <span className="res-bar-label">{r.region.replace(/^aws-/, "")}</span>
            <span className="res-bar-track">
              <span className="res-bar-fill" style={{ width: `${(r.rows / max) * 100}%` }} />
            </span>
            <span className="res-bar-val">{r.rows.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
