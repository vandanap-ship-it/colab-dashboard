import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, canAccessScopedRow, MODULES } from "@/lib/modules";
import { canReview, isAdmin } from "@/lib/roles";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parseBody";
import { isOwnUploadUrl } from "@/lib/upload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PATCH /api/inspections/[id]/items/[itemId]
 *
 * Colab-parity — the "Approver 1" row on the WIR review side has a
 * chat icon and a camera icon per checklist item. This endpoint is
 * where those taps land: the reviewer can attach a note (💬 chat /
 * ↩ Add Reply, both share the reviewerNote column) or a photo (📷).
 *
 * Guarded:
 * - Only reviewers (Planner/Product/Admin/Site Manager) or an admin
 *   may update reviewer state. Fillers cannot.
 * - The row must belong to a WIR in status IN_REVIEW — approved /
 *   rejected / rescheduled WIRs are read-only.
 * - Module scoping still applies (a QA/QC-only user can't touch a
 *   SAFETY WIR's items).
 *
 * Body: { reviewerNote?, reviewerPhotoUrl? } — both optional and
 * nullable. Passing null clears the field.
 */
const PatchItemSchema = z.object({
  reviewerNote: z.string().max(2000).nullable().optional(),
  reviewerPhotoUrl: z.string().url().nullable().optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; itemId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (
    !canAccessModule(session.user.modules, MODULES.QAQC) &&
    !canAccessModule(session.user.modules, MODULES.SAFETY)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!canReview(session.user.role) && !isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Only reviewers may leave per-item feedback." }, { status: 403 });
  }

  const { id: inspectionId, itemId } = await ctx.params;
  const parsed = await parseBody(req, PatchItemSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const item = await prisma.inspectionItem.findFirst({
    where: { id: itemId, inspectionId },
    include: {
      inspection: {
        select: { id: true, status: true, module: true, projectId: true, deletedAt: true },
      },
    },
  });
  if (!item || item.inspection.deletedAt) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  if (!canAccessScopedRow(session.user.modules, item.inspection.module)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (item.inspection.status !== "IN_REVIEW") {
    return NextResponse.json(
      { error: "Per-item feedback can only be added while the WIR is in review." },
      { status: 400 },
    );
  }

  // Prisma `undefined` = leave the column as-is. Explicit null clears
  // the field. Non-null strings overwrite.
  const data: { reviewerNote?: string | null; reviewerPhotoUrl?: string | null } = {};
  if (body.reviewerNote !== undefined) data.reviewerNote = body.reviewerNote?.trim() || null;
  if (body.reviewerPhotoUrl !== undefined) {
    // Provenance guard: only our own uploader's URLs land as reviewer
    // annotations. An external URL is normalized to null so a hostile
    // reviewer can't pin a phishing/tracking image to the WIR.
    const raw = body.reviewerPhotoUrl;
    data.reviewerPhotoUrl = raw && isOwnUploadUrl(raw) ? raw : null;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // Race guard: if a peer reviewer approved / rejected / rescheduled the WIR
  // between the pre-check above and this write, the note must NOT sneak in
  // after the decision. Re-read status inside a transaction and abort the
  // write if it moved out of IN_REVIEW.
  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const fresh = await tx.inspection.findUnique({
        where: { id: inspectionId },
        select: { status: true },
      });
      if (!fresh) throw new RangeError("GONE");
      if (fresh.status !== "IN_REVIEW") {
        throw new RangeError(`STATUS_CHANGED:${fresh.status}`);
      }
      return tx.inspectionItem.update({
        where: { id: itemId },
        data,
      });
    });
  } catch (e) {
    if (e instanceof RangeError) {
      if (e.message === "GONE") {
        return NextResponse.json({ error: "Item not found" }, { status: 404 });
      }
      if (e.message.startsWith("STATUS_CHANGED:")) {
        const status = (e.message.split(":")[1] ?? "").toLowerCase();
        return NextResponse.json(
          { error: `This WIR is now ${status} — per-item feedback is only editable while it's in review. Reload the WIR to see the latest state.` },
          { status: 400 },
        );
      }
    }
    throw e;
  }

  await recordAudit({
    projectId: item.inspection.projectId,
    userId: session.user.id,
    action: "UPDATE",
    entityType: "Inspection",
    entityId: inspectionId,
    summary:
      data.reviewerNote !== undefined && data.reviewerPhotoUrl !== undefined
        ? "Reviewer set per-item note + photo"
        : data.reviewerNote !== undefined
          ? "Reviewer set per-item note"
          : "Reviewer set per-item photo",
    changes: {
      inspectionId,
      itemId,
      set: Object.keys(data),
    },
  });

  return NextResponse.json({ item: updated });
}
