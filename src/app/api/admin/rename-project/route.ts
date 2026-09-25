import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/rename-project
 *
 * Change a Project's display name. Guarded by requiring BOTH projectId
 * and currentName that match the same row, plus confirm:true — same
 * pattern as /api/admin/delete-project, so a fat-fingered id can't
 * silently retitle the wrong project.
 *
 * The rename is a pure name change: projectId (which is what every FK
 * points at) is untouched, so nothing else moves. Callers that look up
 * a project by name in code will need updating separately.
 */
const BodySchema = z.object({
  projectId: z.string().min(1),
  currentName: z.string().min(1),
  newName: z.string().min(1).max(200),
  confirm: z.literal(true),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: "Invalid body", details: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  const project = await prisma.project.findUnique({ where: { id: body.projectId } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (project.name !== body.currentName) {
    return NextResponse.json(
      { error: `currentName mismatch — id ${body.projectId} is "${project.name}", not "${body.currentName}"` },
      { status: 400 },
    );
  }

  if (project.name === body.newName) {
    return NextResponse.json({ ok: true, unchanged: true, project: { id: project.id, name: project.name } });
  }

  const updated = await prisma.project.update({
    where: { id: project.id },
    data: { name: body.newName },
    select: { id: true, name: true },
  });

  await recordAudit({
    projectId: project.id,
    userId: session.user.id,
    action: "UPDATE",
    entityType: "Project",
    entityId: project.id,
    summary: `Renamed project "${project.name}" → "${updated.name}"`,
    changes: { from: project.name, to: updated.name },
  });

  return NextResponse.json({ ok: true, project: updated, previous: { name: project.name } });
}
