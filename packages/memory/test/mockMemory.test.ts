import { beforeAll, describe, expect, test } from "vitest";
import { MockMemoryService } from "@blackbox/memory";

describe("MockMemoryService", () => {
  let mem: MockMemoryService;

  beforeAll(() => {
    mem = new MockMemoryService();
  });

  test("recalls the most relevant past incident for a situation", async () => {
    const hits = await mem.recallSimilarIncidents(
      "checkout p99 latency spiked and connections are maxed out",
      3,
    );
    expect(hits.length).toBeGreaterThan(0);
    // The connection-pool incident should rank first.
    expect(hits[0]!.item.title.toLowerCase()).toContain("connection pool");
    // Only resolved incidents with a resolution are recalled.
    expect(hits.every((h) => h.item.status === "resolved" && h.item.resolution)).toBe(true);
  });

  test("recalls a relevant runbook", async () => {
    const hits = await mem.recallRunbooks("connections maxed out, high latency", 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.item.title.toLowerCase()).toContain("pool");
  });

  test("remembers and recalls from the agent memory stream", async () => {
    await mem.remember({
      sessionId: "s1",
      kind: "observation",
      content: "The image-cdn origin returned 503s during a cache purge storm",
      importance: 0.9,
    });
    const hits = await mem.recallMemories("origin 5xx during cache purge", 5);
    expect(hits.some((h) => h.item.content.includes("cache purge storm"))).toBe(true);
  });

  test("assigns every memory a region (REGIONAL BY ROW simulation)", () => {
    const dist = mem.regionDistribution();
    expect(dist.map((d) => d.region)).toEqual([
      "aws-us-east-1",
      "aws-eu-west-1",
      "aws-ap-south-1",
    ]);
    expect(dist.reduce((s, d) => s + d.rows, 0)).toBeGreaterThan(0);
  });

  test("persists and reads back live incident state", async () => {
    const inc = await mem.recordIncident({
      serviceId: "svc",
      title: "test incident",
      summary: "something broke",
      severity: "SEV2",
    });
    await mem.updateIncidentState({
      incidentId: inc.id,
      phase: "diagnose",
      hypotheses: ["h1"],
      actionsTaken: [],
      nextSteps: ["step1"],
    });
    const state = await mem.getIncidentState(inc.id);
    expect(state?.phase).toBe("diagnose");
    expect(state?.hypotheses).toEqual(["h1"]);
  });
});
