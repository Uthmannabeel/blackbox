<div align="center">

# BlackBox

**Survivable, hygienic agentic memory — proven under fire.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Live demo](https://img.shields.io/badge/demo-live-6c7cfa)](https://blackbox-web-eight.vercel.app)
[![Demo video](https://img.shields.io/badge/video-3%20min-red)](https://youtu.be/4KUu47gdhL0)
[![Live demo health](https://github.com/Uthmannabeel/blackbox/actions/workflows/health.yml/badge.svg)](https://github.com/Uthmannabeel/blackbox/actions/workflows/health.yml)

**[Live demo](https://blackbox-web-eight.vercel.app)** · **[Interactive console](https://blackbox-web-eight.vercel.app/console)** · **[3-minute video](https://youtu.be/4KUu47gdhL0)** · **[Red-team challenge](https://blackbox-web-eight.vercel.app/poison)**

<img src="docs/screenshots/home-hero.png" alt="BlackBox — agent memory that survives the outage" width="900">

</div>

---

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

## Contents

- [Proof, not claims](#proof-not-claims)
- [The public red-team challenge](#the-public-red-team-challenge)
- [The console](#the-console)
- [Why CockroachDB](#why-cockroachdb-not-pgvector-dynamodb-or-redis)
- [Memory model](#memory-model)
- [Architecture](#architecture)
- [Measured numbers, with conditions](#measured-numbers-with-conditions)
- [Getting started](#getting-started)
- [Tests](#tests)
- [Production hardening](#production-hardening)
- [Hackathon tooling](#hackathon-tooling)
- [License](#license)

## Proof, not claims

In the demo we kill every node in the database's **primary region on camera**
with 3,500+ memories loaded — **zero memories lost**, recall still answering
(including rows homed in the dead region), and writes to the dead region still
committing.

<div align="center">
<img src="docs/screenshots/survivability.png" alt="Survivability — we killed the primary region" width="900">
</div>

The proof also runs unattended: a **daily automated drill** re-runs the memory
distribution query with one region's rows excluded — answered entirely by the
surviving regions, inside a single transaction so "0 lost" is snapshot-exact.
Every result is recorded and the running tally is public on the
[home page](https://blackbox-web-eight.vercel.app) and at
[`/api/drills`](https://blackbox-web-eight.vercel.app/api/drills):

> *automated daily drills · production cluster — N survived · 0 memories lost*

## The public red-team challenge

A memory that lets anyone teach it is a memory you cannot trust — so the write
path is public. [**/poison**](https://blackbox-web-eight.vercel.app/poison)
invites anyone to teach the agent something false or malicious. Every attempt
runs the *real* untrusted learning path (the same `commitLearnedRunbook` call
the anonymous console makes), and the response includes a live recall query
for the attacker's own words — showing their write absent from it. Attempts
and breaches (kept at zero) are public counters; every verdict lands on a
public wall.

<div align="center">
<img src="docs/screenshots/red-team.png" alt="Poison me — the public red-team challenge" width="900">
</div>

Four ways to lose: the **content gate** (not every string is knowledge),
**consolidation** (duplicates merge instead of multiplying, and untrusted
writes cannot reinforce trusted runbooks), **contradiction detection** (same
situation + materially different fix = probation, not truth), and the
**trust boundary** (anonymous writes are quarantined — stored, auditable,
never recalled).

## The console

The interactive agent at
[`/console`](https://blackbox-web-eight.vercel.app/console) runs real Claude on
Bedrock over the live multi-region cluster. Recall returns **distinct
episodes** with recurrence counts ("seen 72×") and an evidence ledger — every
answer cites the memories behind it, including **25 real public postmortems**
(GitLab 2017, AWS S3 2017, Cloudflare's regex outage, and more) with
first-party source links.

<div align="center">
<img src="docs/screenshots/console.png" alt="The BlackBox incident console" width="900">
</div>

Beyond recall:

- **Learning loop** — when the agent resolves an incident, the resolution is
  distilled into a new *learned runbook* (procedural memory). The next similar
  incident recalls the fix the agent just learned. Resolve + distil + reinforce
  + reflect commit as **one serializable transaction** across four tables in
  three regions.
- **Self-diagnosis** — the agent's memory *is* a CockroachDB cluster, and its
  `diagnose_memory` tool observes per-region node liveness and the survival
  goal, so mid-outage it can explain: "one region is down; all my memories
  remain readable and writable."
- **Time-travel** — `AS OF SYSTEM TIME` rewinds the memory to a consistent
  historical snapshot: no backups, no separate store.

## Why CockroachDB (not pgvector, DynamoDB, or Redis)

Most agent-memory demos use a database you could swap for anything. BlackBox is
designed around the things **only CockroachDB** does well — and the
survivability demo eliminates each usual choice:

- **pgvector / single-region Postgres** loses the agent's entire memory the
  moment its region goes down — exactly when an incident agent is needed most.
- **DynamoDB global tables** are eventually consistent, so live incident state
  and recalled memory can disagree mid-crisis.
- **Redis / in-memory vector stores** are fast but not a durable system of
  record; a failover or restart is amnesia.
- **A dedicated vector DB bolted to a separate state store** is two systems to
  keep in sync, and split-brain during the one outage you can least afford it.

| Capability | How BlackBox uses it | Why it matters |
|---|---|---|
| **`REGIONAL BY ROW`** | Every memory (incident, runbook, thought) is pinned to its home region via `crdb_region`. | Low-latency local recall + **data residency by row** — an EU incident's memory never leaves the EU. |
| **`SURVIVE REGION FAILURE`** | The memory database tolerates the loss of an entire region with no data loss. | The agent's memory outlives the outage it is diagnosing. This is the live demo money-shot. |
| **Distributed Vector Indexing (C-SPANN)** | `VECTOR(1024)` columns with region-prefixed vector indexes for semantic recall. | "Have we seen this incident before?" over millions of vectors, co-located per region. |
| **Strong consistency** | Live `incident_state` (phase, hypotheses, actions) is transactional. | The agent never acts on stale or split-brain state during a crisis. |

One system is both the **system of record** and the **agent memory layer** — no
stitching a vector DB to a state store to a cache.

## Memory model

BlackBox implements the classic memory types an agent needs, each backed by a
CockroachDB table (see [`db/schema.sql`](./db/schema.sql)):

- **Episodic** — `incidents`: what happened, when, how it was resolved.
  Episodic recall **consolidates**: a fleet repeats its failure modes, so the
  five nearest *rows* are often five copies of one memory. Recall clusters the
  repeats, returns five distinct lessons, and reports recurrence ("seen 72×") —
  which is the more useful signal anyway.
- **Procedural** — `runbooks`: how to fix classes of problem, with hygiene
  state (`source`, `status`, `origin`, `confidence`).
- **Semantic** — `agent_memory`: the agent's reflections and insights. Every
  row carries a real embedding and is recallable by similarity.
- **Conversational stream** — `agent_stream`: operator turns, agent replies,
  tool observations. High volume, read by recency, **no vector column**.
  Splitting this out of `agent_memory` matters: keeping them together forced
  unembedded rows to carry a placeholder zero vector that polluted the vector
  index and had to be filtered by a predicate the index could not serve.
- **Structured live state** — `incident_state`: the transactional source of
  truth for an in-flight incident.

Every table is `REGIONAL BY ROW`; the two vector-bearing tables carry a
region-prefixed vector index.

### The write path is guarded

The public console has no login, and "an agent that learns" plus "anyone can
write" is how a shared memory gets poisoned. Trust is decided at the HTTP
boundary and **fails closed**: without `BLACKBOX_OPERATOR_TOKEN` every session
is anonymous, and anything the agent learns is **quarantined** — stored,
auditable, listed in the console, and never recalled until an operator
promotes it.

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

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for detail, or the live
[architecture page](https://blackbox-web-eight.vercel.app/architecture).

## Measured numbers, with conditions

Every number is stated with where it was measured — a figure without its
conditions is a marketing claim, not a measurement.

| Figure | Value | Conditions |
|---|---|---|
| Memories on record | 3,500+ | Live 3-region CockroachDB Cloud Standard cluster |
| Vector search, consolidated top-5 | **~0.9 s** steady state | Live cluster, `searchMs` on [`/api/stats`](https://blackbox-web-eight.vercel.app/api/stats); ~5 s first query on a cold serverless instance |
| Bedrock embedding | ~150 ms | Timed and reported separately from the search leg |
| Region-kill drill, top-5 recall identical | **136 ms** | 9-node **local** `cockroach demo` rig, where individual nodes can be killed — managed Cloud does not expose per-node kill. Labelled as such everywhere it appears. |

## Getting started

### Try it offline in 30 seconds (no cloud, no keys)

```bash
npm install
npm run dev:mock              # open http://localhost:3000
```

Mock mode swaps in deterministic embeddings, an in-memory store seeded with
sample incidents, and a scripted agent — the full UI (recall, incident
timeline, chaos/survivability panel) runs with zero credentials.

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
To run the **local 9-node chaos rig** (real node-kills on your machine), see
[`infra/chaos/README.md`](./infra/chaos/README.md).

## Tests

```bash
npm test          # 58 unit tests, offline -- no cloud, no keys

# 9 integration tests against a REAL CockroachDB cluster. Opt-in, because they
# write to whatever DATABASE_URL points at. Every row is tagged per run and
# deleted in afterAll, so they leave no residue.
BLACKBOX_INTEGRATION_DB=1 DATABASE_URL=postgresql://... npm test
```

Unit tests cover embedding determinism and similarity ordering, the hygiene
policy (content gate, consolidation, contradiction), episode consolidation,
the trust boundary and quarantine/promotion, learning-loop atomicity, the
agent's reason/recall/act loop, and API rate limiting. The integration tests
run the real `MemoryService`: table routing, vector operators, consolidated
recall, the transactional learning loop, quarantine, input bounding, and
`REGIONAL BY ROW` pinning. `scripts/preflight.mjs` runs 25 checks against the
live deployment, and a scheduled
[health probe](.github/workflows/health.yml) watches the live demo.

## Production hardening

The full verified-vs-open ledger lives in [`HARDENING.md`](./HARDENING.md).
Highlights:

- **Fail-closed trust boundary** — unauthenticated sessions cannot write into
  shared recall; promotion is the one privileged, state-changing route.
- **Atomic learning loop** — resolve, distil, reinforce and reflect commit in
  one serializable transaction; no half-written lessons.
- **Scheduled memory decay** (nightly cron) so knowledge that never earns
  trust actually ages out — plus the daily survivability drill.
- **Durable, cross-instance rate limiting** backed by CockroachDB itself, on
  every public model-touching endpoint.
- **Least-privilege credentials** — the production AWS principal holds an
  invoke-only, model-scoped Bedrock policy and nothing else; MCP introspection
  is read-only and statement-validated (rejects multi-statement SQL and DML
  smuggled through a CTE).
- **Honest latency instrumentation** — `/api/stats` warms the pool before
  timing and reports the embedding and search legs separately.
- Bounded model-generated inputs, parameterized SQL throughout, TLS
  `verify-full`, CSP + HSTS/XFO/XCTO headers, errors never leaked to clients.

## Hackathon tooling

Built for the **CockroachDB × AWS "Build with Agentic Memory" Hackathon**.

**CockroachDB (4 of the 4 enumerated tools; 2 required):**

- **Distributed Vector Indexing** — semantic memory over incidents, runbooks,
  and the agent's thought stream ([`db/schema.sql`](./db/schema.sql)).
- **Cloud Managed MCP Server** — the agent introspects the live cluster it
  operates (schema, health, running queries) as a tool during reasoning.
- **Agent Skills Repo** — `diagnose_memory` executes the official
  `reviewing-cluster-health` skill from
  [cockroachlabs/cockroachdb-skills](https://github.com/cockroachlabs/cockroachdb-skills)
  against its own memory cluster, citing the skill in its diagnosis (vendored
  with provenance in `skills/cockroachdb/`).
- **`ccloud` CLI** — used to inspect the live multi-region cluster
  (`infra/ccloud/cluster-info.ps1`); verified against the project's 3-region
  cluster (CockroachDB v26.2, regions ap-south-1 / eu-west-1 / us-east-1).

**AWS (1 required):**

- **Amazon Bedrock** — Claude for reasoning + Titan Text Embeddings v2
  (1024-dim) for memory embeddings.
- **AWS Lambda** — a deployable Lambda handler is included
  (`packages/agent/src/lambda.ts`); the live demo is served by Vercel
  serverless functions.

Product feedback from building this is in [`FEEDBACK.md`](./FEEDBACK.md).

## Repository layout

```
cockroach-ai/
  db/                 CockroachDB schema + seed (the memory layer's heart)
  packages/
    memory/           TypeScript memory service over pg + Bedrock embeddings
    agent/            Agentic reason/recall/act loop on Bedrock
  web/                Next.js demo dashboard (incident chat + chaos button)
  infra/              ccloud + AWS provisioning + local 9-node chaos rig
  docs/               Screenshots and supporting documentation
```

## License

[MIT](./LICENSE) © 2026 Nabeel Uthman
