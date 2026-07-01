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

/** Return the real Bedrock agent, or the scripted mock when BLACKBOX_MOCK is set. */
export function createAgent(opts: { sessionId: string }): Agent {
  return isMock() ? new MockAgent(opts) : new BlackBoxAgent(opts);
}
