import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests for pure logic (no DB, no browser). E2E tests live separately
// under tests/e2e and run via Playwright.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
