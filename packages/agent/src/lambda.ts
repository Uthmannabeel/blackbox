import { BlackBoxAgent } from "./agent.js";

/**
 * AWS Lambda handler for the BlackBox agent (API Gateway / Lambda Function URL).
 *
 * The agent is stateless across invocations — all durable state lives in
 * CockroachDB — so it scales horizontally on Lambda with no sticky sessions.
 * We keep a warm per-container cache of in-flight Bedrock conversations keyed
 * by sessionId to preserve multi-turn context while a container is warm.
 */
const warm = new Map<string, BlackBoxAgent>();
const MAX_WARM = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LambdaEvent {
  body?: string;
}
interface ChatBody {
  sessionId: string;
  message: string;
}

export async function handler(event: LambdaEvent) {
  try {
    const { sessionId, message } = JSON.parse(event.body ?? "{}") as ChatBody;
    if (!sessionId || !message) {
      return json(400, { error: "sessionId and message are required" });
    }
    // sessionId keys UUID columns in the memory tables; reject non-UUIDs up
    // front so agent_memory writes don't fail silently downstream.
    if (!UUID_RE.test(sessionId)) {
      return json(400, { error: "sessionId must be a UUID" });
    }

    let agent = warm.get(sessionId);
    if (agent) {
      // Refresh recency so eviction is LRU, not FIFO — an active conversation
      // shouldn't be dropped just because it was created first.
      warm.delete(sessionId);
      warm.set(sessionId, agent);
    } else {
      if (warm.size >= MAX_WARM) {
        const oldest = warm.keys().next().value;
        if (oldest) warm.delete(oldest);
      }
      agent = new BlackBoxAgent({ sessionId });
      warm.set(sessionId, agent);
    }

    const result = await agent.chat(message);
    return json(200, {
      reply: result.reply,
      // Only the tool-call trace; raw tool_result payloads stay server-side.
      events: result.events
        .filter((e) => e.type === "tool_call")
        .map((e) => ({ type: e.type, tool: e.tool, input: e.input })),
      incidentId: agent.currentIncidentId,
    });
  } catch (err) {
    console.error("[lambda]", err);
    return json(500, { error: (err as Error).message });
  }
}

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}
