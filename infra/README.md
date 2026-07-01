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
cluster and create a **service-account API key** (autonomous agent mode).
Copy the MCP endpoint URL and key into `.env`:

```
CRDB_MCP_URL="https://<cluster>.cockroachlabs.cloud/mcp"
CRDB_MCP_API_KEY="<service-account-api-key>"
```

The MCP server is read-only by default — exactly what `inspect_cluster` needs.

## 3. Apply schema + seed

```bash
npm install
npm run db:schema
npm run db:seed
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

## Cost note

CockroachDB Cloud multi-region and Bedrock both bill by usage. For the demo,
a small dedicated cluster + Titan embeddings + Claude Sonnet is inexpensive;
tear the cluster down with `ccloud cluster delete blackbox` when done.
