import { NextRequest, NextResponse } from "next/server";
import {
  consolidateEpisodes,
  embed,
  episodeSignature,
  getPool,
  hitRateLimit,
  isMock,
  overfetchFor,
} from "@blackbox/memory";
import { clientKey, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Memory forensics — replay a recall against the past.
 *
 * "What did the agent know, and when did it know it?" CockroachDB answers this
 * without backups or a separate audit store: the SAME consolidated recall the
 * agent runs live is re-run inside an `AS OF SYSTEM TIME` transaction, giving
 * the exact evidence set as of that moment, then again at present time. The
 * diff is the forensic record: which episodes did not exist yet, which
 * runbooks the agent has since learned, how recurrence and confidence moved.
 *
 * One Bedrock embedding per request (reused for both reads). Bounded by the
 * cluster's GC window; beyond it the request fails with a clear message.
 */

const MAX_QUERY_CHARS = 300;
const MAX_MINUTES = 1_380; // ~23h — inside the default ~25h GC window
const EPISODE_LIMIT = 5;
const RUNBOOK_LIMIT = 3;

const PER_MIN = 6;
const PER_DAY = 60;
const GLOBAL_PER_DAY = 600;

interface EpisodeHit {
  id: string;
  title: string;
  region: string;
  distance: number;
  occurrences: number;
  signature: string;
}
interface RunbookHit {
  id: string;
  title: string;
  origin: string;
  confidence: number;
  distance: number;
}
interface RecallFrame {
  at: string;
  totalMemories: number;
  episodes: EpisodeHit[];
  runbooks: RunbookHit[];
}

function vectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

async function recallFrame(vec: string, secondsAgo: number | null): Promise<RecallFrame> {
  const client = await getPool().connect();
  try {
    await client.query(
      secondsAgo ? `BEGIN; SET TRANSACTION AS OF SYSTEM TIME '-${Math.floor(secondsAgo)}s'` : "BEGIN",
    );
    const [atRes, totalRes, epRes, rbRes] = [
      await client.query(`SELECT now()::string AS at`),
      await client.query(
        `SELECT (SELECT count(*) FROM incidents)
              + (SELECT count(*) FROM runbooks)
              + (SELECT count(*) FROM agent_memory)
              + (SELECT count(*) FROM agent_stream) AS total`,
      ),
      await client.query(
        `SELECT id, title, crdb_region::string AS region, embedding <-> $1 AS distance
           FROM incidents
          WHERE status = 'resolved' AND resolution IS NOT NULL
          ORDER BY embedding <-> $1
          LIMIT $2`,
        [vec, overfetchFor(EPISODE_LIMIT)],
      ),
      await client.query(
        `SELECT id, title, origin, confidence, embedding <-> $1 AS distance
           FROM runbooks
          WHERE status = 'active'
          ORDER BY embedding <-> $1
          LIMIT $2`,
        [vec, RUNBOOK_LIMIT * 3],
      ),
    ];
    await client.query("COMMIT");

    const episodes = consolidateEpisodes(
      epRes.rows.map((r: { id: string; title: string; region: string; distance: string | number }) => ({
        distance: Number(r.distance),
        signature: episodeSignature(String(r.title)),
        row: r,
      })),
      EPISODE_LIMIT,
    ).map((c) => ({
      id: String(c.representative.row.id),
      title: String(c.representative.row.title),
      region: String(c.representative.row.region),
      distance: Number(c.representative.distance.toFixed(3)),
      occurrences: c.occurrences,
      signature: c.representative.signature,
    }));

    // Same hygiene-aware re-rank the live recall uses: distance discounted by
    // confidence, so probationary learned knowledge ranks below proven fixes.
    const runbooks = rbRes.rows
      .map((r: { id: string; title: string; origin: string; confidence: string | number; distance: string | number }) => ({
        id: String(r.id),
        title: String(r.title),
        origin: String(r.origin),
        confidence: Number(r.confidence),
        distance: Number(Number(r.distance).toFixed(3)),
      }))
      .sort(
        (a: RunbookHit, b: RunbookHit) =>
          a.distance * (1 - 0.2 * (a.confidence - 0.5)) -
          b.distance * (1 - 0.2 * (b.confidence - 0.5)),
      )
      .slice(0, RUNBOOK_LIMIT);

    return {
      at: String(atRes.rows[0]?.at ?? ""),
      totalMemories: Number(totalRes.rows[0]?.total ?? 0),
      episodes,
      runbooks,
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // connection may be gone
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function POST(req: NextRequest) {
  if (isMock()) {
    return NextResponse.json({ error: "forensics unavailable in mock mode" }, { status: 503 });
  }

  const key = clientKey(req.headers);
  try {
    const [m, d, g] = await Promise.all([
      hitRateLimit(`forensics:min:${key}`, PER_MIN, 60),
      hitRateLimit(`forensics:day:${key}`, PER_DAY, 86_400),
      hitRateLimit(`forensics:global:day`, GLOBAL_PER_DAY, 86_400),
    ]);
    if (!m.ok || !d.ok || !g.ok) {
      return NextResponse.json({ error: "rate limited — try again shortly" }, { status: 429 });
    }
  } catch {
    if (!rateLimit(`forensics:${key}`).ok) {
      return NextResponse.json({ error: "rate limited" }, { status: 429 });
    }
  }

  let query: string;
  let minutesAgo: number;
  try {
    const body = await req.json();
    query = String(body?.query ?? "").trim();
    minutesAgo = Math.floor(Number(body?.minutesAgo));
  } catch {
    return NextResponse.json(
      { error: "body must be JSON: { query, minutesAgo }" },
      { status: 400 },
    );
  }
  if (!query || query.length < 3 || query.length > MAX_QUERY_CHARS) {
    return NextResponse.json(
      { error: `query must be 3–${MAX_QUERY_CHARS} characters` },
      { status: 400 },
    );
  }
  if (!Number.isFinite(minutesAgo) || minutesAgo < 1 || minutesAgo > MAX_MINUTES) {
    return NextResponse.json(
      { error: `minutesAgo must be 1–${MAX_MINUTES}` },
      { status: 400 },
    );
  }

  try {
    const vec = vectorLiteral(await embed(query));
    const [then, now] = [
      await recallFrame(vec, minutesAgo * 60),
      await recallFrame(vec, null),
    ];

    const thenEp = new Map(then.episodes.map((e) => [e.signature, e]));
    const nowEp = new Map(now.episodes.map((e) => [e.signature, e]));
    const thenRb = new Map(then.runbooks.map((r) => [r.id, r]));
    const nowRb = new Map(now.runbooks.map((r) => [r.id, r]));

    const diff = {
      memoriesAdded: now.totalMemories - then.totalMemories,
      newEpisodes: now.episodes.filter((e) => !thenEp.has(e.signature)).map((e) => e.signature),
      vanishedEpisodes: then.episodes.filter((e) => !nowEp.has(e.signature)).map((e) => e.signature),
      recurrenceChanges: now.episodes
        .filter((e) => thenEp.has(e.signature) && thenEp.get(e.signature)!.occurrences !== e.occurrences)
        .map((e) => ({
          signature: e.signature,
          then: thenEp.get(e.signature)!.occurrences,
          now: e.occurrences,
        })),
      newRunbooks: now.runbooks.filter((r) => !thenRb.has(r.id)).map((r) => r.id),
      vanishedRunbooks: then.runbooks.filter((r) => !nowRb.has(r.id)).map((r) => r.id),
      confidenceChanges: now.runbooks
        .filter((r) => thenRb.has(r.id) && thenRb.get(r.id)!.confidence !== r.confidence)
        .map((r) => ({ id: r.id, then: thenRb.get(r.id)!.confidence, now: r.confidence })),
    };

    return NextResponse.json({ query, minutesAgo, then, now, diff });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/garbage collection|gc threshold|batch timestamp/i.test(msg)) {
      return NextResponse.json(
        { error: "that moment is beyond the cluster's recall horizon (GC window) — pick a more recent time" },
        { status: 400 },
      );
    }
    console.error("[/api/forensics]", err);
    return NextResponse.json({ error: "replay failed" }, { status: 500 });
  }
}
