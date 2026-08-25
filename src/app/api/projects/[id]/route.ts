import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canCreateProject } from "@/lib/roles";
import { recordAudit, diffSummary } from "@/lib/audit";

const VALID_STATUSES = new Set(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED"]);

function parseDateOrNull(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? undefined : d;
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Same set as project creation — Admin + Planner keeps the edit surface
  // consistent with who's already trusted to create projects.
  if (!canCreateProject(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  let body: {
    name?: string;
    code?: string | null;
    status?: string;
    address?: string | null;
    tagline?: string | null;
    projectType?: string | null;
    logoUrl?: string | null;
    startDate?: string | null;
    endDate?: string | null;
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
    status?: string;
    address?: string | null;
    tagline?: string | null;
    projectType?: string | null;
    logoUrl?: string | null;
    startDate?: Date | null;
    endDate?: Date | null;
    actualStartDate?: Date | null;
    projectedEndDate?: Date | null;
  } = {};

  if (typeof body.name === "string") {
    const n = body.name.trim();
    if (n.length < 2) return NextResponse.json({ error: "Name too short" }, { status: 400 });
    data.name = n;
  }
  if (body.code !== undefined) data.code = body.code === null ? null : String(body.code).trim() || null;
  if (body.status !== undefined && VALID_STATUSES.has(body.status)) data.status = body.status;
  if (body.address !== undefined) data.address = body.address === null ? null : String(body.address).trim() || null;
  if (body.tagline !== undefined) data.tagline = body.tagline === null ? null : String(body.tagline).trim() || null;
  if (body.projectType !== undefined) data.projectType = body.projectType === null ? null : String(body.projectType).trim() || null;
  if (body.logoUrl !== undefined) data.logoUrl = body.logoUrl === null ? null : String(body.logoUrl).trim() || null;

  const start = parseDateOrNull(body.startDate);
  if (start !== undefined) data.startDate = start;
  const end = parseDateOrNull(body.endDate);
  if (end !== undefined) data.endDate = end;
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
      status: true,
      address: true,
      tagline: true,
      projectType: true,
      logoUrl: true,
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
      status: project.status,
      address: project.address,
      projectType: project.projectType,
      logoUrl: project.logoUrl,
      startDate: project.startDate,
      endDate: project.endDate,
      actualStartDate: project.actualStartDate,
      projectedEndDate: project.projectedEndDate,
    },
    {
      name: updated.name,
      code: updated.code,
      status: updated.status,
      address: updated.address,
      projectType: updated.projectType,
      logoUrl: updated.logoUrl,
      startDate: updated.startDate,
      endDate: updated.endDate,
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
