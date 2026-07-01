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

  test("lists the seeded fleet and resolves services by name", async () => {
    const services = await mem.listServices();
    expect(services.map((s) => s.name)).toContain("checkout-api");

    // Existing name resolves to the same record.
    const existing = await mem.resolveService("checkout-api");
    expect(services.find((s) => s.name === "checkout-api")?.id).toBe(existing.id);

    // Unknown name is created (normalized), then reused.
    const created = await mem.resolveService("  NEW-Service  ");
    expect(created.name).toBe("new-service");
    const again = await mem.resolveService("new-service");
    expect(again.id).toBe(created.id);
  });

  test("recentMemories returns newest first", async () => {
    await mem.remember({ sessionId: "s-recent", kind: "action", content: "older entry" });
    await mem.remember({ sessionId: "s-recent", kind: "action", content: "newer entry" });
    const rows = await mem.recentMemories(5, "s-recent");
    expect(rows[0]!.content).toBe("newer entry");
    expect(rows[1]!.content).toBe("older entry");
  });

  test("getIncident round-trips a recorded incident", async () => {
    const inc = await mem.recordIncident({
      serviceId: "svc-x",
      title: "lookup test",
      summary: "s",
      severity: "SEV3",
    });
    const found = await mem.getIncident(inc.id);
    expect(found?.title).toBe("lookup test");
    expect(await mem.getIncident("00000000-0000-0000-0000-000000000000")).toBeNull();
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
