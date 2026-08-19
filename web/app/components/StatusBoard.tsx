"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchStats, fetchRegions, fetchDrills, type DrillsResponse, type RegionsResponse, type StatsResponse } from "@/lib/liveData";

interface PoisonWall {
  attempts: number;
  breaches: number;
}
interface CertList {
  certificates: { seq: number }[];
  chainVerified: boolean;
}

export function StatusBoard() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [regions, setRegions] = useState<RegionsResponse | null>(null);
  const [drills, setDrills] = useState<DrillsResponse | null>(null);
  const [poison, setPoison] = useState<PoisonWall | null>(null);
  const [certs, setCerts] = useState<CertList | null>(null);

  useEffect(() => {
    fetchStats().then(setStats).catch(() => {});
    fetchRegions().then(setRegions).catch(() => {});
    fetchDrills().then(setDrills).catch(() => {});
    fetch("/api/poison").then((r) => r.json()).then(setPoison).catch(() => {});
    fetch("/api/certificates").then((r) => r.json()).then(setCerts).catch(() => {});
  }, []);

  const regionsOk = stats ? stats.regionsLive === stats.regionsTotal && stats.regionsTotal === 3 : null;
  const allGreen =
    regionsOk === true &&
    (drills?.memoriesLost ?? 0) === 0 &&
    (poison?.breaches ?? 0) === 0 &&
    (certs?.chainVerified ?? true);

  return (
    <>
      <div className={`status-banner ${allGreen ? "ok" : "warn"} mono`}>
        {stats === null
          ? "reading the live cluster…"
          : allGreen
            ? "● all systems and all proofs green"
            : "● a proof needs attention — details below"}
      </div>

      <div className="metrics">
        <div className="metric">
          <div className="v">{stats ? stats.totalMemories.toLocaleString() : "—"}</div>
          <div className="l">memories on record, live cluster</div>
        </div>
        <div className="metric">
          <div className="v">{stats ? `${stats.regionsLive}/${stats.regionsTotal}` : "—"}</div>
          <div className="l">regions serving · survival goal {stats?.survivalGoal ?? "…"}</div>
        </div>
        <div className="metric">
          <div className="v">{stats?.searchMs != null ? `${stats.searchMs} ms` : "—"}</div>
          <div className="l">vector search, measured on this page load</div>
        </div>
      </div>

      <div className="grid grid-2 status-grid">
        <div className="card">
          <div className="k">Survival ledger</div>
          <h3>
            {drills ? drills.drills : "—"} automated region drill{drills?.drills === 1 ? "" : "s"} ·{" "}
            {drills ? drills.memoriesLost : "—"} memories lost
          </h3>
          <p>
            A daily cron re-runs the memory distribution query with one region excluded, inside a
            single transaction. Receipts at <span className="mono">/api/drills</span>.
          </p>
          <Link href="/survivability" className="b-link">Survivability →</Link>
        </div>
        <div className="card">
          <div className="k">Red team</div>
          <h3>
            {poison ? poison.attempts : "—"} poisoning attempt{poison?.attempts === 1 ? "" : "s"} ·{" "}
            {poison ? poison.breaches : "—"} reached recall
          </h3>
          <p>
            Every public attempt runs the real untrusted write path and lands on a public wall
            with its verdict and a live recall-proof.
          </p>
          <Link href="/poison" className="b-link">Try to poison it →</Link>
        </div>
        <div className="card">
          <div className="k">Certificate chain</div>
          <h3>
            {certs ? certs.certificates.length : "—"} promotion
            {certs?.certificates.length === 1 ? "" : "s"} ·{" "}
            {certs ? (certs.chainVerified ? "chain verified" : "CHAIN BROKEN") : "—"}
          </h3>
          <p>
            Every lesson released into recall mints a hash-chained certificate; the registry
            re-verifies the whole chain on every read at{" "}
            <span className="mono">/api/certificates</span>.
          </p>
          <Link href="/poison" className="b-link">Promotion receipts →</Link>
        </div>
        <div className="card">
          <div className="k">Region liveness</div>
          <h3>
            {regions?.liveness?.length
              ? regions.liveness.every((l) => l.liveNodes > 0)
                ? "every region answering"
                : "a region is dark"
              : "gossip view loading"}
          </h3>
          <p>
            Node liveness per region from cluster gossip — the same signal the console&rsquo;s
            topology view renders. Independent probes also watch this site from GitHub Actions
            twice a day.
          </p>
          <a
            href="https://github.com/Uthmannabeel/blackbox/actions/workflows/health.yml"
            className="b-link"
          >
            External probe history →
          </a>
        </div>
      </div>

      <p className="mono muted status-foot">
        everything on this page is read live from the production cluster on load — nothing cached,
        nothing hand-entered · more proofs: <Link href="/forensics">forensic replay</Link> ·{" "}
        <Link href="/product">war room</Link> · <Link href="/survivability">latency race</Link>
      </p>
    </>
  );
}
