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
  test("uses only the platform-trusted x-real-ip", () => {
    const h = new Headers({ "x-real-ip": "203.0.113.9" });
    expect(clientKey(h)).toBe("203.0.113.9");
  });

  test("ignores spoofable x-forwarded-for so it can't be rotated to bypass limits", () => {
    // A client can prepend arbitrary values to x-forwarded-for; it must not
    // become the rate-limit identity.
    const h = new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    expect(clientKey(h)).toBe("shared");
  });

  test("fails closed to a shared bucket when no trusted IP is present", () => {
    expect(clientKey(new Headers())).toBe("shared");
  });
});
