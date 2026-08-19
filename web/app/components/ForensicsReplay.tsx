"use client";

import { useState } from "react";

interface EpisodeHit {
  id: string;
  title: string;
  region: string;
  distance: number;
  occurrences: number;
  signature: string;
}
interface RunbookHit {
  id: string;
  title: string;
  origin: string;
  confidence: number;
  distance: number;
}
interface Frame {
  at: string;
  totalMemories: number;
  episodes: EpisodeHit[];
  runbooks: RunbookHit[];
}
interface Replay {
  query: string;
  minutesAgo: number;
  then: Frame;
  now: Frame;
  diff: {
    memoriesAdded: number;
    newEpisodes: string[];
    vanishedEpisodes: string[];
    recurrenceChanges: { signature: string; then: number; now: number }[];
    newRunbooks: string[];
    vanishedRunbooks: string[];
    confidenceChanges: { id: string; then: number; now: number }[];
  };
}

const DEFAULT_QUERY = "checkout-api p99 latency spike, connection pool exhausted";

function agoLabel(mins: number): string {
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m ago` : `${h}h ago`;
}

export function ForensicsReplay() {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [minutes, setMinutes] = useState(120);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replay, setReplay] = useState<Replay | null>(null);

  const run = async () => {
    if (busy || query.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/forensics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), minutesAgo: minutes }),
      });
      const data = await res.json();
      if (!res.ok) setError(data?.error ?? "replay failed");
      else setReplay(data as Replay);
    } catch {
      setError("network error — try again");
    } finally {
      setBusy(false);
    }
  };

  const rec = (sig: string) =>
    replay?.diff.recurrenceChanges.find((c) => c.signature === sig) ?? null;
  const conf = (id: string) =>
    replay?.diff.confidenceChanges.find((c) => c.id === id) ?? null;

  return (
    <>
      <div className="fx-controls">
        <div className="k">The recall to replay</div>
        <input
          className="fx-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={300}
          placeholder="Describe an incident, the way an operator would"
        />
        <div className="fx-slider-row">
          <input
            type="range"
            min={5}
            max={1380}
            step={5}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="fx-slider"
            aria-label="How far back to rewind"
          />
          <span className="mono fx-ago">{agoLabel(minutes)}</span>
          <button className="btn btn-primary btn-sm" onClick={run} disabled={busy}>
            {busy ? "replaying…" : "Replay this recall"}
          </button>
        </div>
        <p className="mono muted fx-note">
          one embedding, two consistent reads — the historical one runs inside AS OF SYSTEM TIME
        </p>
        {error ? <div className="poison-error mono">{error}</div> : null}
      </div>

      {replay ? (
        <>
          <div className="fx-summary mono">
            between then and now: <b>+{replay.diff.memoriesAdded.toLocaleString()}</b> memories
            written · <b>{replay.diff.newEpisodes.length}</b> new episode
            {replay.diff.newEpisodes.length === 1 ? "" : "s"} near this query ·{" "}
            <b>{replay.diff.recurrenceChanges.length}</b> recurrence change
            {replay.diff.recurrenceChanges.length === 1 ? "" : "s"} ·{" "}
            <b>{replay.diff.newRunbooks.length}</b> runbook
            {replay.diff.newRunbooks.length === 1 ? "" : "s"} learned since
          </div>

          <div className="fx-grid">
            {([
              ["What the agent knew then", replay.then, true],
              ["What the agent knows now", replay.now, false],
            ] as const).map(([label, frame, isThen]) => (
              <div className="fx-col" key={label}>
                <div className="fx-col-head">
                  <div className="k">{label}</div>
                  <div className="mono muted">
                    {frame.at.slice(0, 19).replace("T", " ")} · {frame.totalMemories.toLocaleString()} memories
                  </div>
                </div>
                <div className="fx-sec">episodes — “have we seen this before?”</div>
                {frame.episodes.length ? (
                  <ul>
                    {frame.episodes.map((e) => {
                      const r = rec(e.signature);
                      const isNew = !isThen && replay.diff.newEpisodes.includes(e.signature);
                      const gone = isThen && replay.diff.vanishedEpisodes.includes(e.signature);
                      return (
                        <li key={e.id}>
                          <span className="fx-title">{e.title}</span>
                          <span className="mono muted fx-meta">
                            {e.region} · dist {e.distance} ·{" "}
                            {r && !isThen ? (
                              <b className="fx-delta">×{r.then}→×{r.now}</b>
                            ) : (
                              <>×{e.occurrences}</>
                            )}
                            {isNew ? <b className="fx-new"> NEW</b> : null}
                            {gone ? <b className="fx-gone"> not in today’s top-5</b> : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mono muted">no resolved episodes near this query</p>
                )}
                <div className="fx-sec">runbooks — “what fixed it?”</div>
                {frame.runbooks.length ? (
                  <ul>
                    {frame.runbooks.map((rb) => {
                      const c = conf(rb.id);
                      const isNew = !isThen && replay.diff.newRunbooks.includes(rb.id);
                      return (
                        <li key={rb.id}>
                          <span className="fx-title">{rb.title}</span>
                          <span className="mono muted fx-meta">
                            {rb.origin} · dist {rb.distance} ·{" "}
                            {c && !isThen ? (
                              <b className="fx-delta">
                                conf {c.then.toFixed(2)}→{c.now.toFixed(2)}
                              </b>
                            ) : (
                              <>conf {rb.confidence.toFixed(2)}</>
                            )}
                            {isNew ? <b className="fx-new"> LEARNED SINCE</b> : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mono muted">no active runbooks near this query</p>
                )}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
