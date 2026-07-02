# Product feedback — CockroachDB agentic tooling

Real findings from building BlackBox, all hit on **v25.4.0** while building an
agent-memory workload (regional-by-row tables + distributed vector indexes).
Each is reproducible; happy to file issues with full repros.

## 1. Bug: post-hoc `CREATE INDEX` fails on REGIONAL BY ROW tables with a vector index

On a `REGIONAL BY ROW` table that has an inline `VECTOR INDEX`, a subsequent
plain `CREATE INDEX` fails:

- `CREATE INDEX ON incidents (status)` → **internal error XX000**:
  `table has PARTITION ALL BY defined, but index t1 does not have matching PARTITION BY`
  (declarative schema changer, PostCommitNonRevertiblePhase)
- `CREATE INDEX ON incidents (service_id)` → `ERROR: decoding: invalid uuid length of 2`

**Workaround:** define all secondary indexes inline in `CREATE TABLE`; they
receive implicit region partitioning correctly. Cost: schema evolution on live
agent-memory tables is blocked, which matters for agents whose schemas grow.

## 2. Limitation: `\demo shutdown` unsupported with `--global`

`cockroach demo --global` is the natural way to demo multi-region behavior with
realistic latency, but node kills are rejected:
`shutting down nodes is not supported in --global configurations`.

The two flags most useful for a survivability demo are mutually exclusive. We
switched to explicit `--demo-locality` (works, but loses latency simulation).
Supporting shutdown under `--global` would make CockroachDB the best
survivability-demo kit in the industry.

## 3. Gotcha: single-gateway writes pin every row to one region

With `crdb_region ... DEFAULT gateway_region()` (the documented pattern), any
centralized writer — a seeder, a queue consumer, an agent backend running in
one region — homes **every** row in its own region. Multi-region row
distribution silently doesn't happen.

For agent-memory workloads (typically one backend writing on behalf of global
users), a first-class way to set row homes from data (e.g.
`REGIONAL BY ROW AS <expr over user attributes>` recipes in the AI docs) would
prevent a class of quiet misconfigurations. We now pass `crdb_region`
explicitly per row.

## 4. Papercut: no bind parameters for session settings

`SET vector_search_beam_size = $1` isn't possible, so tuning the beam per query
means string interpolation (we clamp to a safe integer, then `SET LOCAL` inside
a transaction to avoid leaking the setting onto pooled connections). A
parameterizable or per-statement hint (e.g. index hint syntax) would be safer.

## 5. Praise, earned

- **The vector-index query plan is a gift.** `EXPLAIN` showing
  `vector search … prefix spans: ['europe-west1'…] ['us-east1'…] ['us-west1'…]`
  is the single clearest artifact we have for explaining distributed ANN.
- **Survivability works exactly as advertised.** We killed all three nodes of
  the database's primary region: reads of rows homed in the dead region kept
  answering (136ms top-5 over 10k vectors), and writes homed in the dead
  region kept committing. Zero configuration beyond `SURVIVE REGION FAILURE`.
- `cockroach demo` + `--demo-locality` is an outstanding local test rig for
  multi-region agent memory once you know the flags.
