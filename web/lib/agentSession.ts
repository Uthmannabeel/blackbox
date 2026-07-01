import { createAgent, type Agent } from "@blackbox/agent";

/**
 * Server-side registry of live agent sessions. The agent's *durable* memory
 * lives in CockroachDB; this map only holds the in-flight conversation so
 * multi-turn context works within a browser session. Uses the real Bedrock
 * agent, or the scripted mock when BLACKBOX_MOCK is set.
 */
const sessions = new Map<string, Agent>();
const MAX_SESSIONS = 200;

export function getAgent(sessionId: string): Agent {
  let agent = sessions.get(sessionId);
  if (!agent) {
    // Bound the map: evict the oldest session (durable memory lives in
    // CockroachDB, so eviction only drops in-flight conversation context).
    if (sessions.size >= MAX_SESSIONS) {
      const oldest = sessions.keys().next().value;
      if (oldest) sessions.delete(oldest);
    }
    agent = createAgent({ sessionId });
    sessions.set(sessionId, agent);
  }
  return agent;
}
