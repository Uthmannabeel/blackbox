import { NextRequest, NextResponse } from "next/server";
import { createMemoryService } from "@blackbox/memory";
import { isTrustedRequest } from "@/lib/agentSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Promote a quarantined runbook into live recall.
 *
 * The one state-changing route that requires authentication. Quarantine is only
 * a real control if the release valve is guarded — an unauthenticated caller
 * that could promote its own write would make the whole boundary decorative.
 * Fails closed: no operator token configured means nobody can promote.
 */
export async function POST(req: NextRequest) {
  if (!isTrustedRequest(req.headers)) {
    return NextResponse.json(
      { error: "Promoting quarantined knowledge requires an operator session." },
      { status: 401 },
    );
  }

  try {
    const { runbookId } = (await req.json()) as { runbookId?: unknown };
    if (typeof runbookId !== "string" || !UUID_RE.test(runbookId)) {
      return NextResponse.json({ error: "runbookId must be a UUID" }, { status: 400 });
    }

    const promoted = await createMemoryService().promoteRunbook(runbookId);
    if (!promoted) {
      return NextResponse.json(
        { error: "No quarantined runbook with that id (it may already be active)." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, runbookId });
  } catch (err) {
    console.error("[/api/quarantine/promote]", err);
    return NextResponse.json({ error: "Promotion failed." }, { status: 500 });
  }
}
