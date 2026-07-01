# BlackBox — Devpost submission

> Draft submission copy for the CockroachDB × AWS "Build with Agentic Memory"
> Hackathon. Paste into the Devpost fields; tighten to taste.

---

## Tagline
The incident-response agent whose memory survives the crash.

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
- **Recalls institutional memory** — "have we seen this before?" — via semantic
  search over every past incident and runbook.
- **Reasons and acts** through a tool-using loop: recall → hypothesize →
  inspect the live cluster → open an incident → track state → resolve.
- **Remembers everything durably** — each observation, action, and resolution is
  written back to memory, so the next incident starts smarter.
- **Survives region failure** — its memory stays available and strongly
  consistent even when an entire cloud region goes dark, which we demonstrate
  live with a "chaos" control.

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
**CockroachDB (3 of the required tools; 2 required):**
- Distributed Vector Indexing (regional-by-row semantic memory)
- Cloud Managed MCP Server (agent introspects the cluster)
- `ccloud` CLI (provisioned the multi-region cluster)

**AWS (3; 1 required):**
- Amazon Bedrock (Claude reasoning + Titan embeddings)
- AWS Lambda (hosts the agent loop)
- Amazon S3 (incident artifacts / postmortems)

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
- Designing recall that stays local and survivable — solved with region-prefixed
  vector indexes so the ANN tree lives with its region's data.
- Keeping the agent stateless for horizontal scale while preserving multi-turn
  context — all durable state lives in CockroachDB; only the in-flight
  conversation is held per instance.
- Making "survivability" demonstrable in under three minutes without faking it.

## Accomplishments we're proud of
- A genuine reason/recall/act agent whose memory model maps to the three classic
  memory types, backed by production-shaped CockroachDB.
- A live chaos moment that answers "why CockroachDB?" viscerally.
- Real tests, rate limiting, security headers, and read-only guarded MCP access.

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
- Demo: <vercel url>
- Video: <youtube/vimeo url>
