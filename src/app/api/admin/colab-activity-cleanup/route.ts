import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";

// One-shot cleanup for ColabActivity.progressDate rows that were set by an
// earlier sync's fallback path (progressAt = Progress_Date ?? actualStart ??
// actualEnd). Post-Python-parity we want progressDate to reflect Progress_Date
// only. The 27 fallback-tainted rows are exactly those where totalPct is null
// (activity never logged) but progressDate ended up set from Actual_Start /
// Actual_End. Null them out so Weekly §1 actualSum matches Python exactly.
//
//   POST /api/admin/colab-activity-cleanup
//     body: { projectId }

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null) as { projectId?: string } | null;
  if (!body?.projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  // Fallback-inflated rows are ColabActivity rows with progressDate set but
  // no corresponding ProgressEntry (the sync's ProgressEntry gate requires a
  // meaningful signal — achieved qty, cumulative, actualEnd, notes, or
  // image — none of which fire for pure Actual_Start fallback rows).
  const affected = await prisma.$executeRawUnsafe(
    `UPDATE "ColabActivity" ca
     SET "progressDate" = NULL
     WHERE ca."projectId" = $1
       AND ca."progressDate" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM "ProgressEntry" pe
         WHERE pe."projectId" = ca."projectId"
           AND pe."idempotencyKey" LIKE ('colab:' || ca."activityId" || ':%')
           AND pe."deletedAt" IS NULL
       )`,
    body.projectId,
  );

  return NextResponse.json({ ok: true, rowsCleared: affected });
}
