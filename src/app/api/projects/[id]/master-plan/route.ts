import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uploadPhoto } from "@/lib/upload";
import { recordAudit } from "@/lib/audit";
import { isAdmin, ROLES } from "@/lib/roles";
import { badRequest, unauthorized } from "@/lib/apiErrors";

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB — master plans are usually larger than a snapshot photo.

function canEdit(role: string): boolean {
  return isAdmin(role) || role === ROLES.PLANNER || role === ROLES.PRODUCT_TEAM;
}

/** POST /api/projects/[id]/master-plan — upload + save URL on Project. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  if (!canEdit(session.user.role)) {
    return NextResponse.json({ error: "Only admins, planners and product team can update the master plan." }, { status: 403 });
  }

  const { id: projectId } = await params;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest("Invalid form data");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return badRequest("Missing file");
  if (file.size > MAX_BYTES) return badRequest(`File exceeds ${MAX_BYTES / 1024 / 1024}MB`);
  const looksLikeImage =
    file.type.startsWith("image/") ||
    /\.(jpe?g|png|webp|gif)$/i.test(file.name);
  if (!looksLikeImage) return badRequest("Master plan must be a JPEG, PNG, WebP or GIF image");

  try {
    const upload = await uploadPhoto(file, `master-plan-${projectId}`);
    const updated = await prisma.project.update({
      where: { id: projectId },
      data: { masterPlanUrl: upload.url },
      select: { id: true, masterPlanUrl: true },
    });
    await recordAudit({
      projectId,
      userId: session.user.id,
      action: "UPDATE",
      entityType: "Project",
      entityId: projectId,
      summary: `Master plan updated for ${project.name}`,
    });
    return NextResponse.json({ masterPlanUrl: updated.masterPlanUrl });
  } catch (e) {
    console.error("[POST /api/projects/[id]/master-plan]", e);
    const message = e instanceof Error ? e.message : "Upload failed";
    return NextResponse.json({ error: `Upload failed: ${message}` }, { status: 500 });
  }
}

/** DELETE /api/projects/[id]/master-plan — clear the URL (the blob itself
 *  stays on Vercel Blob for now; explicit purge is a follow-up). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  if (!canEdit(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: projectId } = await params;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, masterPlanUrl: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!project.masterPlanUrl) return NextResponse.json({ ok: true });

  await prisma.project.update({
    where: { id: projectId },
    data: { masterPlanUrl: null },
  });
  await recordAudit({
    projectId,
    userId: session.user.id,
    action: "UPDATE",
    entityType: "Project",
    entityId: projectId,
    summary: `Master plan removed for ${project.name}`,
  });
  return NextResponse.json({ ok: true });
}
