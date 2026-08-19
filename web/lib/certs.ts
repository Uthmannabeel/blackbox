import { createHash } from "node:crypto";

/**
 * Promotion certificates — shared canonical hashing.
 *
 * A certificate commits to: its chain position, the promoted runbook, a hash
 * of exactly the body that entered recall, the promotion instant, and the
 * previous certificate's hash. Recomputing the chain from seq 1 verifies that
 * no promotion has been altered, reordered, or silently removed.
 */

export const GENESIS_HASH = "0".repeat(64);

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function canonicalCertHash(input: {
  seq: number;
  runbookId: string;
  bodySha256: string;
  promotedAt: string;
  prevHash: string;
}): string {
  return sha256Hex(
    JSON.stringify({
      seq: input.seq,
      runbookId: input.runbookId,
      bodySha256: input.bodySha256,
      promotedAt: input.promotedAt,
      prevHash: input.prevHash,
    }),
  );
}
