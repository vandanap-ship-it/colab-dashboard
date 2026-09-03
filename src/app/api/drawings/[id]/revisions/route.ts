import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canManageDrawings } from "@/lib/roles";
import { isScopedUser } from "@/lib/modules";
import { normalizeRevisionLabel } from "@/lib/drawings";
import { isOwnUploadUrl } from "@/lib/upload";
import { badRequest, forbidden, handleApiError, notFound, unauthorized } from "@/lib/apiErrors";
import { parseBody } from "@/lib/parseBody";

const PostRevisionSchema = z.object({
  revisionLabel: z.string().min(1).max(20),
  // Not z.string().url() — the /api/upload pipeline returns relative
  // paths like `/uploads/drawings-<id>/file.pdf` that are valid but not
  // absolute URLs. Provenance is enforced by `isOwnUploadUrl` below.
  fileUrl: z.string().min(1).max(2000),
  fileName: z.string().min(1).max(200),
  issuedDate: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

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

  const parsed = await parseBody(req, PostRevisionSchema);
  if (!parsed.ok) return parsed.response;
  const { revisionLabel, fileUrl, fileName, issuedDate, notes } = parsed.data;
  const label = normalizeRevisionLabel(revisionLabel);
  if (label.length < 1) return badRequest("Revision label required (e.g. R0, R1)");
  // Only accept URLs from our own /api/upload pipeline. Without this, an
  // attacker could store a hostile URL — phishing redirect, malware, or a
  // doxxing image — as the canonical revision of someone else's blueprint.
  if (!isOwnUploadUrl(fileUrl)) return badRequest("Unsupported file URL");
  const when = issuedDate ? new Date(issuedDate) : new Date();

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
