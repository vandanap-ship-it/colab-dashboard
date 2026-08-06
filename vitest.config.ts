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
      // Next.js's "server-only" package is a build-time guard against client
      // bundling. It has no runtime behaviour and Vitest can't resolve it —
      // stub with an empty module so tests can import server-side lib files.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
});
