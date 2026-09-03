import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canCreateProject } from "@/lib/roles";
import { recordAudit, diffSummary } from "@/lib/audit";
import { parseBody } from "@/lib/parseBody";
import { checkConflict } from "@/lib/optimisticLock";

const PatchProjectSchema = z.object({
  name: z.string().min(2, "Name too short").max(200).optional(),
  code: z.string().max(40).nullable().optional(),
  status: z.enum(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED"]).optional(),
  address: z.string().max(500).nullable().optional(),
  tagline: z.string().max(200).nullable().optional(),
  projectType: z.string().max(60).nullable().optional(),
  logoUrl: z.string().url().max(2000).nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  actualStartDate: z.string().nullable().optional(),
  projectedEndDate: z.string().nullable().optional(),
  expectedUpdatedAt: z.string().optional(),
});

function parseDateOrNull(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(v);
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

  const parsed = await parseBody(req, PatchProjectSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const conflict = checkConflict(body.expectedUpdatedAt, project.updatedAt, {
    id: project.id, name: project.name, status: project.status,
  });
  if (!conflict.ok) return conflict.response!;

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

  if (body.name !== undefined) data.name = body.name.trim();
  if (body.code !== undefined) data.code = body.code === null ? null : body.code.trim() || null;
  if (body.status !== undefined) data.status = body.status;
  if (body.address !== undefined) data.address = body.address === null ? null : body.address.trim() || null;
  if (body.tagline !== undefined) data.tagline = body.tagline === null ? null : body.tagline.trim() || null;
  if (body.projectType !== undefined) data.projectType = body.projectType === null ? null : body.projectType.trim() || null;
  if (body.logoUrl !== undefined) data.logoUrl = body.logoUrl === null ? null : body.logoUrl.trim() || null;

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
