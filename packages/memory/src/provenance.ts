/**
 * Provenance extraction for episodic memories ingested from the public record.
 * Incidents ingested by scripts/ingestPostmortems.ts carry a signals payload of
 * `{ source: "public-postmortem", company, url, year }`; recall surfaces that
 * so the evidence ledger can link a memory back to the first-party postmortem.
 */

export interface PostmortemSource {
  company: string;
  url: string;
}

/** Returns the public-postmortem source of an incident's signals, or null. */
export function publicPostmortemSource(signals: unknown): PostmortemSource | null {
  let value = signals;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (o.source !== "public-postmortem") return null;
  if (typeof o.company !== "string" || typeof o.url !== "string") return null;
  // Only ever link out to https URLs — this lands in an <a href> in the console.
  if (!o.url.startsWith("https://")) return null;
  return { company: o.company, url: o.url };
}
