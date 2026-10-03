import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: "src",
    include: ["__tests__/**/*.test.ts"],
    setupFiles: ["./__tests__/setup.ts"],
    // The background freshness check makes a network call; tests that count
    // fetches opt in explicitly (freshness.test.ts).
    env: { SOCIALCRAWL_FRESHNESS_CHECK: "off" },
  },
});
