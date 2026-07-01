import { NextRequest, NextResponse } from "next/server";
import { getAgent } from "@/lib/agentSession";

// The agent uses pg + the AWS SDK, so this route must run on Node, not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { sessionId, message } = (await req.json()) as {
      sessionId: string;
      message: string;
    };
    if (!sessionId || !message) {
      return NextResponse.json({ error: "sessionId and message required" }, { status: 400 });
    }

    const agent = getAgent(sessionId);
    const result = await agent.chat(message);

    return NextResponse.json({
      reply: result.reply,
      events: result.events,
      incidentId: agent.currentIncidentId,
    });
  } catch (err) {
    console.error("[/api/chat]", err);
    return NextResponse.json(
      { error: (err as Error).message ?? "agent error" },
      { status: 500 },
    );
  }
}
