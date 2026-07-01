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

    let agent = warm.get(sessionId);
    if (!agent) {
      // Bound the warm cache; durable memory lives in CockroachDB.
      if (warm.size >= 100) {
        const oldest = warm.keys().next().value;
        if (oldest) warm.delete(oldest);
      }
      agent = new BlackBoxAgent({ sessionId });
      warm.set(sessionId, agent);
    }

    const result = await agent.chat(message);
    return json(200, {
      reply: result.reply,
      events: result.events,
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
