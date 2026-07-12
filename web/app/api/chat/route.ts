import { NextRequest, NextResponse } from "next/server";
import { isMock, hitRateLimit } from "@blackbox/memory";
import { getAgent } from "@/lib/agentSession";
import { clientKey, rateLimit } from "@/lib/rateLimit";

// Per-client caps. The minute cap stops loops; the day cap protects the
// Bedrock budget from sustained abuse of this public endpoint.
const PER_MIN = 20;
const PER_DAY = 300;

/** Durable, cross-instance limit via CockroachDB in live mode; in-memory for mock. */
async function limited(key: string): Promise<boolean> {
  if (isMock()) return !rateLimit(key).ok;
  try {
    const [m, d] = await Promise.all([
      hitRateLimit(`chat:min:${key}`, PER_MIN, 60),
      hitRateLimit(`chat:day:${key}`, PER_DAY, 86_400),
    ]);
    return !m.ok || !d.ok;
  } catch {
    // If the limiter itself is unreachable, fall back to the in-memory guard
    // rather than failing open completely.
    return !rateLimit(key).ok;
  }
}

// The agent uses pg + the AWS SDK, so this route must run on Node, not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGE_LEN = 4000;

export async function POST(req: NextRequest) {
  // Fail helpfully, not cryptically, when running real mode unconfigured.
  if (!isMock() && !process.env.DATABASE_URL) {
    return NextResponse.json(
      {
        error:
          "BlackBox isn't configured yet: set DATABASE_URL (and AWS credentials) in .env, " +
          "or run the offline demo with `npm run dev:mock` (BLACKBOX_MOCK=1).",
      },
      { status: 503 },
    );
  }

  try {
    const { sessionId, message } = (await req.json()) as {
      sessionId: string;
      message: string;
    };

    // Validate at the boundary. sessionId must be a UUID — it keys UUID columns
    // in the memory tables, so a malformed one would fail writes downstream.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof sessionId !== "string" || typeof message !== "string" || !message) {
      return NextResponse.json({ error: "sessionId and message are required" }, { status: 400 });
    }
    if (!UUID_RE.test(sessionId)) {
      return NextResponse.json({ error: "sessionId must be a UUID" }, { status: 400 });
    }
    if (message.length > MAX_MESSAGE_LEN) {
      return NextResponse.json(
        { error: `message exceeds ${MAX_MESSAGE_LEN} characters` },
        { status: 413 },
      );
    }

    // Rate limit by the platform-trusted client IP (never a spoofable header).
    if (await limited(clientKey(req.headers))) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please slow down." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }

    const agent = getAgent(sessionId);
    const result = await agent.chat(message);

    // Only surface the tool-call trace (name + inputs the UI renders). Raw
    // tool_result payloads can carry pg error internals and full cluster query
    // output — keep them server-side.
    const events = result.events
      .filter((e) => e.type === "tool_call")
      .map((e) => ({ type: e.type, tool: e.tool, input: e.input }));

    return NextResponse.json({
      reply: result.reply,
      events,
      evidence: result.evidence ?? [],
      memoryDegraded: result.memoryDegraded ?? false,
      incidentId: agent.currentIncidentId,
    });
  } catch (err) {
    // Log full detail server-side; return a generic message to the client.
    console.error("[/api/chat]", err);
    return NextResponse.json(
      { error: "The agent hit an internal error. Please try again." },
      { status: 500 },
    );
  }
}
