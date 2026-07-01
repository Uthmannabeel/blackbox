# `db/` — the memory layer's schema

`schema.sql` is the heart of BlackBox. Every table is `LOCALITY REGIONAL BY ROW`
so each memory is pinned to its home region, and the memory database is
configured to `SURVIVE REGION FAILURE`.

| Table | Memory type | Vector index |
|---|---|---|
| `incidents` | Episodic — what happened + how it was fixed | ✅ `(crdb_region, embedding)` |
| `runbooks` | Procedural — how to fix classes of problem | ✅ `(crdb_region, embedding)` |
| `agent_memory` | Working + long-term thought stream | ✅ `(crdb_region, embedding)` |
| `incident_state` | Structured, transactional live state | — |
| `services` | The fleet under management | — |

## Key design choices

- **`crdb_region` default** — columns default to
  `gateway_region()`, so writes land in the region that served them without the
  application choosing a region. This gives data residency by row for free.
- **Region-prefixed vector index** — `VECTOR INDEX (crdb_region, embedding)`
  builds a separate C-SPANN tree per region, co-located with the data, so recall
  is local and survivable.
- **1024 dimensions** — matches Bedrock Titan Text Embeddings v2.
- **L2 distance (`<->`)** — embeddings are unit-normalized, so L2 ranking is
  equivalent to cosine similarity and matches the index's default metric.

Apply with `npm run db:schema`; load sample data with `npm run db:seed`.
