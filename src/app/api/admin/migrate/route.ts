import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * One-shot, idempotent schema migrations for Postgres (Neon).
 *
 * GET  → returns which migrations are pending vs applied
 * POST → applies all pending migrations
 *
 * Strategy:
 *   - A single "baseline" migration reads prisma/schema.sql at runtime
 *     (the file is included in the deployed bundle via next.config's
 *     outputFileTracingIncludes). It contains the full Postgres schema.
 *   - Future incremental changes add a new entry to MIGRATIONS below with
 *     the ALTER TABLE etc. Postgres SQL.
 *   - Each migration runs inside a transaction so partial application can't
 *     leave the DB in a half-committed state.
 *
 * IMPORTANT — this is a second source of truth alongside prisma/schema.prisma.
 * When you change the schema you MUST keep both in step:
 *   1. edit prisma/schema.prisma
 *   2. run `npm run schema:snapshot` to refresh prisma/schema.sql
 *   3. add an incremental migration entry below with the equivalent ALTER SQL
 *   4. commit all three
 * CI's `schema:check` fails if schema.prisma changes without the SQL snapshot
 * being refreshed.
 */

type Migration = {
  key: string;
  sql: string[];
  describe: string;
};

/** Split a SQL script into individual statements. Trims, drops comments,
 *  preserves multi-line CREATE TABLE bodies. */
function splitStatements(sql: string): string[] {
  // Use a semicolon followed by a newline as the delimiter so semicolons inside
  // identifiers (rare in DDL anyway) don't break us up.
  return sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));
}

/** Make CREATE statements idempotent so a re-run of the baseline is a no-op. */
function makeIdempotent(stmt: string): string {
  // CREATE SCHEMA / TABLE / INDEX → add IF NOT EXISTS.
  if (/^CREATE SCHEMA(?!\s+IF NOT EXISTS)/i.test(stmt)) {
    return stmt.replace(/^CREATE SCHEMA/i, "CREATE SCHEMA IF NOT EXISTS");
  }
  if (/^CREATE TABLE(?!\s+IF NOT EXISTS)/i.test(stmt)) {
    return stmt.replace(/^CREATE TABLE/i, "CREATE TABLE IF NOT EXISTS");
  }
  if (/^CREATE UNIQUE INDEX(?!\s+IF NOT EXISTS)/i.test(stmt)) {
    return stmt.replace(/^CREATE UNIQUE INDEX/i, "CREATE UNIQUE INDEX IF NOT EXISTS");
  }
  if (/^CREATE INDEX(?!\s+IF NOT EXISTS)/i.test(stmt)) {
    return stmt.replace(/^CREATE INDEX/i, "CREATE INDEX IF NOT EXISTS");
  }
  return stmt;
}

/** Read & prepare the baseline SQL once at module load. Logged but non-fatal
 *  if the file can't be read — GET will surface the error to the admin. */
function loadBaselineSql(): string[] {
  try {
    const text = readFileSync(join(process.cwd(), "prisma", "schema.sql"), "utf8");
    return splitStatements(text).map(makeIdempotent);
  } catch (e) {
    console.error("[migrate] could not read prisma/schema.sql:", e);
    return [];
  }
}

const MIGRATIONS: Migration[] = [
  {
    key: "2026-06-04_postgres_baseline",
    sql: loadBaselineSql(),
    describe: "Initial Postgres schema (all tables, indexes, FKs).",
  },
  {
    key: "2026-06-05_inspection_item_passed_nullable",
    sql: [
      // Drop the NOT NULL on InspectionItem.passed so the form can represent
      // "untouched" as NULL (refused at submit). Existing rows are all true/
      // false already, so no backfill needed.
      `ALTER TABLE "InspectionItem" ALTER COLUMN "passed" DROP NOT NULL`,
    ],
    describe: "Allow InspectionItem.passed to be NULL (engineer hasn't ticked yet).",
  },
  {
    key: "2026-08-06_executive_dashboard",
    sql: [
      // New tables: Block, Villa, MilestoneSection, VillaMilestone
      `CREATE TABLE IF NOT EXISTS "Block" (
        "id" TEXT NOT NULL,
        "projectId" TEXT NOT NULL,
        "code" TEXT NOT NULL,
        "name" TEXT,
        "pod" TEXT,
        "orderIndex" INTEGER NOT NULL DEFAULT 0,
        "active" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "Block_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE TABLE IF NOT EXISTS "Villa" (
        "id" TEXT NOT NULL,
        "projectId" TEXT NOT NULL,
        "blockId" TEXT NOT NULL,
        "number" INTEGER NOT NULL,
        "villaType" TEXT,
        "inScope" BOOLEAN NOT NULL DEFAULT true,
        "unitCount" INTEGER NOT NULL DEFAULT 1,
        "label" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "Villa_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE TABLE IF NOT EXISTS "MilestoneSection" (
        "id" TEXT NOT NULL,
        "projectId" TEXT NOT NULL,
        "code" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "orderIndex" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "MilestoneSection_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE TABLE IF NOT EXISTS "VillaMilestone" (
        "id" TEXT NOT NULL,
        "villaId" TEXT NOT NULL,
        "sectionId" TEXT NOT NULL,
        "baselineStart" TIMESTAMP(3),
        "baselineFinish" TIMESTAMP(3),
        "actualStart" TIMESTAMP(3),
        "actualFinish" TIMESTAMP(3),
        "projectedFinish" TIMESTAMP(3),
        "pctComplete" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "delayReason" TEXT,
        "staleDays" INTEGER,
        "crmDate" TIMESTAMP(3),
        "crmDelay" INTEGER,
        "plannedCollection" DOUBLE PRECISION,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "VillaMilestone_pkey" PRIMARY KEY ("id")
      )`,
      // Unique + index constraints for the new tables
      `CREATE UNIQUE INDEX IF NOT EXISTS "Block_projectId_code_key" ON "Block"("projectId", "code")`,
      `CREATE INDEX IF NOT EXISTS "Block_projectId_idx" ON "Block"("projectId")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "Villa_projectId_number_key" ON "Villa"("projectId", "number")`,
      `CREATE INDEX IF NOT EXISTS "Villa_projectId_idx" ON "Villa"("projectId")`,
      `CREATE INDEX IF NOT EXISTS "Villa_blockId_idx" ON "Villa"("blockId")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "MilestoneSection_projectId_code_key" ON "MilestoneSection"("projectId", "code")`,
      `CREATE INDEX IF NOT EXISTS "MilestoneSection_projectId_idx" ON "MilestoneSection"("projectId")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "VillaMilestone_villaId_sectionId_key" ON "VillaMilestone"("villaId", "sectionId")`,
      `CREATE INDEX IF NOT EXISTS "VillaMilestone_villaId_idx" ON "VillaMilestone"("villaId")`,
      `CREATE INDEX IF NOT EXISTS "VillaMilestone_sectionId_idx" ON "VillaMilestone"("sectionId")`,
      // Foreign keys (added after tables to avoid ordering issues)
      `ALTER TABLE "Block" ADD CONSTRAINT "Block_projectId_fkey"
         FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
      `ALTER TABLE "Villa" ADD CONSTRAINT "Villa_projectId_fkey"
         FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
      `ALTER TABLE "Villa" ADD CONSTRAINT "Villa_blockId_fkey"
         FOREIGN KEY ("blockId") REFERENCES "Block"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
      `ALTER TABLE "MilestoneSection" ADD CONSTRAINT "MilestoneSection_projectId_fkey"
         FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
      `ALTER TABLE "VillaMilestone" ADD CONSTRAINT "VillaMilestone_villaId_fkey"
         FOREIGN KEY ("villaId") REFERENCES "Villa"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
      `ALTER TABLE "VillaMilestone" ADD CONSTRAINT "VillaMilestone_sectionId_fkey"
         FOREIGN KEY ("sectionId") REFERENCES "MilestoneSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
      // New nullable columns on WBSNode — safe on existing data
      `ALTER TABLE "WBSNode" ADD COLUMN IF NOT EXISTS "villaId" TEXT`,
      `ALTER TABLE "WBSNode" ADD COLUMN IF NOT EXISTS "sectionId" TEXT`,
      `ALTER TABLE "WBSNode" ADD COLUMN IF NOT EXISTS "villaMilestoneId" TEXT`,
      `ALTER TABLE "WBSNode" ADD COLUMN IF NOT EXISTS "isSubMilestone" BOOLEAN NOT NULL DEFAULT false`,
      `CREATE INDEX IF NOT EXISTS "WBSNode_villaId_idx" ON "WBSNode"("villaId")`,
      `CREATE INDEX IF NOT EXISTS "WBSNode_sectionId_idx" ON "WBSNode"("sectionId")`,
      `CREATE INDEX IF NOT EXISTS "WBSNode_villaMilestoneId_idx" ON "WBSNode"("villaMilestoneId")`,
    ],
    describe: "Executive dashboard: Block, Villa, MilestoneSection (21), VillaMilestone (with CRM columns), plus WBSNode.villaId/sectionId/villaMilestoneId/isSubMilestone.",
  },
];

async function ensureLedger() {
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "_AdminMigration" (
      "key" TEXT PRIMARY KEY,
      "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );
}

async function appliedKeys(): Promise<Set<string>> {
  await ensureLedger();
  const rows = await prisma.$queryRawUnsafe<{ key: string }[]>(
    `SELECT key FROM "_AdminMigration"`,
  );
  return new Set(rows.map((r) => r.key));
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const applied = await appliedKeys();
  return NextResponse.json({
    migrations: MIGRATIONS.map((m) => ({
      key: m.key,
      describe: m.describe,
      statements: m.sql.length,
      status: applied.has(m.key) ? "applied" : "pending",
    })),
  });
}

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const applied = await appliedKeys();
  const ran: string[] = [];
  const skipped: string[] = [];

  for (const m of MIGRATIONS) {
    if (applied.has(m.key)) {
      skipped.push(m.key);
      continue;
    }
    // Run all statements + the ledger insert in one transaction so a partial
    // failure rolls back cleanly. Next run will retry from the start.
    await prisma.$transaction(async (tx) => {
      for (const stmt of m.sql) {
        await tx.$executeRawUnsafe(stmt);
      }
      await tx.$executeRaw`INSERT INTO "_AdminMigration" ("key") VALUES (${m.key})`;
    });
    ran.push(m.key);
  }

  return NextResponse.json({ ran, skipped });
}
