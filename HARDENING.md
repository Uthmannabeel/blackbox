# Production-hardening ledger

A living record of what has been verified versus what remains open, in the
spirit of the hostile-review section of the submission: a system that only
reports its wins is not a production-readiness story. Dates are when the item
was last verified against the **live** deployment.

## Verified

- **Rate limiting** (2026-08-18) — the public chat endpoint enforces a
  per-client 20/min + daily cap, stored durably in CockroachDB (one atomic
  UPSERT; correct across serverless instances), with an in-memory fallback if
  the limiter table is unreachable. Protects the Bedrock budget on a public
  console.
- **Memory decay cron** (2026-08-18) — `/api/cron/decay` manually invoked
  against production with the cron secret: HTTP 200, real mode, pipeline live.
  Scheduled nightly via Vercel cron.
- **Managed MCP Server in production** (2026-08-18) — the agent's
  cluster-introspection path (`diagnose_memory`) now runs through the
  CockroachDB Cloud Managed MCP Server in the deployed app, not only in
  development. Verified by direct MCP probe (12 tools reachable) plus the full
  preflight against the live site.
- **Operator-token rotation** (2026-08-18) — token rotated end-to-end; the
  retired token verifiably rejected (401) and the active token accepted by the
  live promote endpoint. Rotation is a two-minute env-swap + redeploy.
- **AWS credential scope** (2026-08-18) — the production AWS principal was
  probed and is denied on IAM, S3, and Lambda. Its former
  `AmazonBedrockFullAccess` (`bedrock:*` on `*`) has been replaced with the
  explicit invoke-only, model-scoped policy from
  `infra/iam-bedrock-policy.json`; Bedrock invocation and the full preflight
  re-verified green after the swap.
- **Trust boundary** (2026-08-18) — unauthenticated promote rejected (401);
  anonymous sessions report `trusted=false`; quarantine list auditable.
- **Full preflight** (2026-08-18) — all 25 checks green against production
  after the changes above (latency split, distinct-episode ledger, recurrence,
  provenance citations, region survival goal, time-travel).
- **External uptime monitoring** (2026-08-18) — an independent daily probe
  checks the live site's memory count, region health, and page availability
  through the judging window and raises an alert on any degradation.

## Open — known and accepted, with intended fixes

- **Cold-start latency** — first query on a cold serverless instance pays ~5s
  (planning + vector-index metadata); steady state is ~0.9s. Mitigation
  candidates: scheduled warming of the search path; connection-pool pinning.
- **Scale validation** — corpus is ~3.5k memories; consolidation over-fetch
  (30×limit, cap 300) was tuned empirically at that scale. A 10⁶-memory
  benchmark is future work.
- **Single shared operator token** — the trust boundary is binary. Real
  deployments need per-operator identity (SSO/RBAC) and per-promotion audit
  attribution.
- **Heuristic hygiene** — dedup, contradiction checks, and content filtering
  are deterministic rules plus embedding distance; semantically subtle
  contradictions can pass. Decay is nightly, not usage-aware. Mitigation now
  standing: the public **red-team challenge** (`/poison`) runs every visitor
  attempt through the real untrusted write path and publishes each verdict and
  a live recall-proof — attempts and breaches (kept at zero) are public
  counters, so this limitation is continuously exercised rather than assumed.
- **Embedding model lock-in** — Titan v2 1024-dim is structural
  (`VECTOR(1024)`); a model change requires a full re-embed. An
  embedding-version column is the planned escape hatch.
- **Residency follows the gateway** — REGIONAL BY ROW homes rows where the
  serving function connects from; true user-origin residency needs
  region-pinned ingress.
- **Frontend is single-region** — the database survives a region failure; the
  web tier in front of it does not. A multi-region frontend (or static
  fallback status page) would close the asymmetry.
