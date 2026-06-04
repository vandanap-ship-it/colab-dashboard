import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canManageDrawings } from "@/lib/roles";
import { isScopedUser } from "@/lib/modules";
import { normalizeRevisionLabel } from "@/lib/drawings";
import { badRequest, forbidden, handleApiError, notFound, unauthorized } from "@/lib/apiErrors";

/**
 * Upload a new revision of a drawing. The file should already be uploaded via
 * /api/upload (which now accepts PDFs); the client passes back the resulting
 * URL + original filename here. We create the DesignDrawingRevision and point
 * the parent drawing's currentRevisionId at it in a single transaction so the
 * register can't end up with an orphan or stale "current" reference.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/drawings/[id]/revisions">) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  if (isScopedUser(session.user.modules) || !canManageDrawings(session.user.role)) {
    return forbidden();
  }

  const { id } = await ctx.params;
  const drawing = await prisma.designDrawing.findUnique({
    where: { id },
    select: { id: true, projectId: true, drawingNumber: true, title: true },
  });
  if (!drawing) return notFound();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  const { revisionLabel, fileUrl, fileName, issuedDate, notes } = (body ?? {}) as {
    revisionLabel?: string;
    fileUrl?: string;
    fileName?: string;
    issuedDate?: string;
    notes?: string;
  };

  const label = normalizeRevisionLabel(revisionLabel);
  if (label.length < 1) return badRequest("Revision label required (e.g. R0, R1)");
  if (typeof fileUrl !== "string" || fileUrl.length < 1) return badRequest("File URL required");
  if (typeof fileName !== "string" || fileName.length < 1) return badRequest("File name required");
  const when = issuedDate ? new Date(issuedDate) : new Date();
  if (isNaN(when.getTime())) return badRequest("Invalid issued date");

  try {
    const revision = await prisma.$transaction(async (tx) => {
      const created = await tx.designDrawingRevision.create({
        data: {
          drawingId: id,
          revisionLabel: label,
          fileUrl,
          fileName,
          issuedDate: when,
          notes: notes?.trim() || null,
          uploadedById: session.user.id,
        },
        include: { uploadedBy: { select: { id: true, name: true } } },
      });
      // Make this the current revision.
      await tx.designDrawing.update({
        where: { id },
        data: { currentRevisionId: created.id },
      });
      return created;
    });

    await recordAudit({
      projectId: drawing.projectId,
      userId: session.user.id,
      action: "UPDATE",
      entityType: "DesignDrawing",
      entityId: id,
      summary: `${drawing.drawingNumber} new revision ${label} uploaded`,
    });
    return NextResponse.json({ revision }, { status: 201 });
  } catch (e) {
    return handleApiError(e, "POST /api/drawings/:id/revisions");
  }
}
