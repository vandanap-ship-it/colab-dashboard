import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/notifications/read-all — batch mark every unread
 * notification for the current user as read in one round trip.
 *
 * Used by the Notifications page's "Mark all as read" affordance, and
 * called implicitly when the engineer opens the inbox and stays on the
 * page — a one-shot cleanup is friendlier than making them tap each
 * row individually. Returns the count of rows that were still unread
 * before the update fired, so the UI can flash "12 marked as read".
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const now = new Date();
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: now },
  });
  return NextResponse.json({ marked: result.count });
}
