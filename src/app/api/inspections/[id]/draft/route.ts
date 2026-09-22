/**
 * PUT /api/inspections/[id]/draft
 *
 * Companion to POST /api/inspections?mode=draft: update the filler's own
 * draft in place. Same body shape as POST — the mode field decides what
 * happens next:
 *
 *   mode="draft"    (default) → the WIR stays a DRAFT, this is a "save
 *                                what I've answered so far" edit. No
 *                                validation of every-row-answered, no
 *                                reviewer push.
 *   mode="review"             → the WIR transitions DRAFT → IN_REVIEW,
 *                                validates the full checklist, fires the
 *                                same push flow POST uses. This is the
 *                                filler saying "I'm done, send it".
 *
 * Auth:
 *   - Only the filler themselves may PUT (admins have a separate override
 *     path in the admin console; here we deliberately keep the surface
 *     narrow — a stranger with edit rights isn't the intended user).
 *   - The row must currently be DRAFT. Passed / Rejected / Rescheduled /
 *     In-Review WIRs use their own dedicated endpoints; there's no back-
 *     door here to rewrite a submitted checklist.
 *
 * Items strategy: full replace. On each save the client sends the full
 * item list including per-row photoUrls (existing ones preserved as the
 * same string, new uploads as fresh URLs). We delete every item and
 * recreate them inside a transaction so the write is atomic and the
 * order matches what the filler last saw.
 *
 * Photos strategy: append. Whole-checklist photos already saved stay
 * on the row; new uploads append to the set. Removing an existing
 * photo isn't wired here — that's a follow-up (needs a photo delete
 * endpoint on InspectionPhoto).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, canAccessScopedRow, MODULES } from "@/lib/modules";
import { recordAudit } from "@/lib/audit";
import {
  forbidden,
  handleApiError,
  notFound,
  unauthorized,
} from "@/lib/apiErrors";
import { parseBody } from "@/lib/parseBody";
import { checkConflict } from "@/lib/optimisticLock";
import { sendPushToUser } from "@/lib/push";
import { ROLES } from "@/lib/roles";
import { assertWbsNodeInProject } from "@/lib/projectFkGuards";

const PutDraftSchema = z.object({
  wbsNodeId: z.string().min(1).nullable().optional(),
  title: z.string().min(3).max(200),
  items: z.array(
    z.object({
      label: z.string().max(300).optional(),
      passed: z.union([z.boolean(), z.null()]).optional(),
      notApplicable: z.boolean().optional(),
      notes: z.string().max(500).optional(),
      photoUrl: z.string().url().nullable().optional(),
    }),
  ).max(100).optional(),
  // Whole-checklist photos already uploaded and returned from /api/upload.
  // These are APPENDED to the row's photo set; existing photos aren't
  // touched (removal is a follow-up).
  photoUrls: z.array(z.string().url()).max(10).optional(),
  assignedReviewerIds: z.array(z.string().min(1)).max(20).optional(),
  submitRemark: z.string().max(2000).optional(),
  mode: z.enum(["draft", "review"]).optional(),
  expectedUpdatedAt: z.string().optional(),
});

export async function PUT(req: Request, ctx: RouteContext<"/api/inspections/[id]/draft">) {
  const session = await auth();
  if (!session?.user) return unauthorized();

  if (
    !canAccessModule(session.user.modules, MODULES.QAQC) &&
    !canAccessModule(session.user.modules, MODULES.SAFETY)
  ) {
    return forbidden();
  }

  const { id } = await ctx.params;
  const parsed = await parseBody(req, PutDraftSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const isReviewSubmit = body.mode === "review";

  try {
    const before = await prisma.inspection.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        projectId: true,
        status: true,
        title: true,
        updatedAt: true,
        module: true,
        filledById: true,
        assignedReviewerIds: true,
      },
    });
    if (!before) return notFound();
    if (!canAccessScopedRow(session.user.modules, before.module)) return forbidden();

    if (before.filledById !== session.user.id) {
      return forbidden("Only the filler can edit their own draft.");
    }
    if (before.status !== "DRAFT") {
      return NextResponse.json(
        { error: `This WIR is ${before.status.toLowerCase()} — drafts only.` },
        { status: 409 },
      );
    }

    const conflict = checkConflict(body.expectedUpdatedAt, before.updatedAt, {
      id: before.id,
      status: before.status,
      title: before.title,
    });
    if (!conflict.ok) return conflict.response!;

    const wbsErr = await assertWbsNodeInProject(body.wbsNodeId ?? null, before.projectId);
    if (wbsErr) return NextResponse.json({ error: wbsErr }, { status: 400 });

    // Reuse the same validation POST uses for the "review" branch — every
    // non-empty row has to be answered Yes/No/NA before we let the WIR
    // out of DRAFT into IN_REVIEW. Draft-mode edits skip this so a
    // partially-answered checklist can round-trip.
    const candidateItems = Array.isArray(body.items) ? body.items : [];
    const itemsClean: Array<{
      label: string;
      passed: boolean | null;
      notApplicable: boolean;
      notes: string | null;
      photoUrl: string | null;
      orderIndex: number;
    }> = [];
    for (let idx = 0; idx < candidateItems.length; idx++) {
      const i = candidateItems[idx];
      const label = (i.label ?? "").trim();
      if (label.length === 0) continue;
      const isNA = i.notApplicable === true;
      if (isReviewSubmit && !isNA && typeof i.passed !== "boolean") {
        return NextResponse.json(
          { error: `Item "${label}" was not marked Yes, No or N/A.` },
          { status: 400 },
        );
      }
      itemsClean.push({
        label,
        passed: isNA ? null : (typeof i.passed === "boolean" ? i.passed : null),
        notApplicable: isNA,
        notes: i.notes?.trim() || null,
        photoUrl: (i.photoUrl?.trim?.() || null) as string | null,
        orderIndex: idx,
      });
    }
    if (itemsClean.length === 0) {
      return NextResponse.json({ error: "At least one checklist item required" }, { status: 400 });
    }

    const cleanReviewerIds = Array.isArray(body.assignedReviewerIds)
      ? [...new Set(body.assignedReviewerIds.filter((v) => typeof v === "string" && v.length > 0 && v !== session.user.id))].slice(0, 20)
      : [];
    const cleanSubmitRemark = body.submitRemark?.trim() || null;
    const appendedPhotos = Array.isArray(body.photoUrls)
      ? body.photoUrls.filter((u) => typeof u === "string" && u.length > 0).slice(0, 8)
      : [];

    // Two writes as one transaction: swap out every item row, update
    // the header + optionally flip status. Nothing sees a half-applied
    // state; if either write fails the whole edit rolls back.
    const inspection = await prisma.$transaction(async (tx) => {
      await tx.inspectionItem.deleteMany({ where: { inspectionId: id } });
      return tx.inspection.update({
        where: { id },
        data: {
          title: body.title.trim(),
          wbsNodeId: body.wbsNodeId || null,
          submitRemark: cleanSubmitRemark,
          assignedReviewerIds: cleanReviewerIds,
          ...(isReviewSubmit ? { status: "IN_REVIEW" } : {}),
          items: { create: itemsClean },
          ...(appendedPhotos.length > 0
            ? { photos: { create: appendedPhotos.map((url) => ({ url })) } }
            : {}),
        },
        include: {
          filledBy: { select: { id: true, name: true } },
          reviewedBy: { select: { id: true, name: true } },
          wbsNode: { select: { id: true, name: true, taskCode: true } },
          items: { orderBy: { orderIndex: "asc" } },
          photos: true,
        },
      });
    });

    const passedCount = itemsClean.filter((i) => i.passed === true).length;
    await recordAudit({
      projectId: inspection.projectId,
      userId: session.user.id,
      action: isReviewSubmit ? "STATUS_CHANGE" : "UPDATE",
      entityType: "Inspection",
      entityId: inspection.id,
      summary: isReviewSubmit
        ? `Draft sent for review: "${inspection.title}" (${passedCount}/${itemsClean.length} passed)`
        : `Draft updated: "${inspection.title}" (${itemsClean.length} row${itemsClean.length === 1 ? "" : "s"})`,
    });

    // The push fires only when the WIR is transitioning out of DRAFT
    // into IN_REVIEW. Same routing as POST — assigned reviewers get
    // pinged if the filler picked them, else the role-based broadcast
    // fires.
    if (isReviewSubmit) {
      const moduleTag = inspection.module;
      const reviewerIds = cleanReviewerIds.length > 0
        ? (await prisma.user.findMany({
            where: {
              active: true,
              id: { in: cleanReviewerIds },
              role: { in: [ROLES.PLANNER, ROLES.PRODUCT_TEAM, ROLES.ADMIN, ROLES.SITE_MANAGER] },
            },
            select: { id: true },
          })).map((u) => u.id)
        : (await prisma.user.findMany({
            where: {
              active: true,
              role: { in: [ROLES.PLANNER, ROLES.PRODUCT_TEAM, ROLES.ADMIN] },
              id: { not: session.user.id },
            },
            select: { id: true },
          })).map((u) => u.id);
      const assigned = cleanReviewerIds.length > 0;
      for (const rid of reviewerIds) {
        void sendPushToUser(rid, {
          title: assigned
            ? `Assigned WIR · ${inspection.title.slice(0, 40)}`
            : `New WIR to review · ${inspection.title.slice(0, 40)}`,
          body: `${session.user.name ?? session.user.username} finished a draft and sent ${itemsClean.length} item${itemsClean.length === 1 ? "" : "s"}.${passedCount === itemsClean.length ? " All Yes." : ""}${cleanSubmitRemark ? ` · "${cleanSubmitRemark.slice(0, 80)}"` : ""}`,
          url: `/mobile/${inspection.projectId}/qaqc/${inspection.id}?tab=pending${moduleTag ? `&module=${moduleTag}` : ""}`,
          tag: `wir-new-${inspection.id}`,
        });
      }
    }

    return NextResponse.json({ inspection });
  } catch (e) {
    return handleApiError(e, "PUT /api/inspections/:id/draft");
  }
}
