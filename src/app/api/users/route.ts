import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Lightweight user-listing endpoint. Used by assignee pickers across the app
 * (Issue assign, Concern assign). Does NOT expose passwords or detailed admin
 * fields — for that, use /api/admin/users.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await prisma.user.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, username: true, role: true },
  });

  return NextResponse.json({ users });
}
