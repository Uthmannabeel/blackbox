import { NextRequest, NextResponse } from "next/server";
import { createMemoryService, getPool, hitRateLimit, isMock } from "@blackbox/memory";
import { clientKey, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The war room — two agents, one memory, zero lost updates.
 *
 * Two agent workers (an incident RESPONDER and a postmortem SCRIBE) work the
 * SAME incident-state row concurrently. Each step is a deliberate
 * read-modify-write: read the JSONB state, hold the transaction open long
 * enough to guarantee interleaving, then write the merged value back. Under
 * weaker isolation this is the textbook lost-update bug; under CockroachDB's
 * SERIALIZABLE it becomes a retry (error 40001) that the worker replays. The
 * event log records every attempt and retry, and the final assertion counts
 * entries: two agents × three writes = six entries, or the demo fails loudly.
 *
 * No model calls — this exercises the memory layer's concurrency guarantee,
 * which is exactly the part multi-agent systems get wrong.
 */

const PER_MIN = 3;
const PER_DAY = 20;
const GLOBAL_PER_DAY = 200;
const HOLD_MS = 120;
const MAX_RETRIES = 8;

interface WarEvent {
  atMs: number;
  agent: "responder" | "scribe";
  step: string;
  attempt: number;
  outcome: "committed" | "retrying" | "failed";
}

type StateCol = "hypotheses" | "actions_taken" | "next_steps";

const SCRIPTS: Record<"responder" | "scribe", { col: StateCol; entry: string; step: string }[]> = {
  responder: [
    { col: "hypotheses", entry: "Connection pool exhausted by slow downstream calls", step: "record hypothesis" },
    { col: "actions_taken", entry: "Scaled pool 50→200 and enabled queue backpressure", step: "record action" },
    { col: "next_steps", entry: "Watch p99 for 15 min, then step down the pool", step: "record next step" },
  ],
  scribe: [
    { col: "hypotheses", entry: "Retry storm from mobile clients amplifying the spike", step: "record hypothesis" },
    { col: "actions_taken", entry: "Captured metrics + timeline snapshots for the postmortem", step: "record action" },
    { col: "next_steps", entry: "Draft postmortem and cite recalled runbooks", step: "record next step" },
  ],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function contendedAppend(
  incidentId: string,
  col: StateCol,
  entry: string,
): Promise<number> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const cur = await client.query(
        `SELECT ${col} AS v FROM incident_state WHERE incident_id = $1`,
        [incidentId],
      );
      const list: string[] = Array.isArray(cur.rows[0]?.v) ? cur.rows[0].v : [];
      // Hold the read-modify-write window open so the two agents genuinely
      // interleave — this is the race, on purpose.
      await sleep(HOLD_MS);
      await client.query(
        `UPDATE incident_state SET ${col} = $2::jsonb, updated_at = now()
          WHERE incident_id = $1`,
        [incidentId, JSON.stringify([...list, entry])],
      );
      await client.query("COMMIT");
      client.release();
      return attempt;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // connection may be gone
      }
      client.release();
      const code = (err as { code?: string })?.code;
      if (code !== "40001" || attempt === MAX_RETRIES) throw err;
      await sleep(20 * attempt);
    }
  }
  throw new Error("unreachable");
}

export async function POST(req: NextRequest) {
  if (isMock()) {
    return NextResponse.json({ error: "war room unavailable in mock mode" }, { status: 503 });
  }

  const key = clientKey(req.headers);
  try {
    const [m, d, g] = await Promise.all([
      hitRateLimit(`warroom:min:${key}`, PER_MIN, 60),
      hitRateLimit(`warroom:day:${key}`, PER_DAY, 86_400),
      hitRateLimit(`warroom:global:day`, GLOBAL_PER_DAY, 86_400),
    ]);
    if (!m.ok || !d.ok || !g.ok) {
      return NextResponse.json({ error: "rate limited — try again shortly" }, { status: 429 });
    }
  } catch {
    if (!rateLimit(`warroom:${key}`).ok) {
      return NextResponse.json({ error: "rate limited" }, { status: 429 });
    }
  }

  try {
    const memory = createMemoryService();
    const service = await memory.resolveService("war-room");
    const incident = await memory.recordIncident({
      serviceId: service.id,
      title: "War-room drill — two agents, one memory",
      summary:
        "Scripted concurrency drill: a responder and a scribe write the same incident state simultaneously; serializable isolation turns lost updates into retries.",
      severity: "SEV3",
    });
    await getPool().query(
      `INSERT INTO incident_state (incident_id) VALUES ($1)
       ON CONFLICT DO NOTHING`,
      [incident.id],
    );

    const t0 = Date.now();
    const events: WarEvent[] = [];
    let retries = 0;

    const runAgent = async (agent: "responder" | "scribe", offsetMs: number) => {
      await sleep(offsetMs);
      for (const step of SCRIPTS[agent]) {
        const attempts = await contendedAppend(incident.id, step.col, step.entry);
        for (let a = 1; a < attempts; a++) {
          retries++;
          events.push({ atMs: Date.now() - t0, agent, step: step.step, attempt: a, outcome: "retrying" });
        }
        events.push({
          atMs: Date.now() - t0,
          agent,
          step: step.step,
          attempt: attempts,
          outcome: "committed",
        });
      }
    };

    // Offsets chosen so every step-pair overlaps inside the other's held-open
    // transaction window.
    await Promise.all([runAgent("responder", 0), runAgent("scribe", HOLD_MS / 2)]);

    const final = await getPool().query(
      `SELECT phase, hypotheses, actions_taken, next_steps FROM incident_state
        WHERE incident_id = $1`,
      [incident.id],
    );
    const st = final.rows[0] ?? {};
    const actual =
      (Array.isArray(st.hypotheses) ? st.hypotheses.length : 0) +
      (Array.isArray(st.actions_taken) ? st.actions_taken.length : 0) +
      (Array.isArray(st.next_steps) ? st.next_steps.length : 0);

    return NextResponse.json({
      incidentId: incident.id,
      events: events.sort((a, b) => a.atMs - b.atMs),
      finalState: {
        phase: st.phase ?? "triage",
        hypotheses: st.hypotheses ?? [],
        actionsTaken: st.actions_taken ?? [],
        nextSteps: st.next_steps ?? [],
      },
      totals: { expected: 6, actual, retries, lostUpdates: 6 - actual },
    });
  } catch (err) {
    console.error("[/api/warroom]", err);
    return NextResponse.json({ error: "war-room drill failed" }, { status: 500 });
  }
}
