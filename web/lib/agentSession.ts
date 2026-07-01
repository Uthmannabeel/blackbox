import { BlackBoxAgent } from "@blackbox/agent";

/**
 * Server-side registry of live agent sessions. The agent's *durable* memory
 * lives in CockroachDB; this map only holds the in-flight Bedrock conversation
 * so multi-turn context works within a browser session.
 */
const sessions = new Map<string, BlackBoxAgent>();

export function getAgent(sessionId: string): BlackBoxAgent {
  let agent = sessions.get(sessionId);
  if (!agent) {
    agent = new BlackBoxAgent({ sessionId });
    sessions.set(sessionId, agent);
  }
  return agent;
}
