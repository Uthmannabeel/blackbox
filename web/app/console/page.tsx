"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeToggle } from "../components/ThemeToggle";

type Turn =
  | { role: "user"; text: string }
  | { role: "agent"; text: string }
  | { role: "trace"; tool: string; detail: string };

interface RegionInfo { region: string; primary?: boolean }
interface Dist { region: string; rows: number }
interface Liveness { region: string; liveNodes: number; totalNodes: number }
interface MemoryRow { id: string; kind: string; content: string; region: string }
interface IncidentInfo {
  incident: { id: string; title: string; severity: string; status: string; region: string };
  state: { phase: string; hypotheses: string[]; nextSteps: string[] } | null;
}
interface Stats { totalMemories: number; recallMs: number | null; regionsLive: number; regionsTotal: number }

const SUGGESTION =
  "checkout-api p99 latency just jumped to 8s and connections are maxed out. what do i do?";

const FOLLOW_UPS = [
  "What fixed this last time?",
  "We raised the pool size — mark it resolved.",
  "How many incidents are in your memory? Query it.",
];

const TOOL_LABELS: Record<string, string> = {
  recall_similar_incidents: "searching past incidents",
  recall_runbooks: "consulting runbooks",
  recall_memories: "recalling own memory",
  list_services: "listing services",
  open_incident: "opening incident",
  update_incident_state: "updating incident state",
  resolve_incident: "resolving incident, distilling runbook",
  inspect_cluster: "inspecting cluster via MCP",
  diagnose_memory: "self-diagnosing memory layer",
};

const KIND_LABELS: Record<string, string> = {
  user_msg: "operator",
  agent_msg: "agent",
  observation: "observation",
  action: "action",
  reflection: "reflection",
};

export default function Console() {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [incidentInfo, setIncidentInfo] = useState<IncidentInfo | null>(null);
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const [dist, setDist] = useState<Dist[]>([]);
  const [liveness, setLiveness] = useState<Liveness[]>([]);
  const [live, setLive] = useState(false);
  const [survival, setSurvival] = useState("region");

  const [chaosReal, setChaosReal] = useState<{ available: boolean; target?: string }>({ available: false });
  const [chaosBusy, setChaosBusy] = useState(false);
  const [simDowned, setSimDowned] = useState<string | null>(null);
  const [survivorDist, setSurvivorDist] = useState<Dist[] | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshRegions = useCallback(async () => {
    try {
      const d = await (await fetch("/api/regions")).json();
      setRegions(d.regions ?? []);
      setDist(d.distribution ?? []);
      setLiveness(d.liveness ?? []);
      setLive(Boolean(d.live));
      setSurvival(d.survivalGoal ?? "region");
    } catch { /* keep last */ }
  }, []);
  const refreshMemories = useCallback(async () => {
    try { setMemories((await (await fetch("/api/memory?limit=14")).json()).memories ?? []); } catch { /* keep */ }
  }, []);
  const refreshStats = useCallback(async () => {
    try { setStats(await (await fetch("/api/stats")).json()); } catch { /* keep */ }
  }, []);
  const refreshIncident = useCallback(async (id: string) => {
    try { const r = await fetch(`/api/incident/${id}`); if (r.ok) setIncidentInfo(await r.json()); } catch { /* keep */ }
  }, []);

  useEffect(() => {
    refreshRegions();
    refreshMemories();
    refreshStats();
    fetch("/api/chaos").then((r) => r.json()).then(setChaosReal).catch(() => {});
  }, [refreshRegions, refreshMemories, refreshStats]);

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
        signal: AbortSignal.timeout(90_000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "request failed");
      const traceTurns: Turn[] = (data.events ?? [])
        .filter((e: { type: string }) => e.type === "tool_call")
        .map((e: { tool: string; input: unknown }) => ({
          role: "trace" as const,
          tool: e.tool,
          detail: JSON.stringify(e.input ?? {}),
        }));
      setTurns((t) => [...t, ...traceTurns, { role: "agent", text: data.reply }]);
      if (data.incidentId) refreshIncident(data.incidentId);
      refreshMemories();
      refreshRegions();
      refreshStats();
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "TimeoutError"
          ? "The agent took too long to respond (90s). Please try again."
          : (err as Error).message;
      setTurns((t) => [...t, { role: "agent", text: msg }]);
    } finally {
      setBusy(false);
    }
  }

  function regionDown(region: string): boolean {
    const l = liveness.find((x) => x.region === region);
    if (l && l.totalNodes > 0 && l.liveNodes === 0) return true;
    return simDowned === region;
  }
  const anyRealDown = liveness.some((l) => l.totalNodes > 0 && l.liveNodes === 0);
  const downedRegion = liveness.find((l) => l.totalNodes > 0 && l.liveNodes === 0)?.region ?? simDowned;

  async function toggleChaos() {
    if (chaosReal.available) {
      setChaosBusy(true);
      try {
        const action = anyRealDown ? "restore" : "kill";
        await fetch("/api/chaos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
          signal: AbortSignal.timeout(120_000),
        });
        await new Promise((r) => setTimeout(r, 6_000));
        await refreshRegions();
        await refreshStats();
      } catch { /* panel shows truth next refresh */ } finally { setChaosBusy(false); }
      return;
    }
    if (simDowned) { setSimDowned(null); setSurvivorDist(null); refreshRegions(); return; }
    const target = regions.find((r) => r.primary)?.region ?? regions[0]?.region;
    if (!target) return;
    setSimDowned(target);
    try {
      const d = await (await fetch(`/api/regions?exclude=${encodeURIComponent(target)}`)).json();
      setSurvivorDist(d.distribution ?? []);
    } catch { setSurvivorDist(dist.filter((x) => x.region !== target)); }
  }

  const shownDist = simDowned && survivorDist ? survivorDist : dist;
  const totalRows = dist.reduce((s, d) => s + d.rows, 0);
  const survivingRows = shownDist.filter((d) => d.region !== simDowned).reduce((s, d) => s + d.rows, 0);

  return (
    <div className="wrap console">
      <div className="console-head">
        <div className="title">
          <Link href="/" className="mark" style={{ fontWeight: 600, fontSize: 18 }}>
            Black<b style={{ color: "var(--accent-ink)" }}>Box</b>
          </Link>
          <span className="sub">incident console</span>
        </div>
        <div className="cright">
          <span className={`pill${live ? "" : " offline"}`} title={live ? "Connected to a multi-region CockroachDB Cloud cluster" : "Offline demo mode"}>
            <span className="s" />
            {live ? "live · multi-region CockroachDB" : "offline demo"}
          </span>
          <ThemeToggle />
        </div>
      </div>

      {stats && (
        <div className="statbar">
          <span><b>{stats.totalMemories.toLocaleString()}</b> memories</span>
          <span>semantic recall <b>{stats.recallMs != null ? `${stats.recallMs} ms` : "—"}</b></span>
          <span>regions <b>{stats.regionsLive}/{stats.regionsTotal}</b></span>
          <span>survives <b>{survival} failure</b></span>
        </div>
      )}

      <div className="cgrid">
        {/* chat */}
        <div className="panel chat">
          <h2>Agent — reason, recall, act</h2>
          <div className="messages" ref={scrollRef} aria-live="polite">
            {turns.length === 0 && (
              <div className="hint">
                Describe an incident. The agent recalls similar past incidents and runbooks from
                CockroachDB, reasons over them, and records everything to durable memory.
                <br />
                <br />
                Try:{" "}
                <a href="#" onClick={(e) => { e.preventDefault(); send(SUGGESTION); }}>
                  {SUGGESTION}
                </a>
              </div>
            )}
            {turns.map((t, i) =>
              t.role === "trace" ? (
                <div className="trace" key={i}>
                  <b>{TOOL_LABELS[t.tool] ?? t.tool}</b> <span className="args">{t.detail}</span>
                </div>
              ) : (
                <div className={`msg ${t.role}`} key={i}>
                  <div className="who">{t.role === "user" ? "operator" : "blackbox"}</div>
                  <div className="body-text">{t.text}</div>
                </div>
              ),
            )}
            {busy && <div className="trace">working…</div>}
            {turns.length > 0 && !busy && (
              <div className="chips">
                {FOLLOW_UPS.map((f) => (
                  <button className="chip-btn" key={f} onClick={() => send(f)}>{f}</button>
                ))}
              </div>
            )}
          </div>
          <div className="composer">
            <input
              value={input}
              placeholder="Describe what's happening…"
              aria-label="Describe the incident"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send(input)}
              disabled={busy}
            />
            <button className="btn btn-primary" onClick={() => send(input)} disabled={busy}>Send</button>
          </div>
        </div>

        {/* side */}
        <div className="side">
          <div className="panel">
            <h2>Memory — multi-region survivability</h2>
            <div className="body">
              <div className="hint" style={{ marginBottom: 14 }}>
                Every memory is <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>REGIONAL BY ROW</code>;
                the database is set to survive {survival} failure.{" "}
                {chaosReal.available
                  ? "The control below drains real nodes; region status is live gossip liveness."
                  : "Run a failure drill — surviving counts come from a live query that excludes the downed region."}
              </div>
              {regions.map((r) => {
                const rows = shownDist.find((d) => d.region === r.region)?.rows ?? 0;
                const l = liveness.find((x) => x.region === r.region);
                const down = regionDown(r.region);
                return (
                  <div className={`rregion${down ? " down" : ""}`} key={r.region}>
                    <span><span className="s" />{r.region}{r.primary ? <span className="badge" style={{ marginLeft: 8 }}>PRIMARY</span> : null}</span>
                    <span className="rows">
                      {down ? (l ? `0/${l.totalNodes} nodes — down` : "unreachable")
                        : l ? `${rows} memories · ${l.liveNodes}/${l.totalNodes}` : `${rows} memories`}
                    </span>
                  </div>
                );
              })}
              <button className={`chaos${downedRegion ? " armed" : ""}`} onClick={toggleChaos} disabled={chaosBusy}>
                {chaosBusy ? "draining nodes…"
                  : downedRegion ? "restore region"
                    : chaosReal.available ? `kill ${chaosReal.target ?? "a region"} (real)`
                      : "failure drill: down a region"}
              </button>
              <div className="status">
                {downedRegion ? (
                  anyRealDown ? (
                    <>
                      <span style={{ color: "var(--down)", fontWeight: 500 }}>{downedRegion} is offline</span> (nodes drained).{" "}
                      <span className="ok">All {totalRows.toLocaleString()} memories</span> remain readable and writable from surviving replicas — including rows homed in the dead region.
                    </>
                  ) : (
                    <>
                      <span style={{ color: "var(--down)", fontWeight: 500 }}>{downedRegion} offline (drill).</span>{" "}
                      <span className="ok">{survivingRows.toLocaleString()} of {totalRows.toLocaleString()} memories</span> still served from surviving regions.
                    </>
                  )
                ) : (
                  <>All regions healthy · {totalRows.toLocaleString()} memories across {regions.length} regions.</>
                )}
              </div>
            </div>
          </div>

          {incidentInfo && (
            <div className="panel">
              <h2>Active incident</h2>
              <div className="body">
                <div className="inc-title">
                  <span className={`sev sev-${incidentInfo.incident.severity.toLowerCase()}`}>{incidentInfo.incident.severity}</span>{" "}
                  {incidentInfo.incident.title}
                </div>
                <div className="inc-meta">
                  phase <b>{incidentInfo.state?.phase ?? "triage"}</b> · status <b>{incidentInfo.incident.status}</b> · <span className="region-badge">{incidentInfo.incident.region}</span>
                </div>
                {incidentInfo.state?.hypotheses?.length ? (
                  <div className="inc-list"><span className="l">hypotheses</span>{incidentInfo.state.hypotheses.map((h, i) => (<div key={i}>— {h}</div>))}</div>
                ) : null}
                {incidentInfo.state?.nextSteps?.length ? (
                  <div className="inc-list"><span className="l">next steps</span>{incidentInfo.state.nextSteps.map((s, i) => (<div key={i}>— {s}</div>))}</div>
                ) : null}
              </div>
            </div>
          )}

          <div className="panel">
            <h2>Memory stream — what the agent remembers</h2>
            <div className="body memfeed">
              {memories.length === 0 ? (
                <div className="hint">Nothing yet. Talk to the agent and watch its durable memory build up here, each entry pinned to its home region.</div>
              ) : (
                memories.map((m) => (
                  <div className="mem-item" key={m.id}>
                    <span className="mem-kind">{KIND_LABELS[m.kind] ?? m.kind}</span>
                    <span className="mem-content">{m.content}</span>
                    <span className="region-badge">{m.region.replace("aws-", "")}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
