import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ROLES, isAdmin } from "@/lib/roles";
import { recordAudit, diffSummary } from "@/lib/audit";
import { serializeModules } from "@/lib/modules";
import { parseBody } from "@/lib/parseBody";
import { checkConflict } from "@/lib/optimisticLock";

const VALID_ROLES = new Set<string>(Object.values(ROLES));

const PatchUserSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  role: z.string().refine((v) => VALID_ROLES.has(v), { message: "Invalid role" }).optional(),
  active: z.boolean().optional(),
  designation: z.string().max(120).nullable().optional(),
  modules: z.array(z.string().max(60)).nullable().optional(),
  expectedUpdatedAt: z.string().optional(),
});

export async function PATCH(req: Request, ctx: RouteContext<"/api/admin/users/[id]">) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const parsed = await parseBody(req, PatchUserSchema);
  if (!parsed.ok) return parsed.response;
  const { name, role, active, designation, modules, expectedUpdatedAt } = parsed.data;

  const data: {
    name?: string;
    role?: string;
    active?: boolean;
    designation?: string | null;
    modules?: string | null;
  } = {};
  if (name !== undefined) data.name = name.trim();
  if (role !== undefined) data.role = role;
  if (active !== undefined) data.active = active;
  if (designation !== undefined) {
    data.designation = designation && designation.trim().length > 0 ? designation.trim() : null;
  }
  if (modules !== undefined) data.modules = serializeModules(modules);

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  if (data.active === false && id === session.user.id) {
    return NextResponse.json({ error: "Cannot deactivate yourself" }, { status: 400 });
  }

  const before = await prisma.user.findUnique({
    where: { id },
    select: { name: true, role: true, active: true, updatedAt: true },
  });
  if (before) {
    const conflict = checkConflict(expectedUpdatedAt, before.updatedAt, {
      id, name: before.name, role: before.role, active: before.active,
    });
    if (!conflict.ok) return conflict.response!;
  }
  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, username: true, name: true, role: true, designation: true, modules: true, active: true, createdAt: true },
  });

  if (before) {
    const diff = diffSummary(
      { name: before.name, role: before.role, active: before.active },
      { name: user.name, role: user.role, active: user.active },
    );
    await recordAudit({
      userId: session.user.id,
      action: "UPDATE",
      entityType: "User",
      entityId: user.id,
      summary: diff.summary || `User ${user.username} updated`,
      changes: diff.changes,
    });
  }

  return NextResponse.json({ user });
}
