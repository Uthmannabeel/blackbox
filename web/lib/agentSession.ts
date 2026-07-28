import { createAgent, type Agent } from "@blackbox/agent";

/**
 * Server-side registry of live agent sessions. The agent's *durable* memory
 * lives in CockroachDB; this map only holds the in-flight conversation so
 * multi-turn context works within a browser session. Uses the real Bedrock
 * agent, or the scripted mock when BLACKBOX_MOCK is set.
 */
const sessions = new Map<string, Agent>();
const MAX_SESSIONS = 200;

/**
 * Is this request from an authenticated operator?
 *
 * The public console has no login, so by default NOTHING it teaches the agent
 * may enter shared recall — learned runbooks from these sessions are
 * quarantined. Set BLACKBOX_OPERATOR_TOKEN and send it as `x-blackbox-operator`
 * to run a trusted session (that is how the demo promotes a live lesson).
 *
 * Fails closed: no token configured, or no header, means untrusted.
 */
export function isTrustedRequest(headers: Headers): boolean {
  const expected = process.env.BLACKBOX_OPERATOR_TOKEN;
  if (!expected) return false;
  const provided = headers.get("x-blackbox-operator");
  if (!provided || provided.length !== expected.length) return false;
  // Constant-time-ish compare: never leak position of the first difference.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

export function getAgent(sessionId: string, trusted = false): Agent {
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
  const agent = createAgent({ sessionId, trusted });
  sessions.set(sessionId, agent);
  return agent;
}
