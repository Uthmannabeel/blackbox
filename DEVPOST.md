# BlackBox â€” Devpost submission

> Draft submission copy for the CockroachDB Ã— AWS "Build with Agentic Memory"
> Hackathon. Paste into the Devpost fields; tighten to taste.

---

## Tagline
The incident-response agent whose memory survives the crash.

## Inspiration
Every AI agent demo has "memory" â€” until the database it depends on has a bad
day. We asked a harder question: what should an agent remember when the thing
it's helping you fix is a production outage? An SRE copilot is only trustworthy
if its memory is **available during a failure, consistent across regions, and
compliant with where data is allowed to live.** That is exactly, and almost
uniquely, what CockroachDB is built for. So we built BlackBox: an incident
copilot whose memory is a globally-distributed, survivable system of record â€”
like an aircraft's flight recorder for your infrastructure.

## What it does
BlackBox triages, diagnoses, and helps mitigate production incidents:
- **Recalls institutional memory at scale** â€” "have we seen this before?" â€”
  semantic search over a 3,500+ incident corpus via CockroachDB's distributed
  vector index (~140ms top-5 on the local rig; ~1-2s cross-region on managed Cloud).
- **Learns** â€” every resolution is automatically distilled into a new runbook
  (procedural memory). The next similar incident recalls the fix the agent
  just learned. Memory that compounds, not a chat log.
- **Reasons and acts** through a tool-using loop: recall â†’ hypothesize â†’
  inspect the live cluster â†’ open an incident â†’ track state â†’ resolve.
- **Survives region failure â€” for real.** Our demo kills every node in the
  database's primary region on camera: all memories stay readable AND
  writable from surviving replicas, including rows homed in the dead region.
- **Diagnoses its own brain** â€” the agent's memory *is* a CockroachDB cluster,
  and a `diagnose_memory` tool lets it observe per-region node liveness and
  explain its own degraded-but-survivable state mid-outage.

## How we built it
- **Memory layer â€” CockroachDB.** Four memory surfaces (episodic incidents,
  procedural runbooks, the agent's working/long-term stream, and transactional
  live incident state), all `LOCALITY REGIONAL BY ROW` on a database set to
  `SURVIVE REGION FAILURE`. Semantic recall uses **distributed vector indexes
  (C-SPANN)** with a `crdb_region` prefix so each region's k-means tree is
  co-located with its data.
- **Reasoning â€” Amazon Bedrock.** Claude drives the reason/recall/act loop via
  the Converse API with tool use; Titan Text Embeddings v2 (1024-dim) generate
  the vectors.
- **Cluster introspection â€” CockroachDB Managed MCP Server.** The agent can run
  read-only SQL against the live cluster it operates â€” an ops agent that can
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
- **`REGIONAL BY ROW`** â†’ per-row data residency (an EU incident's memory never
  leaves the EU) plus low-latency local recall.
- **`SURVIVE REGION FAILURE`** â†’ the agent's memory outlives the outage it's
  diagnosing.
- **One system of record** for both vector memory and strongly-consistent live
  state â€” no stitching a vector DB to a state store to a cache.

## Challenges we ran into
- Making "survivability" demonstrable without faking it: we built a local
  9-node, 3-region chaos rig (`cockroach demo --demo-locality`) with a driver
  that lets the app kill real nodes â€” and validated reads AND writes against a
  dead primary region.
- We found (and worked around) a real v25.4.0 bug: post-hoc `CREATE INDEX` on
  REGIONAL BY ROW tables with vector indexes hits an internal error XX000 â€”
  plus other gotchas, all written up in FEEDBACK.md for the CockroachDB team.
- Single-gateway writes silently pin every row to one region
  (`gateway_region()` default) â€” our seeders and docs handle row-home
  distribution explicitly.
- Keeping the agent stateless for horizontal scale while preserving multi-turn
  context â€” all durable state lives in CockroachDB; only the in-flight
  conversation is held per instance.

## Accomplishments we're proud of
- A genuine reason/recall/act agent whose memory model maps to the three classic
  memory types, backed by production-shaped CockroachDB.
- A live chaos moment that answers "why CockroachDB?" viscerally.
- Real tests, rate limiting, security headers, and read-only guarded MCP access.

## What we learned
Agent memory is a database problem, not a prompt problem. The properties that
make a database trustworthy â€” consistency, availability, residency â€” are exactly
the properties that make an agent trustworthy.

## What's next
- Row-level, per-tenant residency policies driven by data-classification.
- Automated postmortems written back as new runbooks (memory that compounds).
- Multi-agent on-call: several agents sharing one survivable memory.

## Links
- Repo: https://github.com/Uthmannabeel/blackbox
- Demo: https://blackbox-web-eight.vercel.app
- Video: <youtube/vimeo url>
