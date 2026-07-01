import { describe, expect, test } from "vitest";
import { rateLimit, clientKey } from "../lib/rateLimit";

describe("rateLimit", () => {
  test("allows up to the limit, then blocks with a Retry-After", () => {
    const key = "test-ip-1";
    const now = 1_000_000;
    let last;
    for (let i = 0; i < 20; i++) last = rateLimit(key, now);
    expect(last!.ok).toBe(true);

    const blocked = rateLimit(key, now);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("resets after the window elapses", () => {
    const key = "test-ip-2";
    const start = 2_000_000;
    for (let i = 0; i < 20; i++) rateLimit(key, start);
    expect(rateLimit(key, start).ok).toBe(false);

    // Advance past the 60s window.
    const later = start + 61_000;
    expect(rateLimit(key, later).ok).toBe(true);
  });
});

describe("clientKey", () => {
  test("prefers x-forwarded-for, falls back to the provided id", () => {
    const h1 = new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    expect(clientKey(h1, "session")).toBe("203.0.113.9");

    const h2 = new Headers();
    expect(clientKey(h2, "session-fallback")).toBe("session-fallback");
  });
});
