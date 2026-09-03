import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isScopedUser } from "@/lib/modules";

/**
 * Lightweight user-listing endpoint. Used by assignee pickers across the app
 * (Issue assign, Concern assign). Does NOT expose passwords or detailed admin
 * fields — for that, use /api/admin/users.
 *
 * Internal-only: external contractors are scoped by module and don't have a
 * legitimate reason to enumerate every account. Returning the full directory
 * to a scoped user is a data-exposure — an outside vendor could read every
 * planner's and every other contractor's username and role.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isScopedUser(session.user.modules)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, username: true, role: true },
  });

  return NextResponse.json({ users });
}
