import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import { recordAudit, diffSummary } from "@/lib/audit";

function parseDateOrNull(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? undefined : d;
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  let body: {
    name?: string;
    code?: string | null;
    address?: string | null;
    tagline?: string | null;
    actualStartDate?: string | null;
    projectedEndDate?: string | null;
  } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const data: {
    name?: string;
    code?: string | null;
    address?: string | null;
    tagline?: string | null;
    actualStartDate?: Date | null;
    projectedEndDate?: Date | null;
  } = {};

  if (typeof body.name === "string") {
    const n = body.name.trim();
    if (n.length < 2) return NextResponse.json({ error: "Name too short" }, { status: 400 });
    data.name = n;
  }
  if (body.code !== undefined) data.code = body.code === null ? null : String(body.code).trim() || null;
  if (body.address !== undefined) data.address = body.address === null ? null : String(body.address).trim() || null;
  if (body.tagline !== undefined) data.tagline = body.tagline === null ? null : String(body.tagline).trim() || null;

  const aStart = parseDateOrNull(body.actualStartDate);
  if (aStart !== undefined) data.actualStartDate = aStart;
  const pEnd = parseDateOrNull(body.projectedEndDate);
  if (pEnd !== undefined) data.projectedEndDate = pEnd;

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "Nothing to update." },
      { status: 400 },
    );
  }

  const updated = await prisma.project.update({
    where: { id },
    data,
    select: {
      id: true,
      name: true,
      code: true,
      address: true,
      startDate: true,
      endDate: true,
      actualStartDate: true,
      projectedEndDate: true,
    },
  });

  const diff = diffSummary(
    {
      name: project.name,
      code: project.code,
      address: project.address,
      actualStartDate: project.actualStartDate,
      projectedEndDate: project.projectedEndDate,
    },
    {
      name: updated.name,
      code: updated.code,
      address: updated.address,
      actualStartDate: updated.actualStartDate,
      projectedEndDate: updated.projectedEndDate,
    },
  );
  await recordAudit({
    projectId: id,
    userId: session.user.id,
    action: "UPDATE",
    entityType: "Project",
    entityId: id,
    summary: diff.summary || "Project updated",
    changes: diff.changes,
  });

  return NextResponse.json({ project: updated });
}
