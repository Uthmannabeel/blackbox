# BlackBox — demo video script v3 (target 2:55 / hard max 3:00)

Screen recording + voiceover. Five beats: **recall with receipts → learn →
survive → time-travel → it's real**. Everything on screen is live: real Claude
on Bedrock, real multi-region CockroachDB Cloud, real queries.

Setup before recording:
- Live site: https://blackbox-web-eight.vercel.app (pill shows "live · multi-region CockroachDB").
- For the on-camera node-kill (Act III), run the local chaos rig (`infra/chaos/README.md`) in a second window; on managed Cloud use the console's simulated drill and say so.
- Pick light or dark deliberately and stay consistent. 1440p, big fonts, no notifications.

---

### 0:00–0:15 — Hook
> "Every AI agent claims to have memory — until the database behind it fails,
> and it fails exactly when you need it: mid-outage. BlackBox is an incident
> copilot whose memory survives the crash it's diagnosing. I'll prove it by
> killing a whole region, live — zero of ten thousand memories lost, recall
> still answering in 136 milliseconds."

On screen: the landing hero + the flight-recorder strip showing three regions
with live memory counts.

### 0:15–0:55 — Act I: RECALL, with receipts
Open the console. Click the suggested incident:
*"checkout-api p99 latency just jumped to 8s and connections are maxed out."*
> "The agent searches thousands of past incidents in CockroachDB — distributed
> vector search, per region — and finds the connection-pool exhaustion we solved
> before. And it shows its receipts."

On screen: the tool trace fires; the reply appears; the **evidence ledger**
renders under it — numbered memories with region and raw distance. Point at it.
> "Every claim is backed by the exact memories it recalled — id, home region,
> vector distance. Not 'trust me' — provenance."

### 0:55–1:20 — Act II: LEARN
Click the chip: *"We raised the pool size — mark it resolved."*
> "Here's the part most demos fake. When an incident resolves, BlackBox distills
> the fix into a new runbook — procedural memory, written back to the database.
> The next similar incident will recall the fix it just learned. Memory that
> compounds, not a chat log."

On screen: the resolve trace ("resolving incident, distilling runbook"); the
memory stream shows the new reflection entry.

### 1:20–2:05 — Act III: SURVIVE (the money shot)
> "Now the reason this runs on CockroachDB. Three regions — watch the topology.
> Every memory is REGIONAL BY ROW."

On screen: the live region topology (three nodes, replication links, primary ringed).
Trigger the region kill (rig: `\demo shutdown` the primary region's nodes; Cloud:
the failure drill, stated as simulated).
> "I'm taking the primary region offline. Watch it go dark — and the counts.
> Now ask the agent about its own memory."

Click the chip: *"Is your memory OK? Diagnose it."*
> "It inspects its own cluster through CockroachDB's Managed MCP Server: one
> region down — and every memory still readable and writable from surviving
> replicas, because the database is set to SURVIVE REGION FAILURE. It never lost
> a thing."

On screen: the topology node dark; agent's self-diagnosis reply; stats strip
still serving. Restore the region.

### 2:05–2:30 — Act IV: TIME-TRAVEL
> "One more only-CockroachDB trick. This slider rewinds the agent's memory using
> AS OF SYSTEM TIME — a consistent historical read, no backups, no separate
> store. This is the agent's mind, ten minutes ago, before it learned that fix."

On screen: drag the memory time-travel slider; the count changes to the past state.

### 2:30–2:55 — Act V: it's real, and close
> "Under the hood: one CockroachDB is system of record, vector memory, live
> incident state — even the rate limiter. Reasoning is Claude on Amazon Bedrock,
> embeddings are Titan. We red-teamed our own build — durable writes, a
> database-backed rate limiter, least-privilege keys, honest metrics."

On screen: the architecture page (spec table + diagram + residency proof) for 3s,
then repo + live URL.
> "BlackBox. Agents that remember — reliably, globally, at any scale. Code and
> live demo below."

---

## Recording checklist
- [ ] Pre-seed done; stats strip shows the corpus, 3/3 regions.
- [ ] Evidence ledger renders (send one incident before recording to warm it).
- [ ] Act III: rehearse the node drain (~12s) — narrate over it; do ONE kill cycle.
- [ ] Managed Cloud can't show raw node-kill — either use the local rig for Act III,
      or keep the "simulated drill" wording. Never imply a real kill you didn't do.
- [ ] Time-travel: works best if you opened/resolved an incident earlier so the
      recent count visibly differs from the past snapshot.
- [ ] Hard limit 3:00. If over, trim Act I narration first.
- [ ] Upload unlisted to YouTube/Vimeo; put the link in Devpost + README.
