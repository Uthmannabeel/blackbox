# BlackBox — Devpost submission

> Draft submission copy for the CockroachDB × AWS "Build with Agentic Memory"
> Hackathon. Paste into the Devpost fields; tighten to taste.

---

## Tagline
We kill the agent's primary database region on camera and it loses **zero of
3,657 memories** — recall keeps answering, including rows homed in the region
that just died. Survivable, hygienic agentic memory, demonstrated by an
incident agent that keeps remembering through the crash it's diagnosing.

## The numbers, and exactly where each one comes from
Every figure below is reproducible on the live demo or by running the repo. We
publish the measurement conditions because a number without them is a claim.

| Figure | Value | Measured where |
| --- | --- | --- |
| Memories on record | **3,657** | Live cluster, `/api/stats`. Incidents + runbooks + semantic memory + conversational stream |
| CockroachDB vector search, top-5 consolidated | **~0.9 s** steady state | Live 3-region CockroachDB Cloud Standard cluster, `searchMs` on `/api/stats` |
| Same search, first query on a cold serverless instance | **~5 s** | Query planning + C-SPANN metadata loading. Real, and stated rather than hidden — `/api/stats` warms the path before timing so the published figure is steady state |
| Bedrock Titan embedding | **~150 ms** | Same request, reported separately as `embedMs` so the database is judged on its own work |
| End-to-end recall | **~1.05 s** steady state | `recallMs` = `embedMs + searchMs` |
| Region-kill drill | **primary region killed, top-5 recall identical, 136 ms** | 9-node **local** `cockroach demo` rig, where individual nodes can be killed. Managed Cloud does not expose per-node kill |

The drill number is from the local rig and is labelled that way everywhere it
appears, including on the site. The survivability *claim* is what carries the
submission; the millisecond figure is a footnote to it.

## How this maps to the judging criteria
A skim, one line each — the rest of this page is the evidence.
- **Agentic memory design** — CockroachDB is the agent's durable, multi-region
  memory of record across five surfaces, each modelled for its own access
  pattern: episodic incidents and procedural runbooks (vector-indexed),
  semantic memory (vector-indexed), the conversational stream (append-only, no
  vector), and transactional live incident state. Learned knowledge passes a
  **hygienic write path** — gated, consolidated, contradiction-checked,
  confidence-scored, reinforced, quarantined when untrusted, and decayed
  nightly. Episodic recall **consolidates recurring failure signatures** rather
  than returning the same memory five times, and reports recurrence as evidence
  ("seen 72×"). Grounded in 25 real public postmortems with provenance links.
- **Technical implementation** — a typed reason/recall/act loop over Bedrock;
  distributed vector index + Managed MCP Server; parameterised SQL; the
  learning loop runs as **one serializable transaction** across four tables in
  three regions; 58 unit tests plus 9 integration tests that execute against a
  real cluster.
- **Real-world impact** — answers the on-call's first question, "have we seen
  this before?", in about a second — and keeps answering through a region
  outage. Recurrence counts turn a repetitive corpus into a signal an on-call
  actually wants. Every resolution compounds into a runbook the next incident
  recalls.
- **Creativity & originality** — memory infrastructure that survives the
  failure it is recording, audits its own writes, and can diagnose its own
  cluster mid-outage. The agent is the demo; the memory is the product.
- **Production readiness** — a **trust boundary that fails closed**: the public
  console is unauthenticated, so anything it teaches the agent is quarantined —
  stored and auditable, never recalled by anyone else until an operator
  promotes it. Plus durable rate limiting, least-privilege keys, scheduled
  memory decay, bounded inputs from model output, and latency instrumentation
  that reports the database and the model separately instead of blaming one for
  the other. We red-teamed our own build and fixed what we found (below).

## Inspiration
Every AI agent demo has "memory" — until the database it depends on has a bad
day. We asked a harder question: what does *production-grade* agent memory
look like? It has to be **available during a failure, consistent across
regions, compliant with where data may live — and trustworthy about what it
lets itself remember.** The first three are exactly, and almost uniquely, what
CockroachDB is built for; the fourth is a write-path discipline most agent
memories skip entirely. So we built BlackBox: survivable, self-auditing
agentic memory — like an aircraft's flight recorder for your infrastructure —
and we prove it with the hardest client a memory can have: an incident-response
agent working the very outage that just took down one of its own regions.

## What it does
BlackBox's memory layer serves an incident agent that triages, diagnoses, and
helps mitigate production incidents:
- **Recalls institutional memory at scale, consolidated** — "have we seen this
  before?" — semantic search over a 3,500+ incident corpus via CockroachDB's
  distributed vector index (**~0.9 s** top-5 on the live 3-region managed
  cluster; 136 ms on the local rig). Crucially it returns five *distinct*
  lessons, not the five nearest rows: a real fleet fails the same way over and
  over, so the raw neighbours of "connection pool exhaustion" were five copies
  of one incident differing only in a p99 number. Recall now clusters repeats
  and reports the count — "seen 72×" — which is the thing an on-call actually
  wants to know.
  The episodic store isn't purely synthetic: it includes **25 real public
  postmortems** (GitLab 2017, AWS S3 2017, Cloudflare's regex outage, GitHub's
  2018 split-brain, Meta's BGP withdrawal, Roblox's 73-hour Consul outage,
  Knight Capital…), each provenance-linked — when one is recalled, the evidence
  ledger links straight to the first-party incident report.
- **Learns, with hygiene** — every resolution is distilled toward procedural
  memory, but must pass a write gate first: content filtering (no questions,
  no uncertainty, no failure narrations), consolidation into existing
  knowledge instead of duplication, contradiction detection (disagreeing fixes
  enter on probation at lower confidence), reinforcement when a recalled
  runbook feeds a real resolution, and decay/archival for knowledge that never
  earns trust (a nightly scheduled pass, not a script somebody has to remember
  to run). Every decision is logged to an auditable hygiene ledger you can
  watch live in the console. Memory that compounds — and self-corrects.
- **Refuses to learn from strangers.** The public console has no login, and a
  learning loop plus an open write path is how a shared memory gets poisoned.
  Trust is decided at the HTTP boundary and **fails closed**: an unauthenticated
  session can use the agent in full, but anything it teaches is **quarantined** —
  written, auditable, visible in the hygiene panel, and never recalled by
  anyone until an operator promotes it. The console tells you which kind of
  session you are in. The whole learning loop — resolve, distil, reinforce,
  reflect — commits as **one serializable transaction**, so a lesson is never
  half-written.
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
**CockroachDB (4 of 4 recognized tools; 2 required):**
- Distributed Vector Indexing (regional-by-row semantic memory)
- Cloud Managed MCP Server (agent introspects the cluster)
- Agent Skills Repo — the agent's `diagnose_memory` tool executes the official
  `reviewing-cluster-health` skill (v2.0, Standard-tier procedure) against its
  own memory cluster and cites it in the diagnosis; the skill is vendored with
  provenance in `skills/cockroachdb/` (Apache-2.0)
- ccloud CLI — used to provision and inspect the multi-region cluster
  (`infra/ccloud/cluster-info.ps1`); verified live against cluster `blackbox`
  (id `5675ebfa-276c-40cb-87a2-2c334935aeb1`, v26.2.1, regions ap-south-1 /
  eu-west-1 / us-east-1)

**AWS (1 required; Bedrock is the primary service):**
- Amazon Bedrock (Claude reasoning + Titan embeddings)
- AWS Lambda (deployable handler included; live demo on Vercel serverless)
- (S3/other AWS services: not used in the current build)

## Real-world impact
Downtime is expensive: over 90% of mid-size and large enterprises put the cost
of a single hour of downtime above $300,000 ([ITIC 2024 Hourly Cost of Downtime
Survey](https://itic-corp.com/itic-2024-hourly-cost-of-downtime-report/)).
Every minute spent re-deriving context is paid at that rate. An on-call
engineer's first question at 3am is always the same: *"have we seen
this before?"* Today answering it means grepping logs, scrolling Slack, and
paging whoever remembers last quarter's outage. BlackBox answers it in
milliseconds against the entire incident history — and because that memory is
durable and multi-region, the answer survives the very outage you're fighting.
The expensive part of incident response is re-deriving context under pressure;
BlackBox keeps the context and keeps it *available when a region is down*. And
because every resolution is distilled back into a recalled runbook, the second
time an incident happens the fix is already on hand — institutional knowledge no
single engineer has to carry.

## Why CockroachDB specifically — and why not the obvious alternatives
This is the question every judge asks, so here it is plainly. The survivability
demo — kill the region, memory keeps answering — is not a party trick; it's the
property the whole product depends on, and it eliminates each usual choice:
- **pgvector / single-region Postgres** — loses the agent's entire memory the
  moment its region goes down, which is exactly when an incident agent is needed.
- **DynamoDB global tables** — cross-region replication is eventually consistent,
  so live incident state and recalled memory can disagree mid-crisis.
- **Redis / in-memory vector stores** — fast, but not a durable system of record;
  a failover or restart is amnesia.
- **A dedicated vector DB bolted to a separate state store** — two systems to
  keep in sync, and split-brain during the one outage you can least afford it.

CockroachDB replaces all of that with one strongly-consistent, multi-region
system of record:
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

### The second review — what it found, and what we did
We ran the review again, harder, against the *live* cluster rather than the
code, and it found five things worth failing us for. All five are fixed; we
list them because a submission that only reports its wins is not a production
readiness story.

- **A recall tool that could never return anything.** Conversational rows and
  semantic memories shared one table. The conversational rows had no useful
  embedding, so they were stored with a placeholder zero vector to satisfy the
  vector index, then excluded from recall by a `kind NOT IN (...)` predicate the
  index cannot serve. On the live corpus that predicate excluded **100 of 100
  rows** — `recall_memories` was structurally incapable of returning a result.
  Fixed by modelling the two access patterns as two tables, so an unembedded row
  can no longer reach the semantic store at all.
- **Recall that returned one memory five times.** 3,526 incidents span 661
  distinct titles. Fixed with consolidation plus a recurrence count, sized from
  measurement (over-fetch 40 → 1 distinct episode; 150 → 5; 300+ buys nothing).
- **A learning loop with no transaction**, on a hackathon about a database that
  sells serializable transactions. Production had 3 hygiene events and 1 learned
  runbook with **zero** matching reflections — the last write had silently never
  landed. Now one transaction across four tables in three regions.
- **An open write path into shared memory.** Fixed with a fail-closed trust
  boundary and quarantine (above).
- **A latency number that measured the wrong thing.** `/api/stats` constructed
  the service and *then* started the stopwatch, so a cold instance billed TLS
  handshake and pool setup to "recall". Now the pool is warmed before timing,
  the beam size ships in the connection startup packet instead of costing a
  `BEGIN`/`SET LOCAL`/`COMMIT` per query, and embedding and search are reported
  separately.
- **A test suite that tested the mock.** Not one test imported the real
  `MemoryService`, so every SQL statement in the file that *is* the submission
  was uncovered. Added 9 integration tests that run against a real cluster
  (opt-in, self-cleaning) — all green.

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
