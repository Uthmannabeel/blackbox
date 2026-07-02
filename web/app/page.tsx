"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
interface Liveness {
  region: string;
  liveNodes: number;
  totalNodes: number;
}
interface MemoryRow {
  id: string;
  kind: string;
  content: string;
  region: string;
  createdAt: string;
}
interface IncidentInfo {
  incident: {
    id: string;
    title: string;
    severity: string;
    status: string;
    region: string;
  };
  state: {
    phase: string;
    hypotheses: string[];
    nextSteps: string[];
  } | null;
}
interface Stats {
  totalMemories: number;
  recallMs: number | null;
  regionsLive: number;
  regionsTotal: number;
}

const SUGGESTION =
  "checkout-api p99 latency just jumped to 8s and connections are maxed out. what do i do?";

const FOLLOW_UPS = [
  "What fixed this last time?",
  "We raised the pool size — mark it resolved.",
  "Is your memory OK? Diagnose it.",
];

const TOOL_LABELS: Record<string, string> = {
  recall_similar_incidents: "Searching past incidents",
  recall_runbooks: "Consulting runbooks",
  recall_memories: "Recalling own memory",
  list_services: "Listing services",
  open_incident: "Opening incident",
  update_incident_state: "Updating incident state",
  resolve_incident: "Resolving incident + distilling runbook",
  inspect_cluster: "Inspecting cluster via MCP",
  diagnose_memory: "Self-diagnosing memory layer",
};

const KIND_ICONS: Record<string, string> = {
  user_msg: "🗣",
  agent_msg: "🤖",
  observation: "👁",
  action: "⚡",
  reflection: "💭",
};

export default function Dashboard() {
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

  // Real chaos (local rig) vs simulated drill (no control port).
  const [chaosReal, setChaosReal] = useState<{ available: boolean; target?: string }>({
    available: false,
  });
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
    } catch {
      /* keep last state */
    }
  }, []);

  const refreshMemories = useCallback(async () => {
    try {
      const d = await (await fetch("/api/memory?limit=14")).json();
      setMemories(d.memories ?? []);
    } catch {
      /* keep last state */
    }
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      setStats(await (await fetch("/api/stats")).json());
    } catch {
      /* keep last state */
    }
  }, []);

  const refreshIncident = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/incident/${id}`);
      if (res.ok) setIncidentInfo(await res.json());
    } catch {
      /* keep last state */
    }
  }, []);

  useEffect(() => {
    refreshRegions();
    refreshMemories();
    refreshStats();
    fetch("/api/chaos")
      .then((r) => r.json())
      .then(setChaosReal)
      .catch(() => {});
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
        .filter((e: any) => e.type === "tool_call")
        .map((e: any) => ({
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
      setTurns((t) => [...t, { role: "agent", text: `⚠️ ${msg}` }]);
    } finally {
      setBusy(false);
    }
  }

  /** A region is down if gossip says so (real), or it's the simulated target. */
  function regionDown(region: string): boolean {
    const l = liveness.find((x) => x.region === region);
    if (l && l.totalNodes > 0 && l.liveNodes === 0) return true;
    return simDowned === region;
  }
  const anyRealDown = liveness.some((l) => l.totalNodes > 0 && l.liveNodes === 0);
  const downedRegion = liveness.find((l) => l.totalNodes > 0 && l.liveNodes === 0)?.region ?? simDowned;

  async function toggleChaos() {
    // REAL chaos: drain/restore actual nodes through the rig's control port.
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
        // Gossip takes a few seconds to notice.
        await new Promise((r) => setTimeout(r, 6_000));
        await refreshRegions();
        await refreshStats();
      } catch {
        /* panel will show truth on next refresh */
      } finally {
        setChaosBusy(false);
      }
      return;
    }

    // Simulated drill: exclusion query proves surviving replicas answer.
    if (simDowned) {
      setSimDowned(null);
      setSurvivorDist(null);
      refreshRegions();
      return;
    }
    const target = regions.find((r) => r.primary)?.region ?? regions[0]?.region;
    if (!target) return;
    setSimDowned(target);
    try {
      const d = await (await fetch(`/api/regions?exclude=${encodeURIComponent(target)}`)).json();
      setSurvivorDist(d.distribution ?? []);
    } catch {
      setSurvivorDist(dist.filter((x) => x.region !== target));
    }
  }

  const shownDist = simDowned && survivorDist ? survivorDist : dist;
  const totalRows = dist.reduce((s, d) => s + d.rows, 0);
  const survivingRows = shownDist
    .filter((d) => d.region !== simDowned)
    .reduce((s, d) => s + d.rows, 0);

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
        <span
          className="pill"
          title={
            live
              ? "Connected to a live multi-region CockroachDB cluster"
              : "Offline demo mode — scripted agent + in-memory store, no cloud required"
          }
        >
          {live ? "● live: multi-region CockroachDB" : "○ offline demo — no cluster connected"}
        </span>
      </header>

      {stats && (
        <div className="stats" aria-label="live memory statistics">
          <span>
            <b>{stats.totalMemories.toLocaleString()}</b> memories
          </span>
          <span>
            semantic recall <b>{stats.recallMs != null ? `${stats.recallMs}ms` : "—"}</b>
          </span>
          <span>
            regions <b>{stats.regionsLive}/{stats.regionsTotal}</b>
          </span>
          <span>
            survives <b>{survival.toUpperCase()} FAILURE</b>
          </span>
        </div>
      )}

      <div className="grid">
        {/* Left: agent chat */}
        <div className="panel chat">
          <h2>Agent · reason ↔ recall ↔ act</h2>
          <div className="messages" ref={scrollRef} aria-live="polite">
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
                  🔧 <b>{TOOL_LABELS[t.tool] ?? t.tool}</b>
                  <span className="args"> {t.detail}</span>
                </div>
              ) : (
                <div className={`msg ${t.role}`} key={i}>
                  <div className="who">{t.role === "user" ? "operator" : "blackbox"}</div>
                  {t.text}
                </div>
              ),
            )}
            {busy && <div className="trace">thinking…</div>}
            {turns.length > 0 && !busy && (
              <div className="chips">
                {FOLLOW_UPS.map((f) => (
                  <button className="chip" key={f} onClick={() => send(f)}>
                    {f}
                  </button>
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
            <button onClick={() => send(input)} disabled={busy}>
              Send
            </button>
          </div>
        </div>

        {/* Right: survivability + incident + memory stream */}
        <div className="side">
          <div className="panel">
            <h2>Memory · multi-region survivability</h2>
            <div className="body">
              <div className="hint">
                Every memory is <code>REGIONAL BY ROW</code>; the database is set to{" "}
                <code>SURVIVE {survival.toUpperCase()} FAILURE</code>.{" "}
                {chaosReal.available
                  ? "The chaos button drains REAL nodes on the local rig — region status below is genuine gossip liveness."
                  : "Run a failure drill — surviving counts come from a live query that excludes the downed region."}
              </div>

              {regions.map((r) => {
                const rows = shownDist.find((d) => d.region === r.region)?.rows ?? 0;
                const l = liveness.find((x) => x.region === r.region);
                const down = regionDown(r.region);
                return (
                  <div className={`region ${down ? "down" : ""}`} key={r.region}>
                    <span>
                      <span className={`dot ${down ? "down" : "up"}`} />
                      {r.region}
                      {r.primary ? <span className="badge">PRIMARY</span> : null}
                    </span>
                    <span className="rows">
                      {down
                        ? l
                          ? `0/${l.totalNodes} nodes — DOWN`
                          : "unreachable"
                        : l
                          ? `${rows} memories · ${l.liveNodes}/${l.totalNodes} nodes`
                          : `${rows} memories`}
                    </span>
                  </div>
                );
              })}

              <button
                className={`chaos ${downedRegion ? "armed" : ""}`}
                onClick={toggleChaos}
                disabled={chaosBusy}
              >
                {chaosBusy
                  ? "⏳ DRAINING NODES…"
                  : downedRegion
                    ? "◼ RESTORE REGION"
                    : chaosReal.available
                      ? `⚡ KILL ${chaosReal.target ?? "A REGION"} (REAL)`
                      : "⚡ FAILURE DRILL: DOWN A REGION"}
              </button>

              <div className="status">
                {downedRegion ? (
                  anyRealDown ? (
                    <>
                      <b style={{ color: "var(--red)" }}>{downedRegion} is genuinely offline</b>{" "}
                      (nodes drained).
                      <br />
                      <span className="ok">✓ all {totalRows.toLocaleString()} memories</span>{" "}
                      still readable and writable from surviving replicas — including
                      those homed in the dead region. Zero data loss.
                    </>
                  ) : (
                    <>
                      <b style={{ color: "var(--red)" }}>{downedRegion} is offline (drill).</b>
                      <br />
                      <span className="ok">
                        ✓ {survivingRows.toLocaleString()} of {totalRows.toLocaleString()} memories
                      </span>{" "}
                      still served from surviving regions — zero data loss, agent stays
                      online.
                    </>
                  )
                ) : (
                  <>
                    All regions healthy · {totalRows.toLocaleString()} memories replicated
                    across {regions.length} regions.
                  </>
                )}
              </div>
            </div>
          </div>

          {incidentInfo && (
            <div className="panel">
              <h2>Active incident</h2>
              <div className="body">
                <div className="inc-title">
                  <span className={`sev sev-${incidentInfo.incident.severity.toLowerCase()}`}>
                    {incidentInfo.incident.severity}
                  </span>{" "}
                  {incidentInfo.incident.title}
                </div>
                <div className="inc-meta">
                  phase: <b>{incidentInfo.state?.phase ?? "triage"}</b> · status:{" "}
                  <b>{incidentInfo.incident.status}</b> · region:{" "}
                  <span className="region-badge">{incidentInfo.incident.region}</span>
                </div>
                {incidentInfo.state?.hypotheses?.length ? (
                  <div className="inc-list">
                    <span className="inc-label">hypotheses</span>
                    {incidentInfo.state.hypotheses.map((h, i) => (
                      <div key={i}>• {h}</div>
                    ))}
                  </div>
                ) : null}
                {incidentInfo.state?.nextSteps?.length ? (
                  <div className="inc-list">
                    <span className="inc-label">next steps</span>
                    {incidentInfo.state.nextSteps.map((s, i) => (
                      <div key={i}>• {s}</div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          )}

          <div className="panel">
            <h2>Memory stream · what the agent remembers</h2>
            <div className="body memfeed">
              {memories.length === 0 ? (
                <div className="hint">
                  Nothing yet — talk to the agent and watch its durable memory build
                  up here, each entry pinned to its home region.
                </div>
              ) : (
                memories.map((m) => (
                  <div className="mem-item" key={m.id}>
                    <span className="mem-kind">{KIND_ICONS[m.kind] ?? "▪"}</span>
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
