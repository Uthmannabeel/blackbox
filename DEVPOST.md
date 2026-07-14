# BlackBox — Devpost submission

> Draft submission copy for the CockroachDB × AWS "Build with Agentic Memory"
> Hackathon. Paste into the Devpost fields; tighten to taste.

---

## Tagline
We kill the agent's primary database region on camera: zero of 10,000 memories
lost, recall still answering in 136 ms. The incident copilot whose memory
survives the crash it's diagnosing.

## Inspiration
Every AI agent demo has "memory" — until the database it depends on has a bad
day. We asked a harder question: what should an agent remember when the thing
it's helping you fix is a production outage? An SRE copilot is only trustworthy
if its memory is **available during a failure, consistent across regions, and
compliant with where data is allowed to live.** That is exactly, and almost
uniquely, what CockroachDB is built for. So we built BlackBox: an incident
copilot whose memory is a globally-distributed, survivable system of record —
like an aircraft's flight recorder for your infrastructure.

## What it does
BlackBox triages, diagnoses, and helps mitigate production incidents:
- **Recalls institutional memory at scale** — "have we seen this before?" —
  semantic search over a 3,500+ incident corpus via CockroachDB's distributed
  vector index (~140ms top-5 on the local rig; ~1-2s cross-region on managed Cloud).
- **Learns** — every resolution is automatically distilled into a new runbook
  (procedural memory). The next similar incident recalls the fix the agent
  just learned. Memory that compounds, not a chat log.
- **Reasons and acts** through a tool-using loop: recall → hypothesize →
  inspect the live cluster → open an incident → track state → resolve.
- **Survives region failure — for real.** Our demo kills every node in the
  database's primary region on camera: all memories stay readable AND
  writable from surviving replicas, including rows homed in the dead region.
- **Diagnoses its own brain** — the agent's memory *is* a CockroachDB cluster,
  and a `diagnose_memory` tool lets it observe per-region node liveness and
  explain its own degraded-but-survivable state mid-outage.

## How we built it
- **Memory layer — CockroachDB.** Four memory surfaces (episodic incidents,
  procedural runbooks, the agent's working/long-term stream, and transactional
  live incident state), all `LOCALITY REGIONAL BY ROW` on a database set to
  `SURVIVE REGION FAILURE`. Semantic recall uses **distributed vector indexes
  (C-SPANN)** with a `crdb_region` prefix so each region's k-means tree is
  co-located with its data.
- **Reasoning — Amazon Bedrock.** Claude drives the reason/recall/act loop via
  the Converse API with tool use; Titan Text Embeddings v2 (1024-dim) generate
  the vectors.
- **Cluster introspection — CockroachDB Managed MCP Server.** The agent can run
  read-only SQL against the live cluster it operates — an ops agent that can
  actually read its own database.
- **App.** TypeScript end-to-end (CockroachDB speaks the Postgres wire
  protocol), a Next.js "mission control" dashboard, and an AWS Lambda handler
  for the stateless agent. An offline mock mode runs the whole UX with no cloud.

## Which required tools we used
**CockroachDB (2 of the required tools; 2 required):**
- Distributed Vector Indexing (regional-by-row semantic memory)
- Cloud Managed MCP Server (agent introspects the cluster)

**AWS (1 required; Bedrock is the primary service):**
- Amazon Bedrock (Claude reasoning + Titan embeddings)
- AWS Lambda (deployable handler included; live demo on Vercel serverless)
- (S3/other AWS services: not used in the current build)

## Why CockroachDB specifically
Most agent-memory projects use a vector store you could swap for anything.
BlackBox is designed around what only CockroachDB does well:
- **`REGIONAL BY ROW`** → per-row data residency (an EU incident's memory never
  leaves the EU) plus low-latency local recall.
- **`SURVIVE REGION FAILURE`** → the agent's memory outlives the outage it's
  diagnosing.
- **One system of record** for both vector memory and strongly-consistent live
  state — no stitching a vector DB to a state store to a cache.

## Challenges we ran into
- Making "survivability" demonstrable without faking it: we built a local
  9-node, 3-region chaos rig (`cockroach demo --demo-locality`) with a driver
  that lets the app kill real nodes — and validated reads AND writes against a
  dead primary region.
- We found (and worked around) a real v25.4.0 bug: post-hoc `CREATE INDEX` on
  REGIONAL BY ROW tables with vector indexes hits an internal error XX000 —
  plus other gotchas, all written up in FEEDBACK.md for the CockroachDB team.
- Single-gateway writes silently pin every row to one region
  (`gateway_region()` default) — our seeders and docs handle row-home
  distribution explicitly.
- Keeping the agent stateless for horizontal scale while preserving multi-turn
  context — all durable state lives in CockroachDB; only the in-flight
  conversation is held per instance.

## Accomplishments we're proud of
- A genuine reason/recall/act agent whose memory model maps to the three classic
  memory types, backed by production-shaped CockroachDB.
- A live chaos moment that answers "why CockroachDB?" viscerally.
- We red-teamed our own build and hardened the load-bearing paths (below) instead
  of leaving them as demo scaffolding.

## Production readiness — we reviewed our own code
We ran a deliberately hostile senior-engineer review of BlackBox and fixed what a
judge would (rightly) attack:

- **Durable rate limiting, on CockroachDB.** The public agent endpoint is guarded
  by an atomic, cross-instance rate limiter (per-minute + per-day per client)
  backed by the same database — because an in-memory limiter resets on every
  serverless invocation and would never protect the model budget. Even the
  boring operational state is one system of record.
- **No silent memory loss.** Durable-memory writes are awaited and their failures
  surfaced to the UI (a `memoryDegraded` signal) — a memory product must not
  quietly drop what it claims to remember.
- **Read-only by the boundary, not a regex.** Cluster introspection routes only to
  the Managed MCP Server's read-only tools; we deleted a client-side allow-list
  that a data-modifying CTE could have slipped past.
- **Least privilege.** A scoped `bedrock:InvokeModel`-only IAM policy and a
  read-scoped MCP service account (Cluster Operator), documented in `infra/`.
- **Honest instrumentation.** Recall provenance shows the raw vector distance, not
  an invented similarity; the time-travel view states its GC-window bound; on
  managed Cloud the failure drill is labelled "simulated" (a live exclusion query
  proving surviving regions answer), with real node-kill shown on the local rig.
- Plus parameterised SQL throughout, CSP + security headers, input validation,
  exponential backoff on embedding throttles, and a test suite.

## What we learned
Agent memory is a database problem, not a prompt problem. The properties that
make a database trustworthy — consistency, availability, residency — are exactly
the properties that make an agent trustworthy.

## What's next
- Row-level, per-tenant residency policies driven by data-classification.
- Automated postmortems written back as new runbooks (memory that compounds).
- Multi-agent on-call: several agents sharing one survivable memory.

## Links
- Repo: https://github.com/Uthmannabeel/blackbox
- Demo: https://blackbox-web-eight.vercel.app
- Video: <youtube/vimeo url>
