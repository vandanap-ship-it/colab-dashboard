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
