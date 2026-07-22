# Infra — provisioning BlackBox

This guide provisions the two clouds BlackBox needs: a **multi-region
CockroachDB Cloud** cluster (with the Managed MCP Server) and **AWS Bedrock**
access. Commands use the `ccloud` CLI and the AWS CLI.

## 1. CockroachDB Cloud — multi-region cluster

Install the CLI and authenticate:

```bash
# macOS/Linux
brew install cockroachdb/tap/ccloud
# Windows (scoop)
scoop install ccloud

ccloud auth login
```

Create a multi-region serverless/dedicated cluster across three regions:

```bash
ccloud cluster create dedicated blackbox \
  --provider aws \
  --region aws-us-east-1 \
  --region aws-eu-west-1 \
  --region aws-ap-south-1 \
  --primary-region aws-us-east-1
```

Create the database and a least-privilege SQL user, then make it multi-region
and survivable (run in the SQL shell, `ccloud cluster sql blackbox`):

```sql
CREATE DATABASE blackbox;
ALTER DATABASE blackbox SET PRIMARY REGION "aws-us-east-1";
ALTER DATABASE blackbox ADD REGION "aws-eu-west-1";
ALTER DATABASE blackbox ADD REGION "aws-ap-south-1";
ALTER DATABASE blackbox SURVIVE REGION FAILURE;

CREATE USER blackbox WITH PASSWORD '<strong-password>';
GRANT CONNECT ON DATABASE blackbox TO blackbox;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA blackbox.public TO blackbox;
```

Copy the connection string into `.env` as `DATABASE_URL`.

## 2. Enable the Managed MCP Server

In the CockroachDB Cloud Console, enable the **Managed MCP Server** for the
cluster and create a **service account + API key**, then assign the account the
**Cluster Operator** role (without it, MCP queries return "unauthorized").
The endpoint is org-wide — one URL for the whole org, with the target cluster
passed per call — so `.env` needs the cluster's UUID too:

```
CRDB_MCP_URL="https://cockroachlabs.cloud/mcp"
CRDB_MCP_API_KEY="<service-account-api-key>"
CRDB_MCP_CLUSTER_ID="<cluster-uuid from the console cluster page>"
```

The MCP server is read-only by default — exactly what `inspect_cluster` needs.

## 3. Apply schema + seed

```bash
npm install
npm run db:schema
npm run db:seed
npm run db:ingest-postmortems   # 25 real public postmortems, provenance-linked
```

## 4. AWS Bedrock

```bash
aws configure                                   # region us-east-1
# Request model access in the Bedrock console for:
#   - anthropic.claude-sonnet-4-6 (reasoning)
#   - amazon.titan-embed-text-v2:0 (embeddings)
```

Set `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `BEDROCK_MODEL_ID`,
and `BEDROCK_EMBED_MODEL_ID` in `.env`.

## 5. (Optional) Deploy the agent to Lambda

The agent is stateless (all state is in CockroachDB), so it packages cleanly as
a Lambda behind an HTTP endpoint the web UI calls. See `infra/lambda/` (TODO)
for the handler + SAM/CDK template. Store incident artifacts/postmortems in S3.

## Least-privilege credentials (do this before submission)

The demo was provisioned with broad roles to move fast. Tighten before it's public:

- **AWS IAM user** — replace `AmazonBedrockFullAccess` with the scoped policy in
  [`iam-bedrock-policy.json`](./iam-bedrock-policy.json) (only `InvokeModel` /
  `InvokeModelWithResponseStream` on the two models we use). If the inference-profile
  ARN scoping errors on your account, widen `Resource` to `"*"` but keep the two
  actions.
- **CockroachDB MCP service account** — the MCP server only needs to run read-only
  SQL, so **Cluster Operator** is sufficient; drop **Cluster Admin** if it was granted.
- **SQL user** — the app needs DML on the `blackbox` schema only, not cluster admin.

The public `/api/chat` endpoint is additionally protected by a durable,
CockroachDB-backed rate limiter (per-minute + per-day per client) so it can't be
abused to run up the Bedrock bill — see `packages/memory/src/rateLimit.ts`.

## Cost note

CockroachDB Cloud multi-region and Bedrock both bill by usage. For the demo,
a small dedicated cluster + Titan embeddings + Claude Sonnet is inexpensive;
tear the cluster down with `ccloud cluster delete blackbox` when done.
