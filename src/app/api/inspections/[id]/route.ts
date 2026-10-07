import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canReview, isAdmin } from "@/lib/roles";
import { canAccessScopedRow } from "@/lib/modules";
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
import { applyPassedInspectionToRegister } from "@/lib/registersServer";

const PatchInspectionSchema = z.object({
  // Added CONDITIONALLY_APPROVED 2026-10-01 for HSE Inspection Checklist
  // parity (Girish's native app has 5 tabs: New / In-Review /
  // Conditionally Approved / Closed / Rejected). Semantically a "pass
  // with caveats" — the inspection is approved but the reviewer wants
  // the filler to action the attached remarks before the next cycle.
  // Treated as a terminal state like PASSED for the queue (moves out
  // of the reviewer's inbox) but renders in its own tab on the list.
  status: z.enum(["IN_REVIEW", "PASSED", "REJECTED", "CONDITIONALLY_APPROVED"]),
  rejectionReason: z.string().max(1000).optional(),
  // Colab-parity: Approve & Close sheet carries an optional remark.
  // Folded into the audit summary — no dedicated column yet, but the
  // reviewer's context is preserved in the trail either way.
  reviewRemark: z.string().max(1000).optional(),
  expectedUpdatedAt: z.string().optional(),
});

export async function PATCH(req: Request, ctx: RouteContext<"/api/inspections/[id]">) {
  const session = await auth();
  if (!session?.user) return unauthorized();

  if (!canReview(session.user.role)) {
    return forbidden("Only planners can review inspections");
  }

  const { id } = await ctx.params;
  const parsed = await parseBody(req, PatchInspectionSchema);
  if (!parsed.ok) return parsed.response;
  const { status, rejectionReason, reviewRemark, expectedUpdatedAt } = parsed.data;

  try {
    const before = await prisma.inspection.findUnique({
      where: { id },
      select: {
        id: true,
        projectId: true,
        status: true,
        title: true,
        updatedAt: true,
        module: true,
        filledById: true,
        registerRowId: true,
        createdAt: true,
      },
    });
    if (!before) return notFound();
    // Module gate — QAQC-scoped contractor cannot pass/reject a SAFETY
    // inspection, and no scoped user can act on a general (module=null) one.
    if (!canAccessScopedRow(session.user.modules, before.module)) return forbidden();
    const conflict = checkConflict(expectedUpdatedAt, before.updatedAt, {
      id: before.id, status: before.status, title: before.title,
    });
    if (!conflict.ok) return conflict.response!;
    const inspection = await prisma.inspection.update({
      where: { id },
      data: {
        status,
        reviewedById: session.user.id,
        reviewedAt: new Date(),
        rejectionReason: status === "REJECTED" ? rejectionReason?.trim() || null : null,
      },
      include: {
        filledBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
        items: { orderBy: { orderIndex: "asc" } },
        photos: true,
      },
    });
    {
      const trimmedReview = reviewRemark?.trim();
      await recordAudit({
        projectId: inspection.projectId,
        userId: session.user.id,
        action: "STATUS_CHANGE",
        entityType: "Inspection",
        entityId: inspection.id,
        summary: `Inspection "${before.title}" → ${status}${
          status === "REJECTED" && rejectionReason ? ` (${rejectionReason.slice(0, 60)})` : ""
        }${
          status === "PASSED" && trimmedReview ? ` — ${trimmedReview.slice(0, 60)}` : ""
        }`,
        changes: trimmedReview ? { reviewRemark: trimmedReview.slice(0, 1000) } : undefined,
      });
    }
    // Register link — an approved checklist for a register item (e.g.
    // CL-SAF-03 for one fire extinguisher) rolls that item's last-
    // inspected + due dates forward. Conditional approval counts: the
    // inspection happened, the caveats are follow-ups.
    if ((status === "PASSED" || status === "CONDITIONALLY_APPROVED") && before.registerRowId) {
      await applyPassedInspectionToRegister(
        { id: before.id, registerRowId: before.registerRowId, createdAt: before.createdAt, projectId: before.projectId },
        session.user.id,
      );
    }
    // Push the engineer who filled it — they care most about the outcome.
    // Skip IN_REVIEW (no decision made yet); notify on PASSED / REJECTED /
    // CONDITIONALLY_APPROVED. The last one is a "pass with caveats" —
    // the reviewer wants the filler to look at the per-item remarks
    // before the next cycle; see schema comment at the top of this file.
    if (status !== "IN_REVIEW" && before.filledById) {
      const reviewer = inspection.reviewedBy?.name ?? session.user.username;
      const titlePrefix =
        status === "PASSED"
          ? "Inspection passed"
          : status === "CONDITIONALLY_APPROVED"
            ? "Conditionally approved"
            : "Inspection failed";
      const body =
        status === "PASSED"
          ? `Reviewed by ${reviewer}. No rework needed.`
          : status === "CONDITIONALLY_APPROVED"
            ? `Reviewed by ${reviewer}. Approved — check the attached remarks for follow-ups.`
            : `Reviewed by ${reviewer}.${rejectionReason?.trim() ? ` Reason: ${rejectionReason.slice(0, 100)}` : " Check the failed rows and re-submit."}`;
      // Await — see inspections/route.ts twin comment for why fire-and-
      // forget silently dropped notifications on Vercel serverless.
      await sendPushToUser(before.filledById, {
        title: `${titlePrefix} · ${before.title.slice(0, 40)}`,
        body,
        url: `/mobile/${inspection.projectId}/info`,
        tag: `inspection-${inspection.id}`,
      });
    }
    return NextResponse.json({ inspection });
  } catch (e) {
    return handleApiError(e, "PATCH /api/inspections/:id");
  }
}

/** Soft-delete an inspection. Filler or admin only. Restorable. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/inspections/[id]">) {
  const session = await auth();
  if (!session?.user) return unauthorized();

  const { id } = await ctx.params;
  const existing = await prisma.inspection.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, projectId: true, title: true, filledById: true, module: true },
  });
  if (!existing) return notFound();
  // Module gate ahead of the filler-or-admin check so a scoped contractor
  // outside the inspection's module doesn't even confirm it exists.
  if (!canAccessScopedRow(session.user.modules, existing.module)) return forbidden();
  if (existing.filledById !== session.user.id && !isAdmin(session.user.role)) return forbidden();

  try {
    await prisma.inspection.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordAudit({
      projectId: existing.projectId,
      userId: session.user.id,
      action: "DELETE",
      entityType: "Inspection",
      entityId: id,
      summary: `Inspection moved to trash: ${existing.title.slice(0, 60)}${existing.title.length > 60 ? "…" : ""}`,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e, "DELETE /api/inspections/:id");
  }
}
