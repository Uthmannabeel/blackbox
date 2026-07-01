import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * Client for the CockroachDB Cloud **Managed MCP Server**.
 *
 * The managed MCP server exposes read-only tools for inspecting a live cluster
 * (list databases/tables, describe schemas, inspect cluster health + running
 * queries, run read-only SQL / EXPLAIN). BlackBox gives the agent this as a
 * capability so it can introspect the very database it operates on — e.g.
 * "what indexes exist on incidents?" or "is any query running long right now?".
 *
 * Auth: service-account API key via bearer header (autonomous agent mode).
 */
let clientPromise: Promise<Client> | null = null;
let sqlToolName: string | null = null;

export function mcpConfigured(): boolean {
  return Boolean(process.env.CRDB_MCP_URL);
}

async function connect(): Promise<Client> {
  const url = process.env.CRDB_MCP_URL;
  if (!url) throw new Error("CRDB_MCP_URL is not set");

  const apiKey = process.env.CRDB_MCP_API_KEY;
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: apiKey
      ? { headers: { Authorization: `Bearer ${apiKey}` } }
      : undefined,
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

/** Find (once) the MCP tool whose name looks like a read-only SQL runner. */
async function findSqlTool(client: Client): Promise<string> {
  if (sqlToolName) return sqlToolName;
  const { tools } = await client.listTools();
  const match =
    tools.find((t) => /run.*sql|read.*sql|sql.*query|query/i.test(t.name)) ??
    tools.find((t) => /sql/i.test(t.name));
  if (!match) {
    throw new Error(
      `No SQL tool found on MCP server. Available: ${tools.map((t) => t.name).join(", ")}`,
    );
  }
  sqlToolName = match.name;
  return sqlToolName;
}

/**
 * Run a read-only SQL statement against the cluster through the MCP server.
 * Returns the MCP tool's textual result.
 */
export async function mcpRunSql(sql: string): Promise<string> {
  const client = await getClient();
  const toolName = await findSqlTool(client);
  const result = await client.callTool({
    name: toolName,
    arguments: { sql, statement: sql, query: sql },
  });
  return renderContent(result.content);
}

function renderContent(content: unknown): string {
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((c: any) => (c?.type === "text" ? c.text : JSON.stringify(c)))
    .join("\n");
}
