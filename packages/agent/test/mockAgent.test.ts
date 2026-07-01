import { describe, expect, test } from "vitest";
import { MockAgent } from "@blackbox/agent";

describe("MockAgent (offline reason/recall/act loop)", () => {
  test("recalls memory, opens an incident, and cites the matching past incident", async () => {
    const agent = new MockAgent({ sessionId: "test-session" });
    const { reply, events } = await agent.chat(
      "checkout-api p99 latency spiked to 8s and connections are maxed out",
    );

    // It recalled and acted.
    const toolNames = events.filter((e) => e.type === "tool_call").map((e) => e.tool);
    expect(toolNames).toContain("recall_similar_incidents");
    expect(toolNames).toContain("recall_runbooks");
    expect(toolNames).toContain("open_incident");
    expect(toolNames).toContain("update_incident_state");

    // It opened a current incident.
    expect(agent.currentIncidentId).toBeTruthy();

    // The reply cites institutional memory (the connection-pool incident).
    expect(reply.toLowerCase()).toContain("connection pool");
  });

  test("classifies a login outage as SEV1", async () => {
    const agent = new MockAgent({ sessionId: "sev-test" });
    const { events } = await agent.chat("users cannot login, auth-service is down");
    const open = events.find((e) => e.type === "tool_call" && e.tool === "open_incident");
    expect((open?.input as { severity: string }).severity).toBe("SEV1");
  });
});
