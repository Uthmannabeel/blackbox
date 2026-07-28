import { beforeAll, describe, expect, test } from "vitest";
import {
  CONFIDENCE,
  MockMemoryService,
  classifyLearnedWrite,
  gateRunbookContent,
  tokenOverlap,
} from "@blackbox/memory";

const GOOD_FIX =
  "Raised the pgbouncer pool ceiling from 200 to 400 connections, recycled stuck backends, " +
  "and added an alert on pool saturation above 80 percent so this pages before it saturates.";

describe("gateRunbookContent (write-path filter)", () => {
  test("accepts a substantive fix", () => {
    expect(gateRunbookContent(GOOD_FIX).ok).toBe(true);
  });

  test("rejects content too short to be a reusable fix", () => {
    const r = gateRunbookContent("restarted it");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("too short");
  });

  test("rejects questions posing as resolutions", () => {
    const r = gateRunbookContent("Should we maybe raise the connection pool limit for checkout-api next time?");
    expect(r.ok).toBe(false);
  });

  test("rejects unresolved uncertainty", () => {
    const r = gateRunbookContent(
      "The latency recovered on its own after twenty minutes but I'm not sure what actually caused it to spike.",
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("uncertainty");
  });

  test("rejects failure narrations", () => {
    const r = gateRunbookContent(
      "We were unable to resolve the root cause; the errors continued until traffic dropped off after the evening peak.",
    );
    expect(r.ok).toBe(false);
  });
});

describe("tokenOverlap", () => {
  test("identical texts overlap fully", () => {
    expect(tokenOverlap(GOOD_FIX, GOOD_FIX)).toBe(1);
  });

  test("unrelated texts barely overlap", () => {
    expect(
      tokenOverlap("rotate the tls certificates on the ingress", "increase kafka consumer group partitions"),
    ).toBeLessThan(0.1);
  });
});

describe("classifyLearnedWrite", () => {
  test("no neighbour -> insert", () => {
    expect(classifyLearnedWrite(null, GOOD_FIX).kind).toBe("insert");
  });

  test("very close neighbour -> merge", () => {
    expect(classifyLearnedWrite({ distance: 0.2, body: GOOD_FIX }, GOOD_FIX).kind).toBe("merge");
  });

  test("similar situation with a different fix -> contradiction", () => {
    const other = "Scale down the deployment and roll back to the previous image tag immediately.";
    expect(classifyLearnedWrite({ distance: 0.6, body: other }, GOOD_FIX).kind).toBe("contradiction");
  });

  test("distant neighbour -> insert", () => {
    expect(classifyLearnedWrite({ distance: 1.1, body: "unrelated" }, GOOD_FIX).kind).toBe("insert");
  });
});

describe("MockMemoryService hygiene (end-to-end parity)", () => {
  let mem: MockMemoryService;

  beforeAll(() => {
    mem = new MockMemoryService();
  });

  test("rejected writes never reach procedural memory", async () => {
    const before = (await mem.recallRunbooks("anything at all", 50)).length;
    const outcome = await mem.commitLearnedRunbook({
      incidentId: "inc-1",
      title: "Learned runbook: mystery outage",
      body: "no idea",
    });
    expect(outcome.action).toBe("rejected");
    const after = (await mem.recallRunbooks("anything at all", 50)).length;
    expect(after).toBe(before);
    const events = await mem.recentHygieneEvents(5);
    expect(events[0]!.action).toBe("rejected");
  });

  test("re-learning the same fix consolidates instead of duplicating", async () => {
    const first = await mem.commitLearnedRunbook({
      incidentId: "inc-2",
      trusted: true,
      title: "Learned runbook: search-index shard hotspot",
      body:
        "Rebalanced the hot search-index shard by splitting it and moving replicas to the underloaded nodes, " +
        "then enabled the shard-size alert to catch hotspots early.",
    });
    expect(first.action).toBe("accepted");

    const second = await mem.commitLearnedRunbook({
      incidentId: "inc-3",
      trusted: true,
      title: "Learned runbook: search-index shard hotspot",
      body:
        "Rebalanced the hot search-index shard by splitting it and moving replicas to the underloaded nodes, " +
        "then enabled the shard-size alert to catch hotspots early.",
    });
    expect(second.action).toBe("merged");
    expect(second.runbookId).toBe(first.runbookId);
  });

  test("reinforcement raises confidence of recalled runbooks", async () => {
    const outcome = await mem.commitLearnedRunbook({
      incidentId: "inc-4",
      trusted: true,
      title: "Learned runbook: dns resolver flapping",
      body:
        "Pinned the resolver to the healthy anycast pool and doubled the negative-cache ttl so flapping " +
        "upstream answers stop churning connections during regional dns instability.",
    });
    expect(outcome.action).toBe("accepted");
    const n = await mem.reinforceRunbooks([outcome.runbookId!]);
    expect(n).toBe(1);
    const hits = await mem.recallRunbooks("dns resolver flapping anycast negative cache", 3);
    const found = hits.find((h) => h.item.id === outcome.runbookId)!;
    expect(found.item.confidence).toBeCloseTo(CONFIDENCE.learned + CONFIDENCE.reinforceStep, 5);
    expect(found.item.reinforcedCount).toBe(1);
  });

  test("decay archives learned knowledge that never earned trust", async () => {
    const isolated = new MockMemoryService();
    const outcome = await isolated.commitLearnedRunbook({
      incidentId: "inc-5",
      trusted: true,
      title: "Learned runbook: one-off cache stampede",
      body:
        "Added a request-coalescing lock in front of the recommendations cache so a cold key is computed " +
        "once instead of by every concurrent request during the stampede.",
    });
    expect(outcome.action).toBe("accepted");
    // Decay repeatedly (mock has no clock); unused learned knowledge sinks and archives.
    let archivedTotal = 0;
    for (let i = 0; i < 10; i++) {
      const { archived } = await isolated.decayRunbooks();
      archivedTotal += archived;
    }
    expect(archivedTotal).toBeGreaterThan(0);
    const hits = await isolated.recallRunbooks("cache stampede coalescing lock", 50);
    expect(hits.find((h) => h.item.id === outcome.runbookId)).toBeUndefined();
  });

  test("curated runbooks never decay", async () => {
    const isolated = new MockMemoryService();
    for (let i = 0; i < 10; i++) await isolated.decayRunbooks();
    const hits = await isolated.recallRunbooks("connections maxed out, high latency", 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.item.source).toBe("curated");
  });
});

describe("trust boundary (unauthenticated writes cannot reach recall)", () => {
  const FIX =
    "Failed over the payments shard to the standby replica, replayed the write-ahead log gap, " +
    "and added a lag alert at thirty seconds so the divergence pages before it compounds.";

  test("an untrusted write is quarantined, not accepted", async () => {
    const mem = new MockMemoryService();
    const outcome = await mem.commitLearnedRunbook({
      incidentId: "inc-anon",
      title: "Learned runbook: payments shard divergence",
      body: FIX,
    });
    expect(outcome.action).toBe("quarantined");
    expect(outcome.runbookId).toBeTruthy();
  });

  test("quarantined knowledge is invisible to recall but visible to audit", async () => {
    const mem = new MockMemoryService();
    const outcome = await mem.commitLearnedRunbook({
      incidentId: "inc-anon",
      title: "Learned runbook: payments shard divergence",
      body: FIX,
    });
    const hits = await mem.recallRunbooks("payments shard divergence replica lag", 50);
    expect(hits.some((h) => h.item.id === outcome.runbookId)).toBe(false);

    const pending = await mem.listQuarantined();
    expect(pending.map((r) => r.id)).toContain(outcome.runbookId);
    expect(pending[0]!.origin).toBe("anonymous");

    const events = await mem.recentHygieneEvents(5);
    expect(events[0]!.action).toBe("quarantined");
  });

  test("promotion by an operator releases it into recall", async () => {
    const mem = new MockMemoryService();
    const outcome = await mem.commitLearnedRunbook({
      incidentId: "inc-anon",
      title: "Learned runbook: payments shard divergence",
      body: FIX,
    });
    expect(await mem.promoteRunbook(outcome.runbookId!)).toBe(true);

    const hits = await mem.recallRunbooks("payments shard divergence replica lag", 50);
    expect(hits.some((h) => h.item.id === outcome.runbookId)).toBe(true);
    expect(await mem.listQuarantined()).toHaveLength(0);
    // Promoting twice is a no-op, not a second promotion.
    expect(await mem.promoteRunbook(outcome.runbookId!)).toBe(false);
  });

  test("an untrusted write cannot reinforce existing trusted knowledge", async () => {
    const mem = new MockMemoryService();
    const trusted = await mem.commitLearnedRunbook({
      incidentId: "inc-t",
      title: "Learned runbook: payments shard divergence",
      body: FIX,
      trusted: true,
    });
    expect(trusted.action).toBe("accepted");

    // Same text again, this time anonymously. Under the old code this took the
    // merge branch and bumped the existing runbook's confidence — an
    // unauthenticated visitor influencing everyone else's ranking.
    const anon = await mem.commitLearnedRunbook({
      incidentId: "inc-a",
      title: "Learned runbook: payments shard divergence",
      body: FIX,
    });
    expect(anon.action).toBe("quarantined");

    const hits = await mem.recallRunbooks("payments shard divergence replica lag", 50);
    const original = hits.find((h) => h.item.id === trusted.runbookId)!;
    expect(original.item.reinforcedCount).toBe(0);
    expect(original.item.confidence).toBeCloseTo(CONFIDENCE.learned, 5);
  });
});

describe("completeIncident (atomic learning loop)", () => {
  test("resolves, distils, reinforces and reflects in one unit", async () => {
    const mem = new MockMemoryService();
    const svc = await mem.resolveService("payments-api");
    const inc = await mem.recordIncident({
      serviceId: svc.id,
      title: "payments-api pool exhaustion",
      summary: "Connections maxed out under burst load.",
      severity: "SEV2",
    });
    const runbooks = await mem.recallRunbooks("connections maxed out, high latency", 1);

    const out = await mem.completeIncident({
      incidentId: inc.id,
      resolution:
        "Raised the pgbouncer pool ceiling from 200 to 400 connections and added a saturation alert at 80 percent.",
      sessionId: "00000000-0000-4000-8000-00000000abcd",
      recalledRunbookIds: runbooks.map((r) => r.item.id),
      trusted: true,
    });

    expect(out.learn.action).toBe("accepted");
    expect(out.reinforced).toBe(runbooks.length);
    expect(out.reflectionId).toBeTruthy();

    // All four effects are observable together.
    expect((await mem.getIncident(inc.id))!.status).toBe("resolved");
    const recalled = await mem.recallMemories("pgbouncer pool ceiling saturation", 5);
    expect(recalled.some((h) => h.item.kind === "reflection")).toBe(true);
  });

  test("a failed step leaves no partial lesson behind", async () => {
    const mem = new MockMemoryService();
    const svc = await mem.resolveService("payments-api");
    const inc = await mem.recordIncident({
      serviceId: svc.id,
      title: "payments-api pool exhaustion",
      summary: "Connections maxed out under burst load.",
      severity: "SEV2",
    });
    const runbooksBefore = (await mem.recallRunbooks("anything", 50)).length;

    // Force the last step to throw, after the runbook has already been written.
    const boom = new Error("bedrock unavailable");
    const original = mem.remember.bind(mem);
    (mem as unknown as { remember: unknown }).remember = async () => {
      throw boom;
    };

    await expect(
      mem.completeIncident({
        incidentId: inc.id,
        resolution:
          "Raised the pgbouncer pool ceiling from 200 to 400 connections and added a saturation alert at 80 percent.",
        sessionId: "00000000-0000-4000-8000-00000000abce",
        recalledRunbookIds: [],
        trusted: true,
      }),
    ).rejects.toThrow(boom);

    (mem as unknown as { remember: typeof original }).remember = original;

    // Nothing partially applied: no orphan runbook, incident not left resolved
    // with a lesson that was never recorded.
    expect((await mem.recallRunbooks("anything", 50)).length).toBe(runbooksBefore);
    expect((await mem.getIncident(inc.id))!.status).toBe("open");
  });
});
