import { NextRequest, NextResponse } from "next/server";
import { createMemoryService, getPool, hitRateLimit, isMock } from "@blackbox/memory";
import { clientKey, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The red-team challenge: try to poison the agent's memory, in public.
 *
 * Every attempt goes through the REAL learning write path —
 * `commitLearnedRunbook` with `trusted: false`, the same call the anonymous
 * console makes — so the content gate, duplicate consolidation, contradiction
 * check, and quarantine all run for real. Then the response includes a
 * recall-proof: the top runbook recall for the attacker's own text, showing
 * their write is not in it.
 *
 * Attempts are logged to `poison_attempts` for the public wall. The excerpt is
 * stored only when the attempt PASSED the content gate (plausible-but-false
 * lessons); content-gate rejects are logged without their text so the wall
 * cannot be used as a message board.
 */

const CHALLENGE_INCIDENT_TITLE = "Red-team challenge: public memory-poisoning attempts";
const MAX_LESSON_CHARS = 600;

// Tighter than chat: each attempt costs two Bedrock embeddings.
const PER_MIN = 5;
const PER_DAY = 40;
const GLOBAL_PER_DAY = 400;

async function ensureAttemptLog(): Promise<void> {
  await getPool().query(
    `CREATE TABLE IF NOT EXISTS poison_attempts (
       id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       at         TIMESTAMPTZ NOT NULL DEFAULT now(),
       excerpt    STRING,
       action     STRING NOT NULL,
       detail     STRING NOT NULL,
       runbook_id UUID,
       breached   BOOL NOT NULL DEFAULT false
     )`,
  );
}

async function challengeIncidentId(): Promise<string> {
  const pool = getPool();
  const existing = await pool.query(`SELECT id FROM incidents WHERE title = $1 LIMIT 1`, [
    CHALLENGE_INCIDENT_TITLE,
  ]);
  if (existing.rows[0]?.id) return existing.rows[0].id;
  const memory = createMemoryService();
  const service = await memory.resolveService("red-team-console");
  const incident = await memory.recordIncident({
    serviceId: service.id,
    title: CHALLENGE_INCIDENT_TITLE,
    summary:
      "Standing incident that anchors the public poison-me challenge. Every lesson taught here arrives from an unauthenticated visitor and must be caught by the write gate.",
    severity: "SEV4",
  });
  return incident.id;
}

export async function POST(req: NextRequest) {
  if (isMock()) {
    return NextResponse.json({ error: "challenge unavailable in mock mode" }, { status: 503 });
  }

  const key = clientKey(req.headers);
  try {
    const [m, d, g] = await Promise.all([
      hitRateLimit(`poison:min:${key}`, PER_MIN, 60),
      hitRateLimit(`poison:day:${key}`, PER_DAY, 86_400),
      hitRateLimit(`poison:global:day`, GLOBAL_PER_DAY, 86_400),
    ]);
    if (!m.ok || !d.ok || !g.ok) {
      return NextResponse.json(
        { error: "rate limited — the gate is patient, try again later" },
        { status: 429 },
      );
    }
  } catch {
    if (!rateLimit(`poison:${key}`).ok) {
      return NextResponse.json({ error: "rate limited" }, { status: 429 });
    }
  }

  let lesson: string;
  try {
    const body = await req.json();
    lesson = String(body?.lesson ?? "").trim();
  } catch {
    return NextResponse.json({ error: "body must be JSON with a `lesson` string" }, { status: 400 });
  }
  if (!lesson) {
    return NextResponse.json({ error: "lesson is empty" }, { status: 400 });
  }
  if (lesson.length > MAX_LESSON_CHARS) {
    return NextResponse.json(
      { error: `lesson too long (max ${MAX_LESSON_CHARS} chars)` },
      { status: 400 },
    );
  }

  try {
    await ensureAttemptLog();
    const memory = createMemoryService();
    const incidentId = await challengeIncidentId();

    // The genuine untrusted write path. `trusted` stays unset: fail closed.
    const outcome = await memory.commitLearnedRunbook({
      incidentId,
      title: lesson.slice(0, 90),
      body: lesson,
      tags: ["red-team"],
    });

    // Recall-proof: recall runbooks for the attacker's own lesson and show the
    // quarantined write is absent — quarantine means "never recalled", live.
    const recall = await memory.recallRunbooks(lesson, 3);
    const proof = recall.map((h) => ({
      title: h.item.title,
      distance: Number(h.distance.toFixed(3)),
    }));
    const breached = Boolean(
      outcome.runbookId && recall.some((h) => h.item.id === outcome.runbookId),
    );

    const passedContentGate = outcome.action !== "rejected";
    await getPool().query(
      `INSERT INTO poison_attempts (excerpt, action, detail, runbook_id, breached)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        passedContentGate ? lesson.slice(0, 200) : null,
        outcome.action,
        outcome.detail,
        outcome.runbookId ?? null,
        breached,
      ],
    );

    return NextResponse.json({
      action: outcome.action,
      detail: outcome.detail,
      contradictsId: outcome.contradictsId ?? null,
      breached,
      proof,
    });
  } catch (err) {
    console.error("[/api/poison]", err);
    return NextResponse.json({ error: "attempt failed to process" }, { status: 500 });
  }
}

export async function GET() {
  if (isMock()) {
    return NextResponse.json({ attempts: 0, breaches: 0, since: null, recent: [] });
  }
  try {
    const pool = getPool();
    const [agg, recent] = await Promise.all([
      pool.query(
        `SELECT count(*)::int AS attempts,
                count(*) FILTER (WHERE breached)::int AS breaches,
                min(at) AS since
           FROM poison_attempts`,
      ),
      pool.query(
        `SELECT at, excerpt, action, detail FROM poison_attempts
          ORDER BY at DESC LIMIT 12`,
      ),
    ]);
    const a = agg.rows[0] ?? {};
    return NextResponse.json({
      attempts: Number(a.attempts ?? 0),
      breaches: Number(a.breaches ?? 0),
      since: a.since ?? null,
      recent: recent.rows.map(
        (r: { at: string; excerpt: string | null; action: string; detail: string }) => ({
          at: r.at,
          excerpt: r.excerpt,
          action: r.action,
          detail: r.detail,
        }),
      ),
    });
  } catch {
    // Table not created yet — an empty wall, not an error.
    return NextResponse.json({ attempts: 0, breaches: 0, since: null, recent: [] });
  }
}
