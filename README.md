# BlackBox

**The incident-response agent whose memory survives the crash.**

BlackBox is an SRE copilot that triages, diagnoses, and helps mitigate production
incidents. Like an aircraft's flight recorder, its memory is built to survive the
very failures it's helping you fight: it stays **globally available, strongly
consistent, and region-pinned** on top of CockroachDB -- so when a whole cloud
region goes dark mid-incident, the agent keeps remembering and keeps reasoning.

We prove it, not claim it: in our demo we kill every node in the database's
**primary region on camera** with 3,500+ memories loaded -- **zero memories lost**,
recall still answering in **~140 ms** (including rows homed in the dead region),
and writes to the dead region still committing.

> Built for the **CockroachDB x AWS "Build with Agentic Memory" Hackathon.**
>
> **Live demo: https://blackbox-web-eight.vercel.app** -- landing site; the
> interactive agent is at `/console` (live: real Claude on Bedrock + multi-region
> CockroachDB Cloud). An offline mock mode runs the whole UX with no credentials.

---

## Why CockroachDB (not pgvector, DynamoDB, or Redis)

Most agent-memory demos use a database you could swap for anything. BlackBox is
designed around the things **only CockroachDB** does well -- and the survivability
demo eliminates each usual choice:

- **pgvector / single-region Postgres** loses the agent's entire memory the moment
  its region goes down -- exactly when an incident agent is needed most.
- **DynamoDB global tables** are eventually consistent, so live incident state and
  recalled memory can disagree mid-crisis.
- **Redis / in-memory vector stores** are fast but not a durable system of record;
  a failover or restart is amnesia.
- **A dedicated vector DB bolted to a separate state store** is two systems to keep
  in sync, and split-brain during the one outage you can least afford it.

| Capability | How BlackBox uses it | Why it matters |
|---|---|---|
| **`REGIONAL BY ROW`** | Every memory (incident, runbook, thought) is pinned to its home region via `crdb_region`. | Low-latency local recall + **data residency by row** -- an EU incident's memory never leaves the EU. |
| **`SURVIVE REGION FAILURE`** | The memory database tolerates the loss of an entire region with no data loss. | The agent's memory outlives the outage it is diagnosing. This is the live demo money-shot. |
| **Distributed Vector Indexing (C-SPANN)** | `VECTOR(1024)` columns with region-prefixed vector indexes for semantic recall. | "Have we seen this incident before?" over millions of vectors, co-located per region. |
| **Strong consistency** | Live `incident_state` (phase, hypotheses, actions) is transactional. | The agent never acts on stale or split-brain state during a crisis. |

One system is both the **system of record** and the **agent memory layer** -- no
stitching a vector DB to a state store to a cache.

## Beyond recall: memory that compounds, and an agent that triages its own brain

- **Learning loop** -- when the agent resolves an incident, the resolution is
  automatically distilled into a new *learned runbook* (procedural memory).
  The next similar incident recalls the fix the agent just learned.
- **Self-diagnosis** -- the agent's memory *is* a CockroachDB cluster, and its
  `diagnose_memory` tool observes per-region node liveness and the survival
  goal, so mid-outage it can explain: "one region is down; all my memories
  remain readable and writable."

---

## Required tooling used

**CockroachDB (using 2 of the required tools; 2 required):**
- **Distributed Vector Indexing** -- semantic memory over incidents, runbooks, and the agent's thought stream (`db/schema.sql`).
- **Cloud Managed MCP Server** -- the agent introspects the live cluster it operates (schema, health, running queries) as a tool during reasoning.
- **`ccloud` CLI** -- documented provisioning path (`infra/`); the live cluster was created via the Cloud console.

**AWS (using 1; 1 required):**
- **Amazon Bedrock** -- Claude for reasoning + Titan Text Embeddings v2 (1024-dim) for memory embeddings.
- **AWS Lambda** -- a deployable Lambda handler is included (`packages/agent/src/lambda.ts`); the live demo is served by Vercel serverless functions.

---

## Memory model

BlackBox implements the three classic memory types an agent needs, each backed by
a CockroachDB table (see `db/schema.sql`):

- **Episodic** -- `incidents`: what happened, when, how it was resolved.
- **Semantic / procedural** -- `runbooks`: how to fix classes of problem.
- **Working + long-term stream** -- `agent_memory`: the agent's observations,
  actions, and reflections, importance-weighted for recall.
- **Structured live state** -- `incident_state`: the transactional source of truth
  for an in-flight incident.

Every table is `REGIONAL BY ROW` with a region-prefixed vector index.

---

## Architecture

```
  Operator (browser)
        |
        v
  +-----------------------------+
  | web/  Next.js dashboard     |
  | chat . timeline . CHAOS btn |
  +--------------+--------------+
                 |
                 v
  +-----------------------------+
  | packages/agent (AWS Lambda) |
  | reason <-> recall <-> act   |
  | Bedrock: Claude + Titan     |
  +----+-------------------+----+
       | memory tools      | introspection
       v                   v
  +--------------+   +---------------------+
  | packages/    |   | CockroachDB Cloud   |
  | memory (pg)  |-->| Managed MCP Server  |
  +------+-------+   +---------------------+
         |
         v
  +------------------------------------------+
  | CockroachDB Cloud -- multi-region        |
  | us-east-1 . eu-west-1 . ap-south-1       |
  | REGIONAL BY ROW . SURVIVE REGION FAILURE |
  | distributed VECTOR indexes (C-SPANN)     |
  +------------------------------------------+
```

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for detail.

---

## Repository layout

```
cockroach-ai/
  db/                 CockroachDB schema + seed (the memory layer's heart)
  packages/
    memory/           TypeScript memory service over pg + Bedrock embeddings
    agent/            Agentic reason/recall/act loop on Bedrock
  web/                Next.js demo dashboard (incident chat + chaos button)
  infra/              ccloud + AWS provisioning
```

## Getting started

### Try it offline in 30 seconds (no cloud, no keys)

```bash
npm install
npm run dev:mock              # open http://localhost:3000
```

Mock mode swaps in deterministic embeddings, an in-memory store seeded with the
sample incidents, and a scripted agent -- so the full UI (recall, incident
timeline, chaos/survivability panel) runs with zero credentials. Great for a
first look and as a demo fallback.

### Run against real CockroachDB + AWS Bedrock

```bash
npm install
cp .env.example .env          # fill in CockroachDB + AWS credentials
npm run db:schema             # apply db/schema.sql to your cluster
npm run db:seed               # load sample fleet + historical incidents (embeds via Bedrock)
npm run agent:dev             # talk to the agent from the CLI
npm run dev                   # or use the web dashboard at http://localhost:3000
```

See [`infra/README.md`](./infra/README.md) for provisioning the multi-region
cluster, enabling the Managed MCP Server, and requesting Bedrock model access.

## Tests

```bash
npm test          # vitest -- runs the full suite in offline mock mode
```

Covers embedding determinism + similarity ordering, semantic recall over the
seeded memory, the agent's reason/recall/act loop, and API rate limiting.

## Production hardening

- Read-only, statement-validated cluster introspection via MCP (rejects
  multi-statement SQL and DML smuggled through a CTE)
- Rate limiting keyed to the platform-trusted client IP; input validation on the
  agent endpoint
- Parameterized SQL throughout; TLS `verify-full` to the cluster
- Durable, cross-instance rate limiting backed by CockroachDB itself
- Least-privilege credentials (scoped Bedrock IAM policy + read-only MCP account)
- CSP + `Strict-Transport-Security`/`X-Frame-Options`/`X-Content-Type-Options` headers
- Errors logged server-side; never leaked to clients

## License

Apache-2.0 -- see [`LICENSE`](./LICENSE).
