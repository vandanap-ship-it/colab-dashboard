import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import { recordAudit } from "@/lib/audit";

// Endpoint historically served two callers:
//   - `/admin/contractors` page → list ALL contractors across projects (admin-only)
//   - Mobile progress form → list contractors for ONE project (any user logging
//     progress needs this)
// Pre-fix, both shapes were reachable without role checks, so a scoped
// external contractor could pull every project's contractor roster.
// Now: `projectId` query → any signed-in user; no projectId → admin only.

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");

  if (!projectId && !isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const where = projectId ? { projectId } : {};
  const contractors = await prisma.contractor.findMany({
    where,
    orderBy: [{ active: "desc" }, { category: "asc" }, { name: "asc" }],
    include: { project: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ contractors });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { projectId, name, category } = (body ?? {}) as {
    projectId?: string;
    name?: string;
    category?: string;
  };

  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
  const n = (name ?? "").trim();
  const c = (category ?? "").trim();
  if (n.length < 2) return NextResponse.json({ error: "Name too short" }, { status: 400 });
  if (c.length < 2) return NextResponse.json({ error: "Category too short" }, { status: 400 });

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  try {
    const contractor = await prisma.contractor.create({
      data: { projectId, name: n, category: c },
      include: { project: { select: { id: true, name: true } } },
    });
    // Audit every admin-side write — invariant the rest of the codebase keeps.
    await recordAudit({
      projectId,
      userId: session.user.id,
      action: "CREATE",
      entityType: "Contractor",
      entityId: contractor.id,
      summary: `Added contractor: ${n} (${c})`,
    });
    return NextResponse.json({ contractor }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Contractor with that name already exists for this project" }, { status: 400 });
  }
}
