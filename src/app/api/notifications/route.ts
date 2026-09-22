import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/notifications — recent inbox for the current user, plus the
 * unread count that drives the bell badge.
 *
 * Query params:
 *   limit       — how many rows to return (default 50, cap 100)
 *   unreadOnly  — "true" to filter to unread only (default "false")
 *
 * Scoped strictly to session.user.id; the row is never returned across
 * users. No pagination cursor for now — 50 rows fits every realistic
 * usage of the bell we've seen, and a Load More can go in later when
 * the inbox is long enough to need it.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const rawLimit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;
  const unreadOnly = url.searchParams.get("unreadOnly") === "true";

  const userId = session.user.id;
  const whereBase = { userId };
  const whereList = unreadOnly ? { ...whereBase, readAt: null } : whereBase;

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: whereList,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        title: true,
        body: true,
        url: true,
        tag: true,
        createdAt: true,
        readAt: true,
      },
    }),
    // Unread count is always the full-user count, not the filtered list.
    // The bell shows total unread across ALL notifications, regardless of
    // which slice the caller happens to be looking at.
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  return NextResponse.json({ notifications, unreadCount });
}
