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

  const affected = await prisma.$executeRawUnsafe(
    `UPDATE "ColabActivity"
     SET "progressDate" = NULL
     WHERE "projectId" = $1
       AND "progressDate" IS NOT NULL
       AND "totalPct" IS NULL`,
    body.projectId,
  );

  return NextResponse.json({ ok: true, rowsCleared: affected });
}
