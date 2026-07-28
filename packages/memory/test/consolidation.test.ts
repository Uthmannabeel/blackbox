import { describe, expect, test } from "vitest";
import { consolidateEpisodes, episodeSignature, l2 } from "@blackbox/memory";

/**
 * Consolidation exists because a real fleet repeats itself: on the live corpus
 * a top-5 nearest-neighbour search for "connection pool exhaustion" returned
 * five copies of one templated incident differing only in a p99 number. The
 * agent got one lesson five times and the evidence ledger looked padded.
 */

function candidate(signature: string, distance: number, embedding?: number[]) {
  return { signature, distance, ...(embedding ? { embedding } : {}) };
}

describe("episodeSignature", () => {
  test("elides the numbers that distinguish repeats of one failure mode", () => {
    expect(episodeSignature("checkout-api p99 latency spike to 5s from connection pool exhaustion")).toBe(
      episodeSignature("checkout-api p99 latency spike to 29s from connection pool exhaustion"),
    );
  });

  test("keeps genuinely different incidents apart", () => {
    expect(episodeSignature("GitLab (2017): database outage after accidental deletion")).not.toBe(
      episodeSignature("Cloudflare (2019): global CPU exhaustion from a WAF regex"),
    );
  });

  test("is stable across punctuation and casing noise", () => {
    expect(episodeSignature("Search-Indexer  cache STAMPEDE overloaded s3!!")).toBe(
      episodeSignature("search indexer cache stampede overloaded s3"),
    );
  });
});

describe("consolidateEpisodes", () => {
  test("collapses repeats into one representative and counts recurrence", () => {
    const repeats = Array.from({ length: 7 }, (_, i) =>
      candidate(episodeSignature(`checkout-api p99 spike to ${i}s from pool exhaustion`), 0.7 + i * 0.001),
    );
    const out = consolidateEpisodes(repeats, 5);
    expect(out).toHaveLength(1);
    expect(out[0]!.occurrences).toBe(7);
  });

  test("keeps the NEAREST member as the representative", () => {
    const sig = episodeSignature("checkout-api p99 spike from pool exhaustion");
    const out = consolidateEpisodes(
      [candidate(sig, 0.61), candidate(sig, 0.74), candidate(sig, 0.9)],
      5,
    );
    expect(out[0]!.representative.distance).toBe(0.61);
  });

  test("returns `limit` DISTINCT episodes rather than `limit` rows", () => {
    const dup = episodeSignature("checkout-api p99 spike from pool exhaustion");
    const candidates = [
      candidate(dup, 0.70),
      candidate(dup, 0.71),
      candidate(dup, 0.72),
      candidate(dup, 0.73),
      candidate(dup, 0.74),
      candidate(episodeSignature("GitLab 2017 database deletion"), 0.88),
      candidate(episodeSignature("Cloudflare 2019 WAF regex CPU exhaustion"), 0.89),
    ];
    const out = consolidateEpisodes(candidates, 5);
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.occurrences)).toEqual([5, 1, 1]);
  });

  test("distinct one-off incidents are never merged", () => {
    const out = consolidateEpisodes(
      [
        candidate(episodeSignature("GitLab 2017 database deletion"), 0.88),
        candidate(episodeSignature("AWS S3 2017 us-east-1 disruption"), 0.94),
        candidate(episodeSignature("Meta 2021 BGP backbone withdrawal"), 1.05),
      ],
      5,
    );
    expect(out).toHaveLength(3);
    expect(out.every((c) => c.occurrences === 1)).toBe(true);
  });

  test("prefers embedding distance over the title signature when vectors exist", () => {
    // Different titles, near-identical vectors -> still one episode.
    const a = [1, 0, 0];
    const b = [0.999, 0.0447, 0];
    const out = consolidateEpisodes(
      [candidate("alpha", 0.5, a), candidate("beta", 0.52, b)],
      5,
    );
    expect(out).toHaveLength(1);
    expect(l2(a, b)).toBeLessThan(0.15);
  });

  test("empty input yields empty output", () => {
    expect(consolidateEpisodes([], 5)).toEqual([]);
  });
});
