# 🛩️ BlackBox

**The incident-response agent whose memory survives the crash.**

BlackBox is an SRE copilot that triages, diagnoses, and helps mitigate production
incidents. Like an aircraft's flight recorder, its memory is built to survive the
very failures it's helping you fight: it stays **globally available, strongly
consistent, and region-pinned** on top of CockroachDB — so when a whole cloud
region goes dark mid-incident, the agent keeps remembering and keeps reasoning.

> Built for the **CockroachDB × AWS "Build with Agentic Memory" Hackathon.**

---

## Why CockroachDB (not just a vector store)

Most agent-memory demos use a database you could swap for anything. BlackBox is
designed around the things **only CockroachDB** does well:

| Capability | How BlackBox uses it | Why it matters |
|---|---|---|
| **`REGIONAL BY ROW`** | Every memory (incident, runbook, thought) is pinned to its home region via `crdb_region`. | Low-latency local recall + **data residency by row** — an EU incident's memory never leaves the EU. |
| **`SURVIVE REGION FAILURE`** | The memory database tolerates the loss of an entire region with no data loss. | The agent's memory outlives the outage it is diagnosing. This is the live demo money-shot. |
| **Distributed Vector Indexing (C-SPANN)** | `VECTOR(1024)` columns with region-prefixed vector indexes for semantic recall. | "Have we seen this incident before?" over millions of vectors, co-located per region. |
| **Strong consistency** | Live `incident_state` (phase, hypotheses, actions) is transactional. | The agent never acts on stale or split-brain state during a crisis. |

One system is both the **system of record** and the **agent memory layer** — no
stitching a vector DB to a state store to a cache.

---

## Required tooling used

**CockroachDB (using 3 of the required tools; ≥2 required):**
- ✅ **Distributed Vector Indexing** — semantic memory over incidents, runbooks, and the agent's thought stream (`db/schema.sql`).
- ✅ **Cloud Managed MCP Server** — the agent introspects the live cluster it operates (schema, health, running queries) as a tool during reasoning.
- ✅ **`ccloud` CLI** — provisions the multi-region cluster and enables region survivability (`infra/`).

**AWS (using 3; ≥1 required):**
- ✅ **Amazon Bedrock** — Claude for reasoning + Titan Text Embeddings v2 (1024-dim) for memory embeddings.
- ✅ **AWS Lambda** — hosts the agent loop.
- ✅ **Amazon S3** — stores incident artifacts and postmortems.

---

## Memory model

BlackBox implements the three classic memory types an agent needs, each backed by
a CockroachDB table (see `db/schema.sql`):

- **Episodic** — `incidents`: what happened, when, how it was resolved.
- **Semantic / procedural** — `runbooks`: how to fix classes of problem.
- **Working + long-term stream** — `agent_memory`: the agent's observations,
  actions, and reflections, importance-weighted for recall.
- **Structured live state** — `incident_state`: the transactional source of truth
  for an in-flight incident.

Every table is `REGIONAL BY ROW` with a region-prefixed vector index.

---

## Architecture

```
                         ┌─────────────────────────────┐
   Operator (browser) ── │  web/  Next.js dashboard     │
                         │  chat · timeline · CHAOS btn │
                         └──────────────┬──────────────┘
                                        │
                         ┌──────────────▼──────────────┐
                         │  packages/agent (AWS Lambda) │
                         │  reason ↔ recall ↔ act loop  │
                         │  Bedrock: Claude + Titan     │
                         └───────┬───────────────┬──────┘
                    memory tools │               │ introspection
                         ┌───────▼──────┐  ┌─────▼─────────────┐
                         │ packages/    │  │ CockroachDB Cloud │
                         │ memory (pg)  │──│ Managed MCP Server│
                         └───────┬──────┘  └───────────────────┘
                                 │
              ┌──────────────────▼───────────────────────┐
              │  CockroachDB Cloud — multi-region         │
              │  us-east-1 · eu-west-1 · ap-south-1       │
              │  REGIONAL BY ROW · SURVIVE REGION FAILURE │
              │  distributed VECTOR indexes (C-SPANN)     │
              └───────────────────────────────────────────┘
```

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for detail.

---

## Repository layout

```
cockroach-ai/
├── db/                 CockroachDB schema + seed (the memory layer's heart)
├── packages/
│   ├── memory/         TypeScript memory service over pg + Bedrock embeddings
│   └── agent/          Agentic reason/recall/act loop on Bedrock
├── web/                Next.js demo dashboard (incident chat + chaos button)
└── infra/              ccloud + AWS provisioning
```

## Getting started

```bash
npm install
cp .env.example .env          # fill in CockroachDB + AWS credentials
npm run db:schema             # apply db/schema.sql to your cluster
npm run db:seed               # load sample fleet + historical incidents
npm run agent:dev             # talk to the agent from the CLI
```

## License

Apache-2.0 — see [`LICENSE`](./LICENSE).
