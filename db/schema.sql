-- ============================================================================
-- BlackBox — Agentic Memory Schema for CockroachDB
-- ----------------------------------------------------------------------------
-- This schema is the heart of the project. It demonstrates why CockroachDB is
-- the right memory layer for a production agent (not "just a vector store"):
--
--   1. REGIONAL BY ROW  -> each memory physically lives in its home region,
--      giving low-latency local reads AND legal data-residency by row.
--   2. SURVIVE REGION FAILURE -> the agent's memory stays available and
--      strongly consistent even when an entire cloud region goes dark.
--      (This is the "flight recorder that survives the crash" demo moment.)
--   3. Distributed Vector Indexing (C-SPANN) -> semantic recall over incidents
--      and runbooks, with the vector index co-located per region via a
--      crdb_region prefix column.
--
-- Embedding dimension = 1024 to match Amazon Bedrock Titan Text Embeddings v2.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Multi-region configuration.
-- Regions are created on the cluster via `ccloud` (see infra/); here we make
-- the database multi-region and opt into region-failure survivability.
-- Run these once against the primary region after the cluster exists.
-- ---------------------------------------------------------------------------
-- ALTER DATABASE blackbox SET PRIMARY REGION "aws-us-east-1";
-- ALTER DATABASE blackbox ADD REGION "aws-eu-west-1";
-- ALTER DATABASE blackbox ADD REGION "aws-ap-south-1";
-- ALTER DATABASE blackbox SURVIVE REGION FAILURE;

SET enable_multiregion_placement_policy = on;

-- ---------------------------------------------------------------------------
-- services: the fleet the agent operates. REGIONAL BY ROW so a service's
-- record lives where the service actually runs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS services (
    id          UUID NOT NULL DEFAULT gen_random_uuid(),
    name        STRING NOT NULL,
    environment STRING NOT NULL DEFAULT 'production',
    owner_team  STRING,
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    crdb_region crdb_internal_region NOT NULL DEFAULT default_to_database_primary_region(gateway_region())::crdb_internal_region,
    CONSTRAINT services_pkey PRIMARY KEY (crdb_region, id),
    UNIQUE (name, environment)
) LOCALITY REGIONAL BY ROW;

-- ---------------------------------------------------------------------------
-- incidents: episodic memory. Every incident the agent has ever seen, with a
-- semantic embedding so the agent can recall "have we seen this before?"
-- across the whole fleet, while each row stays pinned to its home region.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incidents (
    id           UUID NOT NULL DEFAULT gen_random_uuid(),
    service_id   UUID NOT NULL,
    title        STRING NOT NULL,
    summary      STRING NOT NULL,
    severity     STRING NOT NULL DEFAULT 'SEV3',      -- SEV1..SEV4
    status       STRING NOT NULL DEFAULT 'open',      -- open | mitigated | resolved
    signals      JSONB,                               -- raw alerts/metrics that opened it
    resolution   STRING,                              -- how it was fixed (fills on resolve)
    embedding    VECTOR(1024),                        -- semantic fingerprint of title+summary
    opened_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at  TIMESTAMPTZ,
    crdb_region  crdb_internal_region NOT NULL DEFAULT default_to_database_primary_region(gateway_region())::crdb_internal_region,
    CONSTRAINT incidents_pkey PRIMARY KEY (crdb_region, id),
    -- Distributed vector index, partitioned by region prefix so the k-means
    -- tree is co-located with the data it indexes (survivable + low-latency).
    VECTOR INDEX incidents_embedding_idx (crdb_region, embedding),
    -- Secondary indexes are defined INLINE deliberately: post-hoc
    -- `CREATE INDEX` on a REGIONAL BY ROW table with an inline vector index
    -- hits an internal error (XX000, "PARTITION ALL BY ... but index does not
    -- have matching PARTITION BY") in v25.4.0's declarative schema changer.
    -- Inline definitions receive implicit region partitioning correctly.
    INDEX incidents_service_idx (service_id, opened_at DESC),
    INDEX incidents_status_idx (status, severity)
) LOCALITY REGIONAL BY ROW;

-- ---------------------------------------------------------------------------
-- runbooks: semantic (procedural) memory. Remediation playbooks the agent
-- retrieves by similarity to the current situation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS runbooks (
    id          UUID NOT NULL DEFAULT gen_random_uuid(),
    title       STRING NOT NULL,
    body        STRING NOT NULL,                      -- markdown steps
    tags        STRING[],
    embedding   VECTOR(1024),
    -- Memory-hygiene columns. Learned runbooks enter provisionally and earn
    -- (or lose) standing over time; recall ranking weighs confidence, and
    -- archived rows are invisible to recall. This is what makes the store a
    -- managed memory, not an append-only log.
    source           STRING NOT NULL DEFAULT 'curated',  -- curated | learned
    status           STRING NOT NULL DEFAULT 'active',   -- active | archived
    confidence       FLOAT  NOT NULL DEFAULT 0.6,        -- 0..1
    recall_count     INT    NOT NULL DEFAULT 0,
    reinforced_count INT    NOT NULL DEFAULT 0,
    last_recalled_at TIMESTAMPTZ,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    crdb_region crdb_internal_region NOT NULL DEFAULT default_to_database_primary_region(gateway_region())::crdb_internal_region,
    CONSTRAINT runbooks_pkey PRIMARY KEY (crdb_region, id),
    VECTOR INDEX runbooks_embedding_idx (crdb_region, embedding)
) LOCALITY REGIONAL BY ROW;

-- Idempotent upgrades for clusters created before the hygiene columns existed.
-- Plain ADD COLUMN is safe on REGIONAL BY ROW (the v25.4.0 XX000 bug only
-- affects post-hoc CREATE INDEX alongside an inline vector index).
ALTER TABLE runbooks ADD COLUMN IF NOT EXISTS source STRING NOT NULL DEFAULT 'curated';
ALTER TABLE runbooks ADD COLUMN IF NOT EXISTS status STRING NOT NULL DEFAULT 'active';
ALTER TABLE runbooks ADD COLUMN IF NOT EXISTS confidence FLOAT NOT NULL DEFAULT 0.6;
ALTER TABLE runbooks ADD COLUMN IF NOT EXISTS recall_count INT NOT NULL DEFAULT 0;
ALTER TABLE runbooks ADD COLUMN IF NOT EXISTS reinforced_count INT NOT NULL DEFAULT 0;
ALTER TABLE runbooks ADD COLUMN IF NOT EXISTS last_recalled_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- memory_hygiene_events: the audit trail of the memory write path. Every
-- learned write is gated, deduplicated, and checked for contradictions before
-- it can influence future recall; every decision lands here. Surfaced in the
-- console so the hygiene layer is observable, not claimed.
-- action = accepted | rejected | merged | contradiction | reinforced | archived | decayed
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_hygiene_events (
    id          UUID NOT NULL DEFAULT gen_random_uuid(),
    action      STRING NOT NULL,
    target_kind STRING NOT NULL,                      -- runbook | memory
    target_id   UUID,
    detail      STRING NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    crdb_region crdb_internal_region NOT NULL DEFAULT default_to_database_primary_region(gateway_region())::crdb_internal_region,
    CONSTRAINT memory_hygiene_events_pkey PRIMARY KEY (crdb_region, id),
    INDEX hygiene_recent_idx (created_at DESC)
) LOCALITY REGIONAL BY ROW;

-- ---------------------------------------------------------------------------
-- agent_memory: the agent's working + long-term memory stream. Each row is a
-- thought/observation/action the agent recorded, embedded for later recall.
-- kind = observation | action | reflection | user_msg | agent_msg
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_memory (
    id          UUID NOT NULL DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL,
    incident_id UUID,                                 -- nullable: not all memory is incident-scoped
    kind        STRING NOT NULL,
    content     STRING NOT NULL,
    importance  FLOAT NOT NULL DEFAULT 0.5,           -- 0..1, drives retention/recall ranking
    embedding   VECTOR(1024),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    crdb_region crdb_internal_region NOT NULL DEFAULT default_to_database_primary_region(gateway_region())::crdb_internal_region,
    CONSTRAINT agent_memory_pkey PRIMARY KEY (crdb_region, id),
    VECTOR INDEX agent_memory_embedding_idx (crdb_region, embedding),
    -- Inline for the same declarative-schema-changer reason as incidents.
    INDEX agent_memory_session_idx (session_id, created_at)
) LOCALITY REGIONAL BY ROW;

-- ---------------------------------------------------------------------------
-- incident_state: structured, strongly-consistent live state for an active
-- incident. This is the transactional counterpart to the vector memory —
-- CockroachDB serves both from one system of record.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incident_state (
    incident_id   UUID NOT NULL,
    phase         STRING NOT NULL DEFAULT 'triage',   -- triage | diagnose | mitigate | resolve
    hypotheses    JSONB NOT NULL DEFAULT '[]',
    actions_taken JSONB NOT NULL DEFAULT '[]',
    next_steps    JSONB NOT NULL DEFAULT '[]',
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    crdb_region   crdb_internal_region NOT NULL DEFAULT default_to_database_primary_region(gateway_region())::crdb_internal_region,
    CONSTRAINT incident_state_pkey PRIMARY KEY (crdb_region, incident_id)
) LOCALITY REGIONAL BY ROW;

-- ---------------------------------------------------------------------------
-- rate_limits: durable, cross-instance rate limiting for the public agent
-- endpoint. Backed by the same database (one system of record), so it works
-- on serverless where an in-memory counter would reset per invocation.
-- Regional table (homed in the primary region) — created lazily at runtime too.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limits (
    bucket       STRING PRIMARY KEY,
    window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    count        INT NOT NULL DEFAULT 0
);
