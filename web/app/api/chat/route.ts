import { NextRequest, NextResponse } from "next/server";
import { isMock } from "@blackbox/memory";
import { getAgent } from "@/lib/agentSession";
import { clientKey, rateLimit } from "@/lib/rateLimit";

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

    // Validate at the boundary.
    if (typeof sessionId !== "string" || typeof message !== "string" || !sessionId || !message) {
      return NextResponse.json({ error: "sessionId and message are required" }, { status: 400 });
    }
    if (message.length > MAX_MESSAGE_LEN) {
      return NextResponse.json(
        { error: `message exceeds ${MAX_MESSAGE_LEN} characters` },
        { status: 413 },
      );
    }

    // Rate limit per client (falls back to sessionId behind a shared proxy).
    const limit = rateLimit(clientKey(req.headers, sessionId));
    if (!limit.ok) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please slow down." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }

    const agent = getAgent(sessionId);
    const result = await agent.chat(message);

    return NextResponse.json({
      reply: result.reply,
      events: result.events,
      evidence: result.evidence ?? [],
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
