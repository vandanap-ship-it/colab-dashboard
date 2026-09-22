import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Server-side helper for the mobile bottom nav's bell badge. One row
 * count against the compound (userId, readAt) index, so this is cheap
 * to call on every layout render. Returns 0 when the caller isn't
 * signed in — the callers just skip rendering the badge in that case.
 */
export async function getUnreadNotificationCount(userId: string | null | undefined): Promise<number> {
  if (!userId) return 0;
  return prisma.notification.count({ where: { userId, readAt: null } });
}
