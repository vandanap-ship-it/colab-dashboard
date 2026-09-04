import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canCreateProject } from "@/lib/roles";
import { isScopedUser } from "@/lib/modules";
import { parseBody, zDateString } from "@/lib/parseBody";
import { recordAudit } from "@/lib/audit";

const PostProjectSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(200),
  code: z.string().max(40).optional(),
  status: z.enum(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED"]).optional(),
  startDate: zDateString.optional(),
  endDate: zDateString.optional(),
  address: z.string().max(500).optional(),
  projectType: z.string().max(60).optional(),
  logoUrl: z.string().url().max(2000).optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Scoped external contractors (e.g. an outside QA/QC agency) need the
  // project list to pick a project on the mobile picker, but they have no
  // business knowing addresses, target/actual dates, or who created the
  // project — that's internal-strategy information. Return a reduced shape
  // for scoped users; full shape for internal staff.
  if (isScopedUser(session.user.modules)) {
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, code: true, status: true },
    });
    return NextResponse.json({ projects });
  }

  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { id: true, name: true, username: true } } },
  });
  return NextResponse.json({ projects });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canCreateProject(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = await parseBody(req, PostProjectSchema);
  if (!parsed.ok) return parsed.response;
  const { name, code, status, startDate, endDate, address, projectType, logoUrl } = parsed.data;
  const trimmed = name.trim();
  const finalStatus = status ?? "PLANNING";

  const project = await prisma.project.create({
    data: {
      name: trimmed,
      code: code?.trim() || null,
      status: finalStatus,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      address: address?.trim() || null,
      projectType: projectType?.trim() || null,
      logoUrl: logoUrl?.trim() || null,
      createdById: session.user.id,
    },
    include: { createdBy: { select: { id: true, name: true, username: true } } },
  });

  await recordAudit({
    projectId: project.id,
    userId: session.user.id,
    action: "CREATE",
    entityType: "Project",
    entityId: project.id,
    summary: `Project created: ${project.name}${project.code ? ` (${project.code})` : ""}`,
  });

  return NextResponse.json({ project }, { status: 201 });
}
