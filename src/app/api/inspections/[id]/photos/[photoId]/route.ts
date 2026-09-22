/**
 * DELETE /api/inspections/[id]/photos/[photoId]
 *
 * Removes one whole-checklist photo from an inspection. Deliberately
 * narrow:
 *   - filler-only (the person who saved the draft is the only one who
 *     should be pruning its evidence)
 *   - DRAFT-only (once the WIR has been sent for review, the photo set
 *     is part of the record — a reviewer sees what was submitted, not
 *     a version the filler edited after the fact)
 *
 * Per-item row photos have their own remove path (the client just
 * clears the row's photoUrl and re-saves the draft); this endpoint is
 * for the free-standing "extra photos" gallery.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, canAccessScopedRow, MODULES } from "@/lib/modules";
import { recordAudit } from "@/lib/audit";
import { forbidden, handleApiError, notFound, unauthorized } from "@/lib/apiErrors";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/inspections/[id]/photos/[photoId]">) {
  const session = await auth();
  if (!session?.user) return unauthorized();

  if (
    !canAccessModule(session.user.modules, MODULES.QAQC) &&
    !canAccessModule(session.user.modules, MODULES.SAFETY)
  ) {
    return forbidden();
  }

  const { id, photoId } = await ctx.params;

  try {
    const inspection = await prisma.inspection.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        projectId: true,
        status: true,
        title: true,
        module: true,
        filledById: true,
      },
    });
    if (!inspection) return notFound();
    if (!canAccessScopedRow(session.user.modules, inspection.module)) return forbidden();

    if (inspection.filledById !== session.user.id) {
      return forbidden("Only the filler can remove photos from their own draft.");
    }
    if (inspection.status !== "DRAFT") {
      return NextResponse.json(
        { error: `Photos on a ${inspection.status.toLowerCase()} inspection can't be removed — the record is fixed.` },
        { status: 409 },
      );
    }

    // Confirm the photo belongs to this inspection before deleting —
    // otherwise a hand-crafted photoId could target somebody else's row.
    const photo = await prisma.inspectionPhoto.findFirst({
      where: { id: photoId, inspectionId: id },
      select: { id: true, url: true },
    });
    if (!photo) return notFound();

    await prisma.inspectionPhoto.delete({ where: { id: photoId } });

    await recordAudit({
      projectId: inspection.projectId,
      userId: session.user.id,
      action: "UPDATE",
      entityType: "Inspection",
      entityId: inspection.id,
      summary: `Draft photo removed from "${inspection.title.slice(0, 60)}${inspection.title.length > 60 ? "…" : ""}"`,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e, "DELETE /api/inspections/:id/photos/:photoId");
  }
}
