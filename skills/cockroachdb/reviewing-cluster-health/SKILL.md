<!--
  Vendored from the CockroachDB Agent Skills Repo (Apache-2.0):
  https://github.com/cockroachlabs/cockroachdb-skills
  skills/cockroachdb-operations-and-lifecycle/reviewing-cluster-health/SKILL.md
  @ commit 9e73c9d45894449490c23ce90d18e6f233251dfa

  BlackBox's diagnose_memory tool executes this skill's Standard-tier health
  check procedure against its own memory cluster (CockroachDB Cloud Standard)
  and cites it in the diagnosis it returns. See
  packages/memory/src/skillChecks.ts for the executable implementation.
-->
---
name: reviewing-cluster-health
description: Performs a comprehensive health check of a CockroachDB cluster. Gathers deployment context first, then provides tier-appropriate diagnostics. Self-Hosted uses SQL against node-level system tables and CLI. Advanced/BYOC use Cloud Console and SQL with node visibility. Standard monitors provisioned compute and workload via Cloud Console. Basic monitors Request Unit consumption and connectivity. Use for daily checks, pre-maintenance validation, post-incident verification, or production readiness assessment.
compatibility: Self-Hosted requires SQL access with admin or VIEWCLUSTERMETADATA privilege. Advanced/BYOC require Cloud Console and SQL connectivity. Standard requires Cloud Console and SQL. Basic requires Cloud Console.
metadata:
  author: cockroachdb
  version: "2.0"
---

# Reviewing Cluster Health (vendored excerpt — Standard tier)

BlackBox runs on **CockroachDB Cloud Standard**, so the Standard-tier procedure
below is the one `diagnose_memory` executes. The full skill (all tiers) lives in
the upstream repo linked above.

## Standard Health Check

**Applies when:** Tier = Standard

Standard is a multi-tenant managed service. There are no individual nodes to
monitor — Cockroach Labs manages all infrastructure, replication, and capacity.
Health checking focuses on your workload performance and provisioned compute.

### SQL Checks

```sql
-- Verify connectivity
SELECT 1;

-- Current version
SELECT version();

-- Recent failed jobs
WITH j AS (SHOW JOBS)
SELECT job_type, status, description FROM j
WHERE status = 'failed' AND created > now() - INTERVAL '24 hours';
```

### What to Monitor

- **P99 SQL latency** — track via Cloud Console Metrics
- **Error rates** — check for spikes in statement errors
- **Storage growth** — plan based on usage trends
- **Compute utilization** — increase provisioned vCPUs if utilization is consistently high

**Note:** Node-level visibility is not available on Standard. Use Cloud Console
for all infrastructure health monitoring.

## Safety Considerations

All checks in this skill are read-only. No data is modified.
