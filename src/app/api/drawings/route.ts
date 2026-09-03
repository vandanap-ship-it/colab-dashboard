import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canManageDrawings } from "@/lib/roles";
import { isScopedUser } from "@/lib/modules";
import { normalizeDiscipline, normalizeDrawingNumber } from "@/lib/drawings";
import { badRequest, forbidden, unauthorized } from "@/lib/apiErrors";
import { parseBody } from "@/lib/parseBody";

const PostDrawingSchema = z.object({
  projectId: z.string().min(1),
  drawingNumber: z.string().min(1).max(60),
  title: z.string().min(2).max(200),
  discipline: z.string().max(40).optional(),
  notes: z.string().max(2000).optional(),
});

export const drawingInclude = {
  createdBy: { select: { id: true, name: true } },
  currentRevision: {
    select: {
      id: true,
      revisionLabel: true,
      fileUrl: true,
      fileName: true,
      issuedDate: true,
      notes: true,
      uploadedAt: true,
      uploadedBy: { select: { id: true, name: true } },
    },
  },
  _count: { select: { revisions: true } },
} as const;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  // Drawing Register is internal-only. Same gate the write endpoints already
  // apply — otherwise a scoped contractor can list drawings + read fileUrls.
  if (isScopedUser(session.user.modules)) return forbidden();

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const discipline = searchParams.get("discipline");
  if (!projectId) return badRequest("projectId required");

  const where: { projectId: string; discipline?: string } = { projectId };
  if (discipline) where.discipline = discipline;

  const drawings = await prisma.designDrawing.findMany({
    where,
    orderBy: [{ discipline: "asc" }, { drawingNumber: "asc" }],
    include: drawingInclude,
  });
  return NextResponse.json({ drawings });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  if (isScopedUser(session.user.modules) || !canManageDrawings(session.user.role)) {
    return forbidden("Your account can't add drawings.");
  }

  const parsed = await parseBody(req, PostDrawingSchema);
  if (!parsed.ok) return parsed.response;
  const { projectId, drawingNumber, title, discipline, notes } = parsed.data;
  const num = normalizeDrawingNumber(drawingNumber);
  if (num.length < 1) return badRequest("Drawing number required");
  const t = title.trim();

  try {
    const drawing = await prisma.designDrawing.create({
      data: {
        projectId,
        drawingNumber: num,
        title: t,
        discipline: normalizeDiscipline(discipline),
        notes: notes?.trim() || null,
        createdById: session.user.id,
      },
      include: drawingInclude,
    });
    await recordAudit({
      projectId,
      userId: session.user.id,
      action: "CREATE",
      entityType: "DesignDrawing",
      entityId: drawing.id,
      summary: `Drawing added: ${num} ${t}`,
    });
    return NextResponse.json({ drawing }, { status: 201 });
  } catch (e) {
    // P2002 on (projectId, drawingNumber) → friendlier message.
    if (typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002") {
      return badRequest(`Drawing number ${num} already exists in this project`);
    }
    throw e;
  }
}
