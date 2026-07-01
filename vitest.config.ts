import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run the whole suite in offline mock mode: no CockroachDB/Bedrock needed.
    env: { BLACKBOX_MOCK: "1" },
    environment: "node",
    include: ["packages/**/test/**/*.test.ts", "web/test/**/*.test.ts"],
    // Tests exercise real recall over the seeded in-memory store.
    testTimeout: 15_000,
  },
});
