import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canManageDrawings } from "@/lib/roles";
import { isScopedUser } from "@/lib/modules";
import { normalizeDiscipline, normalizeDrawingNumber } from "@/lib/drawings";
import { badRequest, forbidden, handleApiError, notFound, unauthorized } from "@/lib/apiErrors";
import { parseBody } from "@/lib/parseBody";

const PatchDrawingSchema = z.object({
  drawingNumber: z.string().min(1).max(60).optional(),
  title: z.string().min(2).max(200).optional(),
  discipline: z.string().max(40).optional(),
  notes: z.string().max(2000).optional(),
});

const drawingDetailInclude = {
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
  revisions: {
    orderBy: { uploadedAt: "desc" as const },
    include: { uploadedBy: { select: { id: true, name: true } } },
  },
} as const;

export async function GET(_req: Request, ctx: RouteContext<"/api/drawings/[id]">) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  // The Drawing Register is internal-only — same scoped-user gate the LIST
  // route enforces (src/app/api/drawings/route.ts). Without this, a scoped
  // external contractor with a guessable drawing id could pull blueprint
  // file URLs through the detail endpoint.
  if (isScopedUser(session.user.modules)) return forbidden();
  const { id } = await ctx.params;
  const drawing = await prisma.designDrawing.findUnique({
    where: { id },
    include: drawingDetailInclude,
  });
  if (!drawing) return notFound();
  return NextResponse.json({ drawing });
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/drawings/[id]">) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  if (isScopedUser(session.user.modules) || !canManageDrawings(session.user.role)) {
    return forbidden();
  }

  const { id } = await ctx.params;
  const existing = await prisma.designDrawing.findUnique({
    where: { id },
    select: { id: true, projectId: true, drawingNumber: true, title: true },
  });
  if (!existing) return notFound();

  const parsed = await parseBody(req, PatchDrawingSchema);
  if (!parsed.ok) return parsed.response;
  const { drawingNumber, title, discipline, notes } = parsed.data;

  const data: {
    drawingNumber?: string;
    title?: string;
    discipline?: string;
    notes?: string | null;
  } = {};
  if (drawingNumber !== undefined) {
    const n = normalizeDrawingNumber(drawingNumber);
    if (n.length < 1) return badRequest("Drawing number required");
    data.drawingNumber = n;
  }
  if (title !== undefined) {
    const t = title.trim();
    if (t.length < 2) return badRequest("Title too short");
    data.title = t;
  }
  if (discipline !== undefined) data.discipline = normalizeDiscipline(discipline);
  if (notes !== undefined) data.notes = notes.trim() || null;

  if (Object.keys(data).length === 0) return badRequest("Nothing to update");

  try {
    const drawing = await prisma.designDrawing.update({
      where: { id },
      data,
      include: drawingDetailInclude,
    });
    await recordAudit({
      projectId: existing.projectId,
      userId: session.user.id,
      action: "UPDATE",
      entityType: "DesignDrawing",
      entityId: id,
      summary: `Drawing ${existing.drawingNumber} updated`,
    });
    return NextResponse.json({ drawing });
  } catch (e) {
    if (typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002") {
      return badRequest(`Drawing number ${data.drawingNumber} already exists in this project`);
    }
    return handleApiError(e, "PATCH /api/drawings/:id");
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/drawings/[id]">) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  if (isScopedUser(session.user.modules) || !canManageDrawings(session.user.role)) {
    return forbidden();
  }
  const { id } = await ctx.params;
  const existing = await prisma.designDrawing.findUnique({
    where: { id },
    select: { id: true, projectId: true, drawingNumber: true },
  });
  if (!existing) return notFound();
  try {
    await prisma.designDrawing.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await recordAudit({
      projectId: existing.projectId,
      userId: session.user.id,
      action: "DELETE",
      entityType: "DesignDrawing",
      entityId: id,
      summary: `Drawing ${existing.drawingNumber} moved to trash`,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e, "DELETE /api/drawings/:id");
  }
}
