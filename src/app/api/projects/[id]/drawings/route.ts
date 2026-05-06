import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canCreateProject } from "@/lib/roles";
import { uploadPhoto } from "@/lib/upload";

const KINDS = new Set(["LAYOUT", "360_IMAGE", "OTHER"]);

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/drawings">) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  return NextResponse.json({ drawing }, { status: 201 });
}
