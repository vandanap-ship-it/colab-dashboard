import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests (tests/unit) cover pure logic with no DB. Integration tests
// (tests/integration) spin up a throwaway SQLite DB from prisma/schema.sql and
// exercise the real DB-backed functions. E2E tests live under tests/e2e and run
// via Playwright.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    // Integration tests rebuild the schema + seed; give them room.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
