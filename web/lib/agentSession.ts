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
  const existing = sessions.get(sessionId);
  if (existing) {
    // Refresh recency so eviction is LRU, not FIFO — an active conversation
    // shouldn't be evicted just because it was created first.
    sessions.delete(sessionId);
    sessions.set(sessionId, existing);
    return existing;
  }
  // Bound the map: evict the least-recently-used session (durable memory lives
  // in CockroachDB, so eviction only drops in-flight conversation context).
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest) sessions.delete(oldest);
  }
  const agent = createAgent({ sessionId });
  sessions.set(sessionId, agent);
  return agent;
}
