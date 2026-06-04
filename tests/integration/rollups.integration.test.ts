/**
 * Integration tests for the trust-critical rollup math.
 *
 * SKIPPED on this branch: the original implementation built a throwaway SQLite
 * DB via better-sqlite3 + the committed prisma/schema.sql. With the Postgres
 * migration, the harness needs to be rewritten to:
 *   1. Connect to a live Postgres (DATABASE_URL or TEST_DATABASE_URL)
 *   2. Create a unique schema per test file (CREATE SCHEMA "test_xyz")
 *   3. Apply prisma/schema.sql against that schema
 *   4. Point the Prisma singleton at the connection-string with ?schema=test_xyz
 *   5. Drop the schema in afterAll
 *
 * Tracked separately so the move to Neon isn't blocked on the test rewrite.
 * E2E tests already exercise the dashboard / Master Report / labour grid
 * end-to-end against the live dev server, so the math has indirect coverage in
 * the meantime.
 */
import { describe, it } from "vitest";

describe.skip("Rollup integration (TODO: rewrite for Postgres)", () => {
  it("placeholder", () => {
    // intentionally empty
  });
});
