"use client";

import { useEffect, useRef, useState } from "react";

type Turn =
  | { role: "user"; text: string }
  | { role: "agent"; text: string }
  | { role: "trace"; tool: string; detail: string };

interface RegionInfo {
  region: string;
  primary?: boolean;
}
interface Dist {
  region: string;
  rows: number;
}

const SUGGESTION =
  "checkout-api p99 latency just jumped to 8s and connections are maxed out. what do i do?";

export default function Dashboard() {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [incidentId, setIncidentId] = useState<string | null>(null);

  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const [dist, setDist] = useState<Dist[]>([]);
  const [live, setLive] = useState(false);
  const [survival, setSurvival] = useState("region");
  const [downedRegion, setDownedRegion] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/regions")
      .then((r) => r.json())
      .then((d) => {
        setRegions(d.regions ?? []);
        setDist(d.distribution ?? []);
        setLive(Boolean(d.live));
        setSurvival(d.survivalGoal ?? "region");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setTurns((t) => [...t, { role: "user", text }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "error");

      const traceTurns: Turn[] = (data.events ?? [])
        .filter((e: any) => e.type === "tool_call")
        .map((e: any) => ({
          role: "trace" as const,
          tool: e.tool,
          detail: JSON.stringify(e.input),
        }));
      setTurns((t) => [...t, ...traceTurns, { role: "agent", text: data.reply }]);
      setIncidentId(data.incidentId ?? null);
    } catch (err) {
      setTurns((t) => [...t, { role: "agent", text: `⚠️ ${(err as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  const survivingRows = dist
    .filter((d) => d.region !== downedRegion)
    .reduce((s, d) => s + d.rows, 0);
  const totalRows = dist.reduce((s, d) => s + d.rows, 0);

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <span className="logo">🛩️</span>
          <div>
            <h1>BlackBox</h1>
            <div className="tag">incident copilot · memory that survives the crash</div>
          </div>
        </div>
        <span className="pill">{live ? "● cluster live" : "○ demo topology"}</span>
      </header>

      <div className="grid">
        {/* Left: agent chat */}
        <div className="panel chat">
          <h2>Agent · reason ↔ recall ↔ act</h2>
          <div className="messages" ref={scrollRef}>
            {turns.length === 0 && (
              <div className="hint">
                Describe an incident. The agent recalls similar past incidents and
                runbooks from CockroachDB, reasons, and records everything to durable
                memory.
                <br />
                <br />
                Try:{" "}
                <a
                  href="#"
                  style={{ color: "var(--amber)" }}
                  onClick={(e) => {
                    e.preventDefault();
                    send(SUGGESTION);
                  }}
                >
                  “{SUGGESTION}”
                </a>
              </div>
            )}
            {turns.map((t, i) =>
              t.role === "trace" ? (
                <div className="trace" key={i}>
                  🔧 <b>{t.tool}</b> {t.detail}
                </div>
              ) : (
                <div className={`msg ${t.role}`} key={i}>
                  <div className="who">{t.role === "user" ? "operator" : "blackbox"}</div>
                  {t.text}
                </div>
              ),
            )}
            {busy && <div className="trace">thinking…</div>}
          </div>
          <div className="composer">
            <input
              value={input}
              placeholder="Describe what's happening…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send(input)}
              disabled={busy}
            />
            <button onClick={() => send(input)} disabled={busy}>
              Send
            </button>
          </div>
        </div>

        {/* Right: memory survivability */}
        <div className="panel">
          <h2>Memory · multi-region survivability</h2>
          <div className="body">
            <div className="hint">
              Every memory is <code>REGIONAL BY ROW</code> and the database is set to{" "}
              <code>SURVIVE {survival.toUpperCase()} FAILURE</code>. Take a region
              offline — the agent keeps recalling from surviving replicas.
            </div>

            {regions.map((r) => {
              const rows = dist.find((d) => d.region === r.region)?.rows ?? 0;
              const down = downedRegion === r.region;
              return (
                <div className={`region ${down ? "down" : ""}`} key={r.region}>
                  <span>
                    <span className={`dot ${down ? "down" : "up"}`} />
                    {r.region}
                    {r.primary ? <span className="badge">PRIMARY</span> : null}
                  </span>
                  <span className="rows">{down ? "unreachable" : `${rows} memories`}</span>
                </div>
              );
            })}

            <button
              className={`chaos ${downedRegion ? "armed" : ""}`}
              onClick={() =>
                setDownedRegion((cur) =>
                  cur ? null : regions.find((r) => r.primary)?.region ?? regions[0]?.region ?? null,
                )
              }
            >
              {downedRegion ? "◼ RESTORE REGION" : "⚡ SIMULATE REGION OUTAGE"}
            </button>

            <div className="status">
              {downedRegion ? (
                <>
                  <b style={{ color: "var(--red)" }}>{downedRegion} is offline.</b>
                  <br />
                  <span className="ok">✓ {survivingRows} of {totalRows} memories</span> still
                  served from surviving regions — zero data loss, agent stays online.
                </>
              ) : (
                <>All regions healthy · {totalRows} memories replicated across {regions.length} regions.</>
              )}
            </div>
          </div>

          {incidentId && (
            <>
              <h2 style={{ borderTop: "1px solid var(--border)" }}>Active incident</h2>
              <div className="body">
                <div className="tag" style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                  {incidentId}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
