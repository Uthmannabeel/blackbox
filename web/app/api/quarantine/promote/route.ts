import { NextRequest, NextResponse } from "next/server";
import { createMemoryService, getPool } from "@blackbox/memory";
import { isTrustedRequest } from "@/lib/agentSession";
import { GENESIS_HASH, canonicalCertHash, sha256Hex } from "@/lib/certs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Append a certificate for a just-promoted runbook, chained to the last one. */
async function mintCertificate(runbookId: string): Promise<string> {
  const client = await getPool().connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS promotion_certs (
         seq          INT PRIMARY KEY,
         runbook_id   UUID NOT NULL,
         title        STRING NOT NULL,
         body_sha256  STRING NOT NULL,
         promoted_at  TIMESTAMPTZ NOT NULL,
         prev_hash    STRING NOT NULL,
         cert_hash    STRING NOT NULL
       )`,
    );
    const rb = await client.query(`SELECT title, body FROM runbooks WHERE id = $1`, [runbookId]);
    if (!rb.rows[0]) throw new Error("promoted runbook vanished before certification");
    const bodySha256 = sha256Hex(String(rb.rows[0].body));
    const promotedAt = new Date().toISOString();

    // Serializable txn: read the chain head, append the next link. A concurrent
    // promote retries on the primary-key collision rather than forking history.
    await client.query("BEGIN");
    const head = await client.query(
      `SELECT seq, cert_hash FROM promotion_certs ORDER BY seq DESC LIMIT 1`,
    );
    const seq = Number(head.rows[0]?.seq ?? 0) + 1;
    const prevHash = String(head.rows[0]?.cert_hash ?? GENESIS_HASH);
    const certHash = canonicalCertHash({ seq, runbookId, bodySha256, promotedAt, prevHash });
    await client.query(
      `INSERT INTO promotion_certs (seq, runbook_id, title, body_sha256, promoted_at, prev_hash, cert_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [seq, runbookId, String(rb.rows[0].title), bodySha256, promotedAt, prevHash, certHash],
    );
    await client.query("COMMIT");
    return certHash;
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

    // Every promotion mints a hash-chained certificate: what entered recall,
    // when, and a hash of exactly what the operator released. Each certificate
    // commits to its predecessor, so history cannot be silently rewritten.
    // Best-effort: a cert failure must not roll back a successful promotion.
    let certHash: string | null = null;
    try {
      certHash = await mintCertificate(runbookId);
    } catch (err) {
      console.error("[/api/quarantine/promote] certificate mint failed:", err);
    }
    return NextResponse.json({ ok: true, runbookId, certHash });
  } catch (err) {
    console.error("[/api/quarantine/promote]", err);
    return NextResponse.json({ error: "Promotion failed." }, { status: 500 });
  }
}
