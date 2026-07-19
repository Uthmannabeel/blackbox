"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeToggle } from "../components/ThemeToggle";
import { RegionMap } from "../components/RegionMap";

interface Evidence {
  kind: string; id: string; title: string; region: string; distance: number;
  sourceCompany?: string; sourceUrl?: string;
}

type Turn =
  | { role: "user"; text: string }
  | { role: "agent"; text: string; evidence?: Evidence[] }
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
interface HygieneEvent { id: string; action: string; detail: string; createdAt: string }

// After a real node drain, wait for the cluster to settle before re-reading
// topology (gossip liveness lags the actual shutdown by a few seconds).
const CHAOS_SETTLE_MS = 6_000;
// Time-travel slider bound; the "10 min ago" label must match this.
const TT_MAX_SECONDS = 600;
const TT_DEBOUNCE_MS = 200;

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

/** Render agent output as clean prose — strip markdown artifacts and emoji. */
function clean(text: string): string {
  return text
    .replace(/```/g, "")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*---+\s*$/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function agoLabel(sec: number): string {
  if (sec === 0) return "now";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m${s ? ` ${s}s` : ""} ago` : `${s}s ago`;
}

const KIND_LABELS: Record<string, string> = {
  user_msg: "operator",
  agent_msg: "agent",
  observation: "observation",
  action: "action",
  reflection: "reflection",
};

/** Write-path decisions, labeled for operators. */
const HYGIENE_LABELS: Record<string, string> = {
  accepted: "accepted",
  rejected: "rejected",
  merged: "consolidated",
  contradiction: "contradiction",
  reinforced: "reinforced",
  archived: "archived",
  decayed: "decayed",
};

export default function Console() {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [incidentInfo, setIncidentInfo] = useState<IncidentInfo | null>(null);
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [hygiene, setHygiene] = useState<HygieneEvent[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [timeSeconds, setTimeSeconds] = useState(0);
  const [snapshot, setSnapshot] = useState<{ total: number | null; sample: MemoryRow[] }>({ total: null, sample: [] });

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
  const ttAbortRef = useRef<AbortController | null>(null);
  const ttDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    try { setHygiene((await (await fetch("/api/hygiene")).json()).events ?? []); } catch { /* keep */ }
  }, []);
  const refreshStats = useCallback(async () => {
    try { setStats(await (await fetch("/api/stats")).json()); } catch { /* keep */ }
  }, []);
  const refreshIncident = useCallback(async (id: string) => {
    try { const r = await fetch(`/api/incident/${id}`); if (r.ok) setIncidentInfo(await r.json()); } catch { /* keep */ }
  }, []);
  const refreshSnapshot = useCallback(async (sec: number) => {
    // Cancel any in-flight snapshot so fast slider drags can't resolve out of
    // order and leave the readout showing a stale second.
    ttAbortRef.current?.abort();
    const ac = new AbortController();
    ttAbortRef.current = ac;
    try {
      const d = await (await fetch(`/api/timetravel?seconds=${Math.round(sec)}`, { signal: ac.signal })).json();
      setSnapshot({ total: d.total ?? null, sample: d.sample ?? [] });
    } catch { /* aborted or failed — keep last */ }
  }, []);

  useEffect(() => {
    refreshRegions();
    refreshMemories();
    refreshStats();
    refreshSnapshot(0);
    fetch("/api/chaos").then((r) => r.json()).then(setChaosReal).catch(() => {});
  }, [refreshRegions, refreshMemories, refreshStats, refreshSnapshot]);

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
      setTurns((t) => [...t, ...traceTurns, { role: "agent", text: data.reply, evidence: data.evidence ?? [] }]);
      if (data.memoryDegraded) {
        setTurns((t) => [...t, { role: "trace", tool: "memory write degraded", detail: "some memories were not persisted" }]);
      }
      if (data.incidentId) refreshIncident(data.incidentId);
      refreshMemories();
      refreshStats();
      refreshSnapshot(timeSeconds);
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
        const res = await fetch("/api/chaos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setTurns((t) => [...t, { role: "trace", tool: "chaos control failed", detail: data.error ?? `HTTP ${res.status}` }]);
        }
        await new Promise((r) => setTimeout(r, CHAOS_SETTLE_MS));
        await refreshRegions();
        await refreshStats();
      } catch (err) {
        const detail = err instanceof DOMException && err.name === "TimeoutError" ? "timed out after 120s" : (err as Error).message;
        setTurns((t) => [...t, { role: "trace", tool: "chaos control failed", detail }]);
      } finally { setChaosBusy(false); }
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
  const totalRows = dist.reduce((s, d) => s + Number(d.rows), 0);
  const survivingRows = shownDist
    .filter((d) => d.region !== simDowned)
    .reduce((s, d) => s + Number(d.rows), 0);

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
                  <div className="body-text">{t.role === "agent" ? clean(t.text) : t.text}</div>
                  {t.role === "agent" && t.evidence && t.evidence.length > 0 && (
                    <div className="ledger">
                      <div className="ledger-h">evidence — {t.evidence.length} memories recalled · lower distance = closer</div>
                      {t.evidence.map((e, j) => (
                        <div className="ledger-row" key={`${e.id}-${j}`}>
                          <span className="ln">[{j + 1}]</span>
                          <span className="lt">{e.title}</span>
                          <span className="lm">
                            {e.kind} · {e.region} · dist {e.distance.toFixed(2)}
                            {e.sourceUrl && e.sourceUrl.startsWith("https://") && (
                              <>
                                {" · "}
                                <a className="lsrc" href={e.sourceUrl} target="_blank" rel="noopener noreferrer">
                                  source ↗
                                </a>
                              </>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
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
              {regions.length > 0 && (
                <RegionMap
                  nodes={regions.map((r) => ({
                    region: r.region,
                    rows: shownDist.find((d) => d.region === r.region)?.rows ?? 0,
                    down: regionDown(r.region),
                    primary: r.primary,
                  }))}
                />
              )}
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
                      <span style={{ color: "var(--down)", fontWeight: 500 }}>Simulated:</span>{" "}
                      a live query excluding <b>{downedRegion}</b> —{" "}
                      <span className="ok">{survivingRows.toLocaleString()} of {totalRows.toLocaleString()} memories</span>{" "}
                      still answer from surviving regions. A real node-kill is shown on the local rig.
                    </>
                  )
                ) : (
                  <>All regions healthy · {totalRows.toLocaleString()} memories across {regions.length} regions.</>
                )}
              </div>
            </div>
          </div>

          <div className="panel">
            <h2>Memory time-travel — AS OF SYSTEM TIME</h2>
            <div className="body">
              <div className="hint" style={{ marginBottom: 14 }}>
                Rewind the agent&rsquo;s memory to a past moment. CockroachDB reads a consistent
                historical snapshot — no backups, no separate store. Bounded by the cluster&rsquo;s
                garbage-collection window; reflects when each memory was written.
              </div>
              <div className="tt-readout">
                <span className="tt-total">{snapshot.total != null ? snapshot.total.toLocaleString() : "—"}</span>
                <span className="tt-label">memories {agoLabel(timeSeconds)}</span>
              </div>
              <input
                className="tt-slider"
                type="range"
                min={0}
                max={TT_MAX_SECONDS}
                step={10}
                value={timeSeconds}
                aria-label="Rewind memory (seconds ago)"
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setTimeSeconds(v);
                  if (ttDebounceRef.current) clearTimeout(ttDebounceRef.current);
                  ttDebounceRef.current = setTimeout(() => refreshSnapshot(v), TT_DEBOUNCE_MS);
                }}
              />
              <div className="tt-scale">
                <span>now</span>
                <span>10 min ago</span>
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
                    <span className="mem-content">{clean(m.content)}</span>
                    <span className="region-badge">{m.region.replace("aws-", "")}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="panel">
            <h2>Memory hygiene — the gated write path</h2>
            <div className="body memfeed">
              {hygiene.length === 0 ? (
                <div className="hint">
                  Every learned fix passes a write gate before it can influence recall:
                  content filtering, duplicate consolidation, contradiction checks, and
                  decay for knowledge that never earns trust. Decisions appear here.
                </div>
              ) : (
                hygiene.map((e) => (
                  <div className="mem-item" key={e.id}>
                    <span className={`mem-kind hyg-${e.action}`}>{HYGIENE_LABELS[e.action] ?? e.action}</span>
                    <span className="mem-content">{e.detail}</span>
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
