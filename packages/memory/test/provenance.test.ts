import { describe, expect, test } from "vitest";
import { PUBLIC_POSTMORTEMS, publicPostmortemSource } from "@blackbox/memory";

describe("publicPostmortemSource (evidence provenance)", () => {
  const signals = {
    source: "public-postmortem",
    company: "GitLab",
    url: "https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/",
    year: 2017,
  };

  test("extracts company and url from a postmortem signals object", () => {
    expect(publicPostmortemSource(signals)).toEqual({
      company: "GitLab",
      url: signals.url,
    });
  });

  test("accepts signals stored as a JSON string (jsonb round-trip)", () => {
    expect(publicPostmortemSource(JSON.stringify(signals))).toEqual({
      company: "GitLab",
      url: signals.url,
    });
  });

  test("returns null for non-postmortem or malformed signals", () => {
    expect(publicPostmortemSource(null)).toBeNull();
    expect(publicPostmortemSource(undefined)).toBeNull();
    expect(publicPostmortemSource("not json")).toBeNull();
    expect(publicPostmortemSource({ source: "alert", url: "https://x.test" })).toBeNull();
    expect(publicPostmortemSource({ source: "public-postmortem", company: "X" })).toBeNull();
  });

  test("rejects non-https urls — this value lands in an <a href>", () => {
    expect(
      publicPostmortemSource({ ...signals, url: "javascript:alert(1)" }),
    ).toBeNull();
    expect(publicPostmortemSource({ ...signals, url: "http://insecure.example" })).toBeNull();
  });
});

describe("PUBLIC_POSTMORTEMS corpus", () => {
  test("every entry is complete, dated, and https-linked", () => {
    expect(PUBLIC_POSTMORTEMS.length).toBeGreaterThanOrEqual(20);
    for (const pm of PUBLIC_POSTMORTEMS) {
      expect(pm.company.length).toBeGreaterThan(1);
      expect(pm.title.length).toBeGreaterThan(10);
      expect(pm.summary.length).toBeGreaterThan(50);
      expect(pm.resolution.length).toBeGreaterThan(30);
      expect(pm.url.startsWith("https://")).toBe(true);
      expect(pm.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["SEV1", "SEV2", "SEV3", "SEV4"]).toContain(pm.severity);
    }
  });

  test("source urls are unique (ingest idempotency key)", () => {
    const urls = PUBLIC_POSTMORTEMS.map((p) => p.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});
