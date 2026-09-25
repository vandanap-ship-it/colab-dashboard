import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Cascade delete of a project touches every child row. Give it room —
// though most one-off cleanups (a phantom Project accidentally created
// by an import) will complete in seconds.
export const maxDuration = 300;

/**
 * POST /api/admin/delete-project
 *
 * Hard-delete a Project row and (via ON DELETE CASCADE on every child
 * FK) everything under it — blocks, villas, villa milestones, wbs
 * nodes, progress entries, hindrances, concerns, permits, inspections,
 * audit rows, etc.
 *
 * The caller MUST supply BOTH `projectId` and `projectName` and they
 * must match the same row — this makes it much harder to nuke the
 * wrong project by fat-fingering an id, and impossible to pass a
 * common name like "Amanvana" alone and delete a project some future
 * import created without the caller realising.
 *
 * Also refuses when `confirm: true` is missing.
 */
const BodySchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().min(1),
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
  if (project.name !== body.projectName) {
    return NextResponse.json(
      { error: `projectName mismatch — id ${body.projectId} is "${project.name}", not "${body.projectName}"` },
      { status: 400 },
    );
  }

  // Snapshot cascade footprint so the response tells the caller what
  // vanished. Counted before deletion; if a count query fails we skip
  // it rather than blocking the delete.
  const preCounts = await Promise.all([
    prisma.block.count({ where: { projectId: project.id } }).catch(() => -1),
    prisma.villa.count({ where: { projectId: project.id } }).catch(() => -1),
    prisma.milestoneSection.count({ where: { projectId: project.id } }).catch(() => -1),
    prisma.wBSNode.count({ where: { projectId: project.id } }).catch(() => -1),
  ]);
  const [blocks, villas, sections, wbsNodes] = preCounts;

  // Audit BEFORE the delete since the project row is about to vanish
  // (audit rows themselves cascade with the project).
  await recordAudit({
    projectId: project.id,
    userId: session.user.id,
    action: "DELETE",
    entityType: "Project",
    entityId: project.id,
    summary: `Hard-delete project "${project.name}" via /api/admin/delete-project — ${blocks} blocks, ${villas} villas, ${sections} sections, ${wbsNodes} wbs nodes cascade`,
  });

  await prisma.project.delete({ where: { id: project.id } });

  return NextResponse.json({
    ok: true,
    deleted: { id: project.id, name: project.name },
    cascadeCounts: { blocks, villas, sections, wbsNodes },
  });
}
