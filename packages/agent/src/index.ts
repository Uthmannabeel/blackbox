import { isMock } from "@blackbox/memory";
import { BlackBoxAgent, type Agent } from "./agent.js";
import { MockAgent } from "./mockAgent.js";

export { BlackBoxAgent } from "./agent.js";
export { MockAgent } from "./mockAgent.js";
export type { Agent, AgentEvent, AgentResult } from "./agent.js";
export { buildTools } from "./tools.js";
export type { AgentTool, ToolContext } from "./tools.js";
export { mcpConfigured, mcpRunSql } from "./mcp.js";
export { handler as lambdaHandler } from "./lambda.js";

/**
 * Return the real Bedrock agent, or the scripted mock when BLACKBOX_MOCK is
 * set. BLACKBOX_MOCK_AGENT=1 selects the scripted agent while keeping the
 * REAL memory backend — used on the local chaos rig where CockroachDB is live
 * but Bedrock credentials may not exist yet.
 */
export function createAgent(opts: { sessionId: string }): Agent {
  const mockAgent = process.env.BLACKBOX_MOCK_AGENT;
  const useMock =
    isMock() || mockAgent === "1" || mockAgent === "true" || mockAgent === "yes";
  return useMock ? new MockAgent(opts) : new BlackBoxAgent(opts);
}
