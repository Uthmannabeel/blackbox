// Probe the CockroachDB Cloud MCP server: connect, list tools, print schemas.
//   node scripts/mcp-probe.mjs
import { loadEnv } from "../packages/memory/dist/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

loadEnv();

const url = process.env.CRDB_MCP_URL;
const key = process.env.CRDB_MCP_API_KEY;
const cluster = process.env.CRDB_MCP_CLUSTER_ID;
console.log(`URL: ${url}\nCluster: ${cluster}\nKey: ${key ? key.slice(0, 8) + "..." : "MISSING"}`);

async function tryConnect(label, targetUrl) {
  const transport = new StreamableHTTPClientTransport(new URL(targetUrl), {
    requestInit: { headers: { Authorization: `Bearer ${key}` } },
  });
  const client = new Client({ name: "blackbox-probe", version: "0.1.0" });
  await client.connect(transport);
  console.log(`\n[${label}] CONNECTED to ${targetUrl}`);
  const { tools } = await client.listTools();
  console.log(`[${label}] ${tools.length} tools:`);
  for (const t of tools) {
    const props = t.inputSchema?.properties ? Object.keys(t.inputSchema.properties) : [];
    console.log(`  - ${t.name}(${props.join(", ")})  ${t.description?.slice(0, 70) ?? ""}`);
  }
  await client.close();
  return tools;
}

// The managed endpoint is org-wide; the cluster may be targeted via the URL.
// Try a few plausible shapes and report which connects.
const candidates = [
  ["base", url],
  ["query-cluster", `${url}?cluster_id=${cluster}`],
  ["path-cluster", `${url.replace(/\/mcp$/, "")}/cluster/${cluster}/mcp`],
];

for (const [label, u] of candidates) {
  try {
    await tryConnect(label, u);
    break;
  } catch (err) {
    console.log(`\n[${label}] FAILED ${u}\n  ${err.name}: ${err.message}`);
  }
}
