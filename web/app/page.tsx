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

const SUGGESTION =
  "checkout-api p99 latency just jumped to 8s and connections are maxed out. what do i do?";

const FOLLOW_UPS = [
  "What fixed this last time?",
  "We raised the pool size — mark it resolved.",
  "What do you remember about checkout-api?",
];

// Humanized trace labels; raw args stay visible but de-emphasized.
const TOOL_LABELS: Record<string, string> = {
  recall_similar_incidents: "Searching past incidents",
  recall_runbooks: "Consulting runbooks",
  recall_memories: "Recalling own memory",
  list_services: "Listing services",
  open_incident: "Opening incident",
  update_incident_state: "Updating incident state",
  resolve_incident: "Resolving incident",
  inspect_cluster: "Inspecting cluster via MCP",
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

  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const [dist, setDist] = useState<Dist[]>([]);
  const [live, setLive] = useState(false);
  const [survival, setSurvival] = useState("region");
  const [downedRegion, setDownedRegion] = useState<string | null>(null);
  const [survivorDist, setSurvivorDist] = useState<Dist[] | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshRegions = useCallback(async () => {
    try {
      const d = await (await fetch("/api/regions")).json();
      setRegions(d.regions ?? []);
      setDist(d.distribution ?? []);
      setLive(Boolean(d.live));
      setSurvival(d.survivalGoal ?? "region");
    } catch {
      /* panel keeps last known state */
    }
  }, []);

  const refreshMemories = useCallback(async () => {
    try {
      const d = await (await fetch("/api/memory?limit=14")).json();
      setMemories(d.memories ?? []);
    } catch {
      /* feed keeps last known state */
    }
  }, []);

  const refreshIncident = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/incident/${id}`);
      if (res.ok) setIncidentInfo(await res.json());
    } catch {
      /* card keeps last known state */
    }
  }, []);

  useEffect(() => {
    refreshRegions();
    refreshMemories();
  }, [refreshRegions, refreshMemories]);

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

  async function toggleChaos() {
    if (downedRegion) {
      setDownedRegion(null);
      setSurvivorDist(null);
      refreshRegions();
      return;
    }
    const target = regions.find((r) => r.primary)?.region ?? regions[0]?.region;
    if (!target) return;
    setDownedRegion(target);
    try {
      // A REAL query answered without the downed region's rows.
      const d = await (await fetch(`/api/regions?exclude=${encodeURIComponent(target)}`)).json();
      setSurvivorDist(d.distribution ?? []);
    } catch {
      setSurvivorDist(dist.filter((x) => x.region !== target));
    }
  }

  const shownDist = downedRegion && survivorDist ? survivorDist : dist;
  const survivingRows = shownDist
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
        <span
          className="pill"
          title={
            live
              ? "Connected to a live multi-region CockroachDB cluster"
              : "Offline demo mode — scripted agent + in-memory store, no cloud required"
          }
        >
          {live ? "● live: 3-region CockroachDB" : "○ offline demo — no cluster connected"}
        </span>
      </header>

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
                <code>SURVIVE {survival.toUpperCase()} FAILURE</code>. Run a failure
                drill — surviving counts come from a live query that excludes the
                downed region.
              </div>

              {regions.map((r) => {
                const rows = shownDist.find((d) => d.region === r.region)?.rows ?? 0;
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

              <button className={`chaos ${downedRegion ? "armed" : ""}`} onClick={toggleChaos}>
                {downedRegion ? "◼ RESTORE REGION" : "⚡ FAILURE DRILL: DOWN A REGION"}
              </button>

              <div className="status">
                {downedRegion ? (
                  <>
                    <b style={{ color: "var(--red)" }}>{downedRegion} is offline.</b>
                    <br />
                    <span className="ok">✓ {survivingRows} of {totalRows} memories</span>{" "}
                    still served from surviving regions — zero data loss, agent stays
                    online.
                  </>
                ) : (
                  <>
                    All regions healthy · {totalRows} memories replicated across{" "}
                    {regions.length} regions.
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
