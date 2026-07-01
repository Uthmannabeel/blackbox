import { describe, expect, test } from "vitest";
import { embed, EMBED_DIM } from "@blackbox/memory";

// Runs in mock mode (vitest env BLACKBOX_MOCK=1), so embed() is deterministic.
describe("embeddings (mock)", () => {
  test("returns a unit-normalized vector of the expected dimension", async () => {
    // Arrange / Act
    const v = await embed("connection pool exhaustion on checkout");

    // Assert
    expect(v).toHaveLength(EMBED_DIM);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  test("is deterministic for the same input", async () => {
    const a = await embed("payment webhook dropped during failover");
    const b = await embed("payment webhook dropped during failover");
    expect(a).toEqual(b);
  });

  test("similar text is closer than unrelated text (L2)", async () => {
    const query = await embed("latency spike, connections maxed out");
    const near = await embed("high latency because the connection pool is exhausted");
    const far = await embed("duplicate push notifications from retry storm");

    const l2 = (x: number[], y: number[]) =>
      Math.sqrt(x.reduce((s, xi, i) => s + (xi - y[i]!) ** 2, 0));

    expect(l2(query, near)).toBeLessThan(l2(query, far));
  });
});
