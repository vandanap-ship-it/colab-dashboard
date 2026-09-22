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
    // Unit tests import lib files that in turn import @/lib/prisma, whose
    // module-load guard throws when DATABASE_URL is missing. Setting a
    // valid-looking connection string lets the client be constructed
    // without touching the network — Prisma only actually connects on the
    // first query, which unit tests never issue. Integration tests
    // override this via their own setup with a real throwaway DB.
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://vitest:vitest@localhost:5432/vitest-not-actually-connected",
    },
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
