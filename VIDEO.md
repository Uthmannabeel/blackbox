# BlackBox — demo video script (target 2:45 / max 3:00)

Format: screen recording + voiceover. Keep cuts tight. Show the product doing
real work; let the chaos moment breathe.

---

### 0:00–0:20 — Hook (talking head or title card)
> "Every AI agent claims to have memory — until the database behind it fails.
> BlackBox is an incident-response copilot whose memory is built to survive the
> very outages it's helping you fix. Like a flight recorder for your
> infrastructure."

On screen: title "BlackBox — the incident copilot whose memory survives the crash."

### 0:20–0:35 — The problem
> "When you're on call at 3am, you don't want an agent that starts from zero.
> You want one that remembers every incident your team has ever solved — and
> keeps remembering even while a region is on fire."

On screen: the dashboard, "cluster live" pill, three regions healthy.

### 0:35–1:20 — Reason / recall / act (core demo)
Type: *"checkout-api p99 latency just spiked to 8s and connections are maxed out."*
> "Watch the trace. First it recalls similar past incidents from CockroachDB…"

On screen: tool trace fires — `recall_similar_incidents`, `recall_runbooks`.
> "…and it finds it: a connection-pool exhaustion incident we resolved before,
> its memory pinned to us-east-1. It pulls the matching runbook, opens a new
> incident, and writes the live state back to memory."

On screen: agent reply citing the past incident + resolution; active incident id appears.

### 1:20–1:45 — Why CockroachDB (memory model)
> "This isn't just a vector store. Every memory — incidents, runbooks, the
> agent's own reasoning — is REGIONAL BY ROW. An EU incident's data physically
> stays in the EU. And it's all one strongly-consistent system of record."

On screen: memory panel — per-region counts across us-east-1 / eu-west-1 / ap-south-1.

### 1:45–2:25 — The money shot: survive a region outage
> "Now the part no single-region vector store can do. Mid-incident, I'll take
> the primary region offline."

On screen: click **⚡ SIMULATE REGION OUTAGE**. Primary region goes red/dashed.
> "us-east-1 is gone. But look — the agent's memory is still here. X of Y
> memories still served from the surviving regions, zero data loss."

Type another question; the agent still recalls and answers.
> "The copilot never blinked. Its memory survived the crash — because it's
> running on CockroachDB with SURVIVE REGION FAILURE."

On screen: restore region; all green again.

### 2:25–2:45 — Architecture + close
> "Under the hood: CockroachDB for distributed vector memory and cluster
> introspection over the Managed MCP Server, and AWS Bedrock — Claude for
> reasoning, Titan for embeddings — on Lambda."

On screen: architecture diagram (2–3 seconds), then repo + demo URL.
> "BlackBox. Agents that remember — reliably, globally, at any scale.
> Code and live demo linked below."

---

## Recording checklist
- [ ] Run against the LIVE cluster if possible (pill shows "cluster live") so the
      region counts are real; mock mode is the fallback.
- [ ] Pre-seed the DB (`npm run db:seed`) so recall has history.
- [ ] 1440p, hide bookmarks/notifications, increase editor/browser font.
- [ ] Keep total under 3:00 (hard limit). Trim the intro first if over.
- [ ] Upload unlisted to YouTube/Vimeo; put the link in Devpost + README.
