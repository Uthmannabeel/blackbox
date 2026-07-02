# BlackBox — demo video script v2 (target 2:50 / max 3:00)

Screen recording + voiceover. Three acts: **recall → learn → survive.**
Everything on screen is real: live cluster, real node kills, live queries.

Setup before recording: chaos rig running (infra/chaos/README.md), 10k corpus
seeded, `npm run dev` against the rig (or CockroachDB Cloud + Bedrock if
provisioned). Stats strip visible: “10,011 memories · recall ~140ms · 3/3 regions”.

---

### 0:00–0:15 — Hook
> "Every AI agent claims to have memory — until the database behind it fails.
> This is BlackBox: an incident copilot whose memory survives the crash. And
> I'm going to prove that by killing a region live, on camera."

On screen: dashboard. Stats strip shows 10,011 memories / 3/3 regions.

### 0:15–0:55 — Act I: RECALL (institutional memory at scale)
Type: *"checkout-api p99 latency just jumped to 8s and connections are maxed out."*
> "The agent searches ten thousand past incidents in CockroachDB — semantic
> recall over a distributed vector index, about 140 milliseconds — and finds
> the connection-pool exhaustion we solved before, plus the matching runbook.
> It opens an incident and writes its working state to durable memory."

On screen: tool trace fires; reply cites the past incident; incident card
appears (severity, phase, hypotheses); memory stream fills up with region badges.

### 0:55–1:25 — Act II: LEARN (memory that compounds)
Click chip: *"We raised the pool size — mark it resolved."*
> "Here's the part most demos fake: when an incident resolves, BlackBox
> distills the fix into a NEW runbook — procedural memory, written back to the
> database. The next time anything similar happens, the agent recalls the fix
> it just learned. The memory compounds. That's the difference between a chat
> log and agentic memory."

On screen: resolve trace shows "Resolving incident + distilling runbook";
memory stream shows the 💭 reflection entry.

### 1:25–2:20 — Act III: SURVIVE (the money shot)
> "Now the reason this runs on CockroachDB. Watch the region panel — three
> regions, every memory pinned to a home region, REGIONAL BY ROW."

Click **⚡ KILL us-east1 (REAL)**.
> "That button is not a simulation. It's draining every node in the region —
> watch them go: zero of three nodes. An entire region of the database is dead."

On screen: region flips to 0/3 nodes — DOWN; stats strip: 2/3 regions.
> "And the agent? Ask it yourself."

Click chip: *"Is your memory OK? Diagnose it."*
> "It checks the health of its own brain: one region down — and every one of
> its ten thousand memories still readable AND writable, because the database
> is set to SURVIVE REGION FAILURE. Recall still answers in milliseconds —
> including memories whose home region is the one we just killed."

On screen: agent's self-diagnosis reply; send another incident question —
recall still works; stats strip recall latency still ~150ms.

Click **◼ RESTORE REGION**.
> "Region restored. Zero data loss. The flight recorder survived the crash."

### 2:20–2:50 — Architecture + close
> "Under the hood: one CockroachDB is both system of record and agent memory —
> episodic incidents, learned runbooks, the agent's own thought stream, and
> transactional incident state, all regional-by-row with distributed vector
> indexes. Reasoning is Claude on Amazon Bedrock; embeddings are Titan; the
> agent introspects its cluster through CockroachDB's Managed MCP Server."

On screen: architecture diagram 3s → repo + live demo URL.
> "BlackBox. Agents that remember — reliably, globally, at any scale."

---

## Recording checklist
- [ ] Rig running + seeded; `CHAOS_CONTROL_PORT=7777` set so the kill is real
- [ ] Bedrock configured for live reasoning (else BLACKBOX_MOCK_AGENT=1 — replies
      are scripted but ALL database behavior is real; disclose in the video if used)
- [ ] 1440p, big fonts, no notifications; stats strip visible at all times
- [ ] Rehearse Act III timing: node drain takes ~12s — narrate over it
- [ ] Hard limit 3:00 — trim Act I first if over
- [ ] Upload unlisted (YouTube/Vimeo); link in Devpost + README
