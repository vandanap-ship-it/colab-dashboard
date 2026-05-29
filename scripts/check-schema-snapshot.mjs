/**
 * Drift guard for the hand-rolled migration system.
 *
 * This app applies schema changes in prod via raw SQL in
 * src/app/api/admin/migrate/route.ts — a second source of truth alongside
 * prisma/schema.prisma. To keep them from silently diverging, prisma/schema.sql
 * is a committed, Prisma-generated SQL snapshot of the *current* schema.
 *
 * This script regenerates that snapshot from schema.prisma and fails if it
 * differs from the committed copy. So you can't change the schema without the
 * change showing up as a reviewable SQL diff — which is the prompt to add the
 * matching migrate-endpoint entry.
 *
 * Run in CI; locally run `npm run schema:snapshot` to refresh after a schema edit.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SNAPSHOT = "prisma/schema.sql";

function generate() {
  // stdout = the SQL; stderr (Prisma's "Loaded config" chatter) is ignored.
  return execFileSync(
    "npx",
    ["prisma", "migrate", "diff", "--from-empty", "--to-schema", "prisma/schema.prisma", "--script"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
}

let committed;
try {
  committed = readFileSync(SNAPSHOT, "utf8");
} catch {
  console.error(`\n✖ ${SNAPSHOT} is missing. Run:  npm run schema:snapshot\n`);
  process.exit(1);
}

const fresh = generate();

if (fresh.trim() !== committed.trim()) {
  console.error(
    `\n✖ ${SNAPSHOT} is out of date with prisma/schema.prisma.\n\n` +
      `  The Prisma schema changed but the committed SQL snapshot wasn't refreshed.\n` +
      `  Fix:\n` +
      `    1. npm run schema:snapshot        # regenerate prisma/schema.sql\n` +
      `    2. add a matching migration entry in\n` +
      `       src/app/api/admin/migrate/route.ts (so prod actually gets the change)\n` +
      `    3. commit both\n`,
  );
  process.exit(1);
}

console.log(`✓ ${SNAPSHOT} is in sync with prisma/schema.prisma`);
