import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * PATCH /api/notifications/[id]/read — mark a single notification as
 * read for the current user. Idempotent: hitting it on an already-read
 * row is a no-op that still returns 200 with the current row.
 *
 * Ownership check: the row must belong to session.user.id, otherwise
 * we return 404 (not 403) — we don't want to leak that a given id
 * exists in someone else's inbox. Prisma's compound `where` (id +
 * userId) filters both in one query.
 */
export async function PATCH(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const userId = session.user.id;

  const existing = await prisma.notification.findFirst({
    where: { id, userId },
    select: { id: true, readAt: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (existing.readAt) {
    // Already read — return the current row without touching updated_at.
    return NextResponse.json({ notification: { id: existing.id, readAt: existing.readAt } });
  }

  const updated = await prisma.notification.update({
    where: { id },
    data: { readAt: new Date() },
    select: { id: true, readAt: true },
  });
  return NextResponse.json({ notification: updated });
}
