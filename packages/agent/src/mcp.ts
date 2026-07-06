import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * Client for the CockroachDB Cloud **Managed MCP Server**
 * (https://cockroachlabs.cloud/mcp).
 *
 * The managed endpoint is org-wide and exposes read/write tools that each take
 * a `cluster_id` argument to target a specific cluster:
 *   select_query / show_statement / explain_query (read-only),
 *   get_cluster / show_running_queries / list_databases / list_tables /
 *   get_table_schema, plus write tools (create-table, insert-rows).
 *
 * BlackBox uses only the read-only tools, giving the agent a way to introspect
 * the very database that stores its memory. Auth: service-account API key as a
 * bearer token (autonomous agent mode).
 */
let clientPromise: Promise<Client> | null = null;

export function mcpConfigured(): boolean {
  return Boolean(process.env.CRDB_MCP_URL && process.env.CRDB_MCP_CLUSTER_ID);
}

function clusterId(): string {
  const id = process.env.CRDB_MCP_CLUSTER_ID;
  if (!id) throw new Error("CRDB_MCP_CLUSTER_ID is not set");
  return id;
}

function database(): string {
  return process.env.CRDB_MCP_DATABASE ?? "blackbox";
}

async function connect(): Promise<Client> {
  const url = process.env.CRDB_MCP_URL;
  if (!url) throw new Error("CRDB_MCP_URL is not set");
  const apiKey = process.env.CRDB_MCP_API_KEY;

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : undefined,
  });
  const client = new Client({ name: "blackbox-agent", version: "0.1.0" });
  await client.connect(transport);
  return client;
}

function getClient(): Promise<Client> {
  if (!clientPromise) {
    // Reset on failure so a transient connect error doesn't permanently brick
    // the cached promise — the next call gets a fresh attempt.
    clientPromise = connect().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

/** Route a read-only statement to the matching CockroachDB Cloud MCP tool. */
function toolFor(sql: string): { name: string; extraArgs: Record<string, unknown> } {
  const s = sql.trim().toLowerCase();
  if (s.startsWith("explain")) return { name: "explain_query", extraArgs: { database: database() } };
  if (s.startsWith("show")) return { name: "show_statement", extraArgs: { database: database() } };
  // select / with
  return { name: "select_query", extraArgs: { database: database() } };
}

/**
 * Run a read-only SQL statement against the cluster through the MCP server.
 * Returns the MCP tool's textual result.
 */
export async function mcpRunSql(sql: string): Promise<string> {
  const client = await getClient();
  const { name, extraArgs } = toolFor(sql);
  const result = await client.callTool({
    name,
    arguments: { cluster_id: clusterId(), query: sql, ...extraArgs },
  });
  return renderContent(result.content);
}

function renderContent(content: unknown): string {
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((c: any) => (c?.type === "text" ? c.text : JSON.stringify(c)))
    .join("\n");
}
