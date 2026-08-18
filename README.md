# BlackBox

**Survivable, hygienic agentic memory — proven under fire.**

**▶ Demo video (3 min):** https://youtu.be/4KUu47gdhL0 · **Live demo:** https://blackbox-web-eight.vercel.app

BlackBox is agentic-memory infrastructure: a memory layer for AI agents that is
**globally available, strongly consistent, region-pinned, and self-auditing** on
top of CockroachDB. Like an aircraft's flight recorder, it is built to survive
the very failures it records. We demonstrate it with the hardest client an
agent memory can have — an incident-response agent that must keep remembering,
learning, and reasoning while a cloud region burns underneath it.

Three properties most agent memories lack, working together:

- **Survivability** — kill an entire region and every memory stays readable and
  writable, strongly consistent, with recall served from surviving replicas.
- **Hygiene** — a gated write path: learned knowledge is content-filtered,
  consolidated into existing runbooks, contradiction-checked, confidence-scored,
  reinforced when it proves out, and decayed when it never earns trust. An
  append-only store is a log; this is a memory.
- **A trust boundary that fails closed** — the console is public and has no
  login, so what an anonymous session teaches the agent is quarantined: stored
  and auditable, never recalled until an operator promotes it.

We prove it, not claim it: in our demo we kill every node in the database's
**primary region on camera** with 3,500+ memories loaded -- **zero memories
lost**, recall still answering (including rows homed in the dead region), and
writes to the dead region still committing.

Measured, with conditions stated: **3,657 memories** on the live cluster;
CockroachDB vector search **~0.9 s** for a consolidated top-5 across three
regions (Bedrock's embedding call is timed separately at ~150 ms and reported
separately). The **136 ms** figure quoted for the region-kill drill is from the
9-node **local** `cockroach demo` rig, where individual nodes can be killed —
managed Cloud does not expose per-node kill. It is labelled that way everywhere
it appears.

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

**CockroachDB (using 4 of the 4 enumerated tools; 2 required):**
- **Distributed Vector Indexing** -- semantic memory over incidents, runbooks, and the agent's thought stream (`db/schema.sql`).
- **Cloud Managed MCP Server** -- the agent introspects the live cluster it operates (schema, health, running queries) as a tool during reasoning.
- **Agent Skills Repo** -- `diagnose_memory` executes the official `reviewing-cluster-health` skill (Standard-tier checks) from [cockroachlabs/cockroachdb-skills](https://github.com/cockroachlabs/cockroachdb-skills) against its own memory cluster, citing the skill in its diagnosis (vendored with provenance in `skills/cockroachdb/`).
- **`ccloud` CLI** -- used to inspect the live multi-region cluster (`infra/ccloud/cluster-info.ps1`); verified against the project's 3-region cluster (CockroachDB v26.2, regions ap-south-1 / eu-west-1 / us-east-1).

**AWS (using 1; 1 required):**
- **Amazon Bedrock** -- Claude for reasoning + Titan Text Embeddings v2 (1024-dim) for memory embeddings.
- **AWS Lambda** -- a deployable Lambda handler is included (`packages/agent/src/lambda.ts`); the live demo is served by Vercel serverless functions.

---

## Memory model

BlackBox implements the three classic memory types an agent needs, each backed by
a CockroachDB table (see `db/schema.sql`):

- **Episodic** -- `incidents`: what happened, when, how it was resolved. Includes
  **25 real public postmortems** (GitLab 2017, AWS S3 2017, Cloudflare's regex
  outage, GitHub's 2018 split-brain, Meta's BGP withdrawal, Roblox's 73-hour
  Consul outage, Knight Capital, and more), ingested with first-party source
  links (`npm run db:ingest-postmortems`); when one is recalled, the console's
  evidence ledger links to the original incident report.
  Episodic recall **consolidates**: a fleet repeats its failure modes, so the
  five nearest *rows* are often five copies of one memory. Recall clusters the
  repeats, returns five distinct lessons, and reports recurrence ("seen 72x") —
  which is the more useful signal anyway.
- **Semantic / procedural** -- `runbooks`: how to fix classes of problem, with
  hygiene state (`source`, `status`, `origin`, `confidence`).
- **Semantic memory** -- `agent_memory`: the agent's reflections and insights.
  Every row here carries a real embedding and is recallable by similarity.
- **Conversational stream** -- `agent_stream`: operator turns, agent replies,
  tool observations and actions. High volume, read by recency, **no vector
  column**. Splitting this out of `agent_memory` matters: the two have different
  access patterns, and keeping them together forced unembedded rows to carry a
  placeholder zero vector that polluted the vector index and had to be filtered
  out by a predicate the index could not serve.
- **Structured live state** -- `incident_state`: the transactional source of truth
  for an in-flight incident.

Every table is `REGIONAL BY ROW`; the two vector-bearing tables carry a
region-prefixed vector index.

### The write path is guarded

The public console has no login, and "an agent that learns" plus "anyone can
write" is how a shared memory gets poisoned. Trust is decided at the HTTP
boundary and **fails closed**: without `BLACKBOX_OPERATOR_TOKEN` every session
is anonymous, and anything the agent learns is **quarantined** — stored,
auditable, listed in the console, and never recalled until an operator promotes
it. Resolving an incident (resolve + distil + reinforce + reflect) commits as a
single serializable transaction across four tables in three regions.

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
npm run db:ingest-postmortems # load 25 real public postmortems (provenance-linked)
npm run agent:dev             # talk to the agent from the CLI
npm run dev                   # or use the web dashboard at http://localhost:3000
```

See [`infra/README.md`](./infra/README.md) for provisioning the multi-region
cluster, enabling the Managed MCP Server, and requesting Bedrock model access.

## Tests

```bash
npm test          # 58 unit tests, offline -- no cloud, no keys

# 9 integration tests against a REAL CockroachDB cluster. Opt-in, because they
# write to whatever DATABASE_URL points at. Every row is tagged per run and
# deleted in afterAll, so they leave no residue.
BLACKBOX_INTEGRATION_DB=1 DATABASE_URL=postgresql://... npm test
```

Unit tests cover embedding determinism and similarity ordering, the hygiene
policy (content gate, consolidation, contradiction), episode consolidation, the
trust boundary and quarantine/promotion, learning-loop atomicity, the agent's
reason/recall/act loop, and API rate limiting.

The integration tests exist because the unit suite exercises
`MockMemoryService` — it shares the pure policy code but none of the SQL. These
run the real `MemoryService`: table routing, the vector operators, consolidated
recall, the transactional learning loop, quarantine, input bounding, and
`REGIONAL BY ROW` pinning of `incident_state`.

## Production hardening

- **Fail-closed trust boundary**: unauthenticated sessions cannot write into
  shared recall; what they teach is quarantined until an operator promotes it.
  Promotion is the one privileged, state-changing route.
- **Atomic learning loop**: resolve, distil, reinforce and reflect commit in one
  serializable transaction — no half-written lessons.
- **Scheduled memory decay** (nightly Vercel cron, guarded by `CRON_SECRET`), so
  knowledge that never earns trust actually ages out.
- **Bounded inputs from model output**: service names from the LLM are
  normalised, character-restricted and length-capped before they can create rows.
- **Honest latency instrumentation**: `/api/stats` warms the pool before timing
  and reports the Bedrock embedding and the CockroachDB vector search
  separately, so neither is blamed for the other's work.
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
