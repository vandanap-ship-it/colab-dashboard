import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import { parseBody } from "@/lib/parseBody";
import { recordAudit } from "@/lib/audit";

const PostPasswordSchema = z.object({
  password: z.string().min(6, "Password must be at least 6 characters.").max(200),
});

export async function POST(req: Request, ctx: RouteContext<"/api/admin/users/[id]/password">) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const parsed = await parseBody(req, PostPasswordSchema);
  if (!parsed.ok) return parsed.response;
  const { password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, username: true } });
  if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });

  const hash = await bcrypt.hash(password, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });

  await recordAudit({
    userId: session.user.id,
    action: "UPDATE",
    entityType: "User",
    entityId: user.id,
    // Security-sensitive: recording WHO reset whose password. The new hash
    // is never logged — just the fact of the reset.
    summary: `Password reset for ${user.username}`,
  });

  return NextResponse.json({ ok: true });
}
