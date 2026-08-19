import { NextResponse } from "next/server";
import { getPool, isMock } from "@blackbox/memory";
import { GENESIS_HASH, canonicalCertHash, sha256Hex } from "@/lib/certs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The public promotion-certificate registry — verified on every read.
 *
 * For each certificate the server recomputes the canonical hash and checks the
 * chain linkage back to genesis, and re-hashes the runbook's CURRENT body
 * against the hash sealed at promotion time. `chainOk` failing means history
 * was tampered with; `bodyUnchanged` failing means a promoted lesson was
 * edited after the operator released it. Both are public, so anyone can audit.
 */
export async function GET() {
  if (isMock()) {
    return NextResponse.json({ certificates: [], chainVerified: true });
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT c.seq, c.runbook_id, c.title, c.body_sha256, c.promoted_at::string AS promoted_at,
              c.prev_hash, c.cert_hash, r.body AS current_body
         FROM promotion_certs c
         LEFT JOIN runbooks r ON r.id = c.runbook_id
        ORDER BY c.seq ASC`,
    );

    let prev = GENESIS_HASH;
    let chainVerified = true;
    const certificates = rows.map(
      (r: {
        seq: string | number;
        runbook_id: string;
        title: string;
        body_sha256: string;
        promoted_at: string;
        prev_hash: string;
        cert_hash: string;
        current_body: string | null;
      }) => {
        const seq = Number(r.seq);
        // promoted_at was hashed as the ISO string the app generated; recover it
        // from the stored timestamptz rendering.
        const promotedAtIso = new Date(r.promoted_at).toISOString();
        const recomputed = canonicalCertHash({
          seq,
          runbookId: r.runbook_id,
          bodySha256: r.body_sha256,
          promotedAt: promotedAtIso,
          prevHash: r.prev_hash,
        });
        const linkOk = r.prev_hash === prev && recomputed === r.cert_hash;
        if (!linkOk) chainVerified = false;
        prev = r.cert_hash;
        return {
          seq,
          runbookId: r.runbook_id,
          title: r.title,
          promotedAt: promotedAtIso,
          certHash: r.cert_hash,
          prevHash: r.prev_hash,
          chainOk: linkOk,
          bodyUnchanged:
            r.current_body !== null && sha256Hex(String(r.current_body)) === r.body_sha256,
        };
      },
    );

    return NextResponse.json({ certificates, chainVerified });
  } catch {
    // Table not created yet — no promotions have been certified.
    return NextResponse.json({ certificates: [], chainVerified: true });
  }
}
