# ðŸ›©ï¸ BlackBox

**The incident-response agent whose memory survives the crash.**

BlackBox is an SRE copilot that triages, diagnoses, and helps mitigate production
incidents. Like an aircraft's flight recorder, its memory is built to survive the
very failures it's helping you fight: it stays **globally available, strongly
consistent, and region-pinned** on top of CockroachDB â€” so when a whole cloud
region goes dark mid-incident, the agent keeps remembering and keeps reasoning.

> Built for the **CockroachDB Ã— AWS "Build with Agentic Memory" Hackathon.**
>
> **ðŸ”´ Live demo: https://blackbox-web-eight.vercel.app** — landing page; the interactive agent is at `/console` *(live: real Claude on Bedrock + multi-region CockroachDB Cloud)*
> full UX with scripted agent; flips to live Bedrock + CockroachDB Cloud for judging)*

---

## Why CockroachDB (not just a vector store)

Most agent-memory demos use a database you could swap for anything. BlackBox is
designed around the things **only CockroachDB** does well:

| Capability | How BlackBox uses it | Why it matters |
|---|---|---|
| **`REGIONAL BY ROW`** | Every memory (incident, runbook, thought) is pinned to its home region via `crdb_region`. | Low-latency local recall + **data residency by row** â€” an EU incident's memory never leaves the EU. |
| **`SURVIVE REGION FAILURE`** | The memory database tolerates the loss of an entire region with no data loss. | The agent's memory outlives the outage it is diagnosing. This is the live demo money-shot. |
| **Distributed Vector Indexing (C-SPANN)** | `VECTOR(1024)` columns with region-prefixed vector indexes for semantic recall. | "Have we seen this incident before?" over millions of vectors, co-located per region. |
| **Strong consistency** | Live `incident_state` (phase, hypotheses, actions) is transactional. | The agent never acts on stale or split-brain state during a crisis. |

One system is both the **system of record** and the **agent memory layer** â€” no
stitching a vector DB to a state store to a cache.

**And we prove it, not claim it:** the repo ships a local 9-node, 3-region
chaos rig ([`infra/chaos/`](./infra/chaos/README.md)). We killed every node in
the database's primary region with 3,500+ memories loaded â€” recall kept
answering in ~140ms (including memories homed in the dead region), and writes
homed in the dead region kept committing.

## Beyond recall: memory that compounds, and an agent that triages its own brain

- **Learning loop** â€” when the agent resolves an incident, the resolution is
  automatically distilled into a new *learned runbook* (procedural memory).
  The next similar incident recalls the fix the agent just learned.
- **Self-diagnosis** â€” the agent's memory *is* a CockroachDB cluster, and its
  `diagnose_memory` tool observes per-region node liveness and the survival
  goal, so mid-outage it can explain: "one region is down; all my memories
  remain readable and writable."

---

## Required tooling used

**CockroachDB (using 2 of the required tools; â‰¥2 required):**
- âœ… **Distributed Vector Indexing** â€” semantic memory over incidents, runbooks, and the agent's thought stream (`db/schema.sql`).
- âœ… **Cloud Managed MCP Server** â€” the agent introspects the live cluster it operates (schema, health, running queries) as a tool during reasoning.
- âœ… **`ccloud` CLI** — documented provisioning path (`infra/`); the live cluster was created via the Cloud console.

**AWS (using 1; â‰¥1 required):**
- âœ… **Amazon Bedrock** â€” Claude for reasoning + Titan Text Embeddings v2 (1024-dim) for memory embeddings.
- âœ… **AWS Lambda** — a deployable Lambda handler is included (`packages/agent/src/lambda.ts`); the live demo is served by Vercel serverless functions.

---

## Memory model

BlackBox implements the three classic memory types an agent needs, each backed by
a CockroachDB table (see `db/schema.sql`):

- **Episodic** â€” `incidents`: what happened, when, how it was resolved.
- **Semantic / procedural** â€” `runbooks`: how to fix classes of problem.
- **Working + long-term stream** â€” `agent_memory`: the agent's observations,
  actions, and reflections, importance-weighted for recall.
- **Structured live state** â€” `incident_state`: the transactional source of truth
  for an in-flight incident.

Every table is `REGIONAL BY ROW` with a region-prefixed vector index.

---

## Architecture

```
                         â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
   Operator (browser) â”€â”€ â”‚  web/  Next.js dashboard     â”‚
                         â”‚  chat Â· timeline Â· CHAOS btn â”‚
                         â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                        â”‚
                         â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                         â”‚  packages/agent (AWS Lambda) â”‚
                         â”‚  reason â†” recall â†” act loop  â”‚
                         â”‚  Bedrock: Claude + Titan     â”‚
                         â””â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”˜
                    memory tools â”‚               â”‚ introspection
                         â”Œâ”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                         â”‚ packages/    â”‚  â”‚ CockroachDB Cloud â”‚
                         â”‚ memory (pg)  â”‚â”€â”€â”‚ Managed MCP Serverâ”‚
                         â””â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                 â”‚
              â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
              â”‚  CockroachDB Cloud â€” multi-region         â”‚
              â”‚  us-east-1 Â· eu-west-1 Â· ap-south-1       â”‚
              â”‚  REGIONAL BY ROW Â· SURVIVE REGION FAILURE â”‚
              â”‚  distributed VECTOR indexes (C-SPANN)     â”‚
              â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for detail.

---

## Repository layout

```
cockroach-ai/
â”œâ”€â”€ db/                 CockroachDB schema + seed (the memory layer's heart)
â”œâ”€â”€ packages/
â”‚   â”œâ”€â”€ memory/         TypeScript memory service over pg + Bedrock embeddings
â”‚   â””â”€â”€ agent/          Agentic reason/recall/act loop on Bedrock
â”œâ”€â”€ web/                Next.js demo dashboard (incident chat + chaos button)
â””â”€â”€ infra/              ccloud + AWS provisioning
```

## Getting started

### Try it offline in 30 seconds (no cloud, no keys)

```bash
npm install
npm run dev:mock              # open http://localhost:3000
```

Mock mode swaps in deterministic embeddings, an in-memory store seeded with the
sample incidents, and a scripted agent â€” so the full UI (recall, incident
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
npm test          # vitest â€” runs the full suite in offline mock mode
```

Covers embedding determinism + similarity ordering, semantic recall over the
seeded memory, the agent's reason/recall/act loop, and API rate limiting.

## Production hardening

- Read-only, statement-guarded cluster introspection via MCP
- Parameterized SQL throughout; TLS `verify-full` to the cluster
- Rate limiting + input validation on the agent endpoint
- CSP + `Strict-Transport-Security`/`X-Frame-Options`/`X-Content-Type-Options` headers
- Errors logged server-side; never leaked to clients

## License

Apache-2.0 â€” see [`LICENSE`](./LICENSE).
