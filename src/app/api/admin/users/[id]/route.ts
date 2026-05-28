import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ROLES, isAdmin } from "@/lib/roles";
import { recordAudit, diffSummary } from "@/lib/audit";
import { serializeModules } from "@/lib/modules";

const VALID_ROLES = new Set<string>(Object.values(ROLES));

export async function PATCH(req: Request, ctx: RouteContext<"/api/admin/users/[id]">) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const { name, role, active, designation, modules } = (body ?? {}) as {
    name?: string;
    role?: string;
    active?: boolean;
    designation?: string | null;
    modules?: string[] | null;
  };

  const data: {
    name?: string;
    role?: string;
    active?: boolean;
    designation?: string | null;
    modules?: string | null;
  } = {};
  if (typeof name === "string" && name.trim().length >= 2) data.name = name.trim();
  if (typeof role === "string" && VALID_ROLES.has(role)) data.role = role;
  if (typeof active === "boolean") data.active = active;
  if (designation !== undefined) {
    data.designation = typeof designation === "string" && designation.trim().length > 0
      ? designation.trim()
      : null;
  }
  if (modules !== undefined) {
    data.modules = serializeModules(modules);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  if (data.active === false && id === session.user.id) {
    return NextResponse.json({ error: "Cannot deactivate yourself" }, { status: 400 });
  }

  const before = await prisma.user.findUnique({
    where: { id },
    select: { name: true, role: true, active: true },
  });
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
