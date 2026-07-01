import { NextRequest, NextResponse } from "next/server";
import { createMemoryService } from "@blackbox/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Live detail for one incident: the episodic record + transactional state. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid incident id" }, { status: 400 });
  }

  try {
    const memory = createMemoryService();
    const [incident, state] = await Promise.all([
      memory.getIncident(id),
      memory.getIncidentState(id),
    ]);
    if (!incident) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ incident, state });
  } catch (err) {
    console.error("[/api/incident]", err);
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }
}
