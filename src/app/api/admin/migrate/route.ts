import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";

/**
 * One-shot, idempotent schema migrations.
 *
 * GET  → returns which migrations are pending vs applied
 * POST → applies all pending migrations
 *
 * Each migration is identified by a string key and runs raw SQL. After it
 * succeeds it's marked applied via a sentinel table so re-runs are no-ops.
 */

type Migration = {
  key: string;
  sql: string[];
  describe: string;
};

const MIGRATIONS: Migration[] = [
  {
    key: "2026-05-14_add_wbs_progress_entered",
    sql: [
      `ALTER TABLE "WBSNode" ADD COLUMN "progressEntered" INTEGER NOT NULL DEFAULT 0`,
    ],
    describe: "Add WBSNode.progressEntered (distinguishes unstarted from 0%).",
  },
  {
    key: "2026-05-14_add_project_actual_dates",
    sql: [
      `ALTER TABLE "Project" ADD COLUMN "actualStartDate" DATETIME`,
      `ALTER TABLE "Project" ADD COLUMN "projectedEndDate" DATETIME`,
    ],
    describe: "Add Project.actualStartDate and Project.projectedEndDate overrides.",
  },
  {
    key: "2026-05-26_add_audit_log",
    sql: [
      `CREATE TABLE "AuditLog" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "projectId" TEXT,
        "userId" TEXT NOT NULL,
        "action" TEXT NOT NULL,
        "entityType" TEXT NOT NULL,
        "entityId" TEXT NOT NULL,
        "summary" TEXT,
        "changes" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX "AuditLog_projectId_createdAt_idx" ON "AuditLog"("projectId", "createdAt")`,
      `CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt")`,
      `CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId")`,
    ],
    describe: "Add AuditLog table for change tracking across the system.",
  },
  {
    key: "2026-05-26_add_soft_delete",
    sql: [
      `ALTER TABLE "ProgressEntry" ADD COLUMN "deletedAt" DATETIME`,
      `ALTER TABLE "Issue" ADD COLUMN "deletedAt" DATETIME`,
      `ALTER TABLE "Hindrance" ADD COLUMN "deletedAt" DATETIME`,
      `ALTER TABLE "Concern" ADD COLUMN "deletedAt" DATETIME`,
      `ALTER TABLE "Inspection" ADD COLUMN "deletedAt" DATETIME`,
    ],
    describe: "Add deletedAt to ProgressEntry / Issue / Hindrance / Concern / Inspection for soft-delete.",
  },
  {
    key: "2026-05-26_add_user_designation",
    sql: [
      `ALTER TABLE "User" ADD COLUMN "designation" TEXT`,
    ],
    describe: "Add User.designation for human-readable job titles alongside the permission role.",
  },
  {
    key: "2026-05-26_add_module_access",
    sql: [
      `ALTER TABLE "User" ADD COLUMN "modules" TEXT`,
      `ALTER TABLE "Issue" ADD COLUMN "module" TEXT`,
      `ALTER TABLE "Inspection" ADD COLUMN "module" TEXT`,
    ],
    describe: "Add module-level access: User.modules (scope) + Issue.module + Inspection.module (tags).",
  },
  {
    key: "2026-05-29_add_inspection_templates",
    sql: [
      `CREATE TABLE "InspectionTemplate" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "code" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "activity" TEXT,
        "module" TEXT,
        "orderIndex" INTEGER NOT NULL DEFAULT 0,
        "active" INTEGER NOT NULL DEFAULT 1,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX "InspectionTemplate_code_key" ON "InspectionTemplate"("code")`,
      `CREATE TABLE "InspectionTemplateItem" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "templateId" TEXT NOT NULL,
        "seq" INTEGER NOT NULL,
        "section" TEXT,
        "description" TEXT NOT NULL,
        CONSTRAINT "InspectionTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "InspectionTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`,
      `CREATE INDEX "InspectionTemplateItem_templateId_idx" ON "InspectionTemplateItem"("templateId")`,
    ],
    describe: "Add InspectionTemplate + InspectionTemplateItem (configurable checklist library).",
  },
];

async function ensureLedger() {
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "_AdminMigration" (
      "key" TEXT PRIMARY KEY,
      "appliedAt" TEXT NOT NULL DEFAULT (datetime('now'))
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
    for (const stmt of m.sql) {
      await prisma.$executeRawUnsafe(stmt);
    }
    await prisma.$executeRawUnsafe(`INSERT INTO "_AdminMigration" (key) VALUES (?)`, m.key);
    ran.push(m.key);
  }

  return NextResponse.json({ ran, skipped });
}
