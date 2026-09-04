import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canCreateProject } from "@/lib/roles";
import { isScopedUser } from "@/lib/modules";
import { uploadPhoto } from "@/lib/upload";
import { recordAudit } from "@/lib/audit";

const KINDS = new Set(["LAYOUT", "360_IMAGE", "OTHER"]);

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/drawings">) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Site plans / 360 images are working documents — internal only. Scoped
  // external contractors shouldn't be able to enumerate or download them
  // by walking projectIds.
  if (isScopedUser(session.user.modules)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: projectId } = await ctx.params;
  const drawings = await prisma.projectDrawing.findMany({
    where: { projectId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({ drawings });
}

export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/drawings">) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Same rationale as GET — plus canCreateProject below limits writers to
  // planners+admins so a scoped user in the write role wouldn't be able
  // to upload either, but the isScopedUser gate makes the intent explicit.
  if (isScopedUser(session.user.modules)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!canCreateProject(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: projectId } = await ctx.params;
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file");
  const label = (form.get("label")?.toString() ?? "").trim();
  const kindRaw = form.get("kind")?.toString() ?? "LAYOUT";
  const kind = KINDS.has(kindRaw) ? kindRaw : "LAYOUT";
  const isDefault = form.get("isDefault") === "true";

  if (!(file instanceof File)) return NextResponse.json({ error: "Missing image" }, { status: 400 });
  if (!label) return NextResponse.json({ error: "Label required" }, { status: 400 });

  const uploaded = await uploadPhoto(file, `drawings-${projectId}`);

  const drawing = await prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.projectDrawing.updateMany({ where: { projectId }, data: { isDefault: false } });
    }
    return tx.projectDrawing.create({
      data: { projectId, label, kind, imageUrl: uploaded.url, isDefault },
    });
  });

  await recordAudit({
    projectId,
    userId: session.user.id,
    action: "CREATE",
    entityType: "ProjectDrawing",
    entityId: drawing.id,
    summary: `Drawing added: ${label} (${kind}${isDefault ? ", default" : ""})`,
  });

  return NextResponse.json({ drawing }, { status: 201 });
}
