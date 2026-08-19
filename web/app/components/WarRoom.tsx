"use client";

import { useState } from "react";

interface WarEvent {
  atMs: number;
  agent: "responder" | "scribe";
  step: string;
  attempt: number;
  outcome: "committed" | "retrying" | "failed";
}
interface WarResult {
  incidentId: string;
  events: WarEvent[];
  finalState: {
    phase: string;
    hypotheses: string[];
    actionsTaken: string[];
    nextSteps: string[];
  };
  totals: { expected: number; actual: number; retries: number; lostUpdates: number };
}

export function WarRoom() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WarResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/warroom", { method: "POST" });
      const data = await res.json();
      if (!res.ok) setError(data?.error ?? "drill failed");
      else setResult(data as WarResult);
    } catch {
      setError("network error — try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="race-box">
      <div className="race-head">
        <div className="k">
          Two agents · one incident-state row · deliberately colliding writes
        </div>
        <button className="btn btn-primary btn-sm" onClick={run} disabled={busy}>
          {busy ? "agents writing…" : result ? "Run it again" : "Run the drill"}
        </button>
      </div>
      {error ? <div className="poison-error mono">{error}</div> : null}
      {result ? (
        <>
          <div className="fx-summary mono">
            <b>{result.totals.actual}</b>/{result.totals.expected} writes landed ·{" "}
            <b>{result.totals.retries}</b> serialization retr{result.totals.retries === 1 ? "y" : "ies"}{" "}
            (error 40001, replayed) · <b>{result.totals.lostUpdates}</b> lost updates
          </div>
          <ul className="wr-log">
            {result.events.map((e, i) => (
              <li key={i} className={e.agent}>
                <span className="mono muted wr-t">{String(e.atMs).padStart(4, " ")} ms</span>
                <span className={`verdict verdict-sm ${e.agent === "responder" ? "v-merged" : "v-quarantined"}`}>
                  {e.agent.toUpperCase()}
                </span>
                <span className="w-text">
                  {e.step}
                  {e.outcome === "retrying" ? (
                    <b className="fx-delta"> — write conflict, retrying (attempt {e.attempt})</b>
                  ) : (
                    <span className="mono muted"> — committed{e.attempt > 1 ? ` on attempt ${e.attempt}` : ""}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <div className="v-proof">
            <div className="k">Final state — both agents&rsquo; work, nothing lost</div>
            <ul>
              {[...result.finalState.hypotheses.map((h) => ["hypothesis", h]),
                ...result.finalState.actionsTaken.map((a) => ["action", a]),
                ...result.finalState.nextSteps.map((n) => ["next step", n])].map(([k, v], i) => (
                <li key={i} className="mono">
                  <span className="muted">{k}</span>
                  <span>{v}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
