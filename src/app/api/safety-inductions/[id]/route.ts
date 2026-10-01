import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, canAccessScopedRow, MODULES } from "@/lib/modules";
import { canReview } from "@/lib/roles";
import { parseBody } from "@/lib/parseBody";
import { checkConflict } from "@/lib/optimisticLock";
import { recordAudit } from "@/lib/audit";
import { sendPushToUser } from "@/lib/push";
import { badRequest, forbidden, notFound, unauthorized, handleApiError } from "@/lib/apiErrors";

/**
 * Safety Induction detail + decision.
 *
 * GET  → one induction, filled rows + decision history.
 * PATCH → approve / reject. Gated to canReview (PLANNER / PRODUCT_TEAM /
 *   ADMIN / SITE_MANAGER after the 2026-10-01 widening) AND SAFETY module
 *   access. Girish R passes both — he's the designated approver per
 *   Shraddha's rule. The maker cannot approve their own induction
 *   (idiomatic separation of duty); this is enforced by a creator check.
 */

const PatchInductionSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  rejectionReason: z.string().max(2000).nullable().optional(),
  expectedUpdatedAt: z.string().optional(),
});

const inductionInclude = {
  contractor: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true, role: true, email: true } },
  approvedBy: { select: { id: true, name: true } },
  rejectedBy: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
} as const;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return unauthorized();
    if (!canAccessModule(session.user.modules, MODULES.SAFETY)) return forbidden();

    const { id } = await ctx.params;
    const induction = await prisma.safetyInduction.findUnique({
      where: { id },
      include: inductionInclude,
    });
    if (!induction || induction.deletedAt) return notFound();

    return NextResponse.json({ induction });
  } catch (e) {
    return handleApiError(e, "safety-inductions/[id] GET");
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return unauthorized();
    if (!canAccessModule(session.user.modules, MODULES.SAFETY)) return forbidden();
    // Only the designated reviewers (canReview roles) can decide. The
    // SAFETY module filter above + canReview below mean on Amanvana today
    // this is Girish R (SITE_MANAGER + SAFETY), matching the same gate
    // the HSE Checklist review uses.
    if (!canReview(session.user.role)) {
      return forbidden("Only designated approvers can decide safety inductions");
    }

    const { id } = await ctx.params;
    const parsed = await parseBody(req, PatchInductionSchema);
    if (!parsed.ok) return parsed.response;
    const { status, rejectionReason, expectedUpdatedAt } = parsed.data;

    const before = await prisma.safetyInduction.findUnique({
      where: { id },
      select: {
        id: true,
        projectId: true,
        status: true,
        createdById: true,
        workerName: true,
        displayId: true,
        updatedAt: true,
      },
    });
    if (!before) return notFound();

    // Separation of duty — maker cannot approve their own induction.
    if (before.createdById === session.user.id) {
      return forbidden("You can't review an induction you raised yourself.");
    }

    // Only PENDING rows can transition. APPROVED / REJECTED / EXPIRED are
    // terminal; a reviewer wanting to flip a mistake raises a fresh row.
    if (before.status !== "PENDING") {
      return badRequest(`Cannot transition from ${before.status} — induction is already decided.`);
    }

    // Optimistic-lock guard — reject on a stale read so two reviewers
    // tapping Approve on the same row at the same time don't double-commit.
    const conflict = checkConflict(expectedUpdatedAt, before.updatedAt, {
      id: before.id,
      status: before.status,
    });
    if (!conflict.ok) return conflict.response!;

    const now = new Date();
    const updated = await prisma.safetyInduction.update({
      where: { id: before.id },
      data: {
        status,
        approvedById: status === "APPROVED" ? session.user.id : null,
        approvedAt: status === "APPROVED" ? now : null,
        rejectedById: status === "REJECTED" ? session.user.id : null,
        rejectedAt: status === "REJECTED" ? now : null,
        rejectionReason: status === "REJECTED" ? rejectionReason?.trim() || null : null,
      },
      include: inductionInclude,
    });

    // Belt-and-braces module-scope check on the just-loaded row — a
    // SAFETY-scoped approver can only decide SAFETY inductions. Here
    // we don't persist a module tag on SafetyInduction (every row is
    // SAFETY by definition), so canAccessScopedRow trivially passes;
    // the call documents the intent for future contributors who might
    // scope the model further.
    void canAccessScopedRow;

    await recordAudit({
      projectId: before.projectId,
      userId: session.user.id,
      action: "STATUS_CHANGE",
      entityType: "SafetyInduction",
      entityId: before.id,
      summary: `Safety induction ${before.displayId} for ${before.workerName} → ${status}${
        status === "REJECTED" && rejectionReason?.trim() ? ` (${rejectionReason.slice(0, 60)})` : ""
      }`,
    });

    // Push the maker — they want to know their induction got approved
    // (worker can start) or rejected (what to fix). Awaited for the
    // same reason as inspections — see notifications_await_fix memory.
    const reviewer = updated.approvedBy?.name ?? updated.rejectedBy?.name ?? session.user.username;
    await sendPushToUser(before.createdById, {
      title:
        status === "APPROVED"
          ? `Induction approved · ${before.workerName}`
          : `Induction rejected · ${before.workerName}`,
      body:
        status === "APPROVED"
          ? `${before.displayId} approved by ${reviewer}. Valid 12 months.`
          : `${before.displayId} rejected by ${reviewer}.${rejectionReason?.trim() ? ` Reason: ${rejectionReason.slice(0, 100)}` : ""}`,
      url: `/mobile/${before.projectId}/induction/${before.id}`,
      tag: `induction-${before.id}`,
    });

    return NextResponse.json({ induction: updated });
  } catch (e) {
    return handleApiError(e, "safety-inductions/[id] PATCH");
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return unauthorized();
    if (!canAccessModule(session.user.modules, MODULES.SAFETY)) return forbidden();

    const { id } = await ctx.params;
    const existing = await prisma.safetyInduction.findUnique({
      where: { id },
      select: { id: true, projectId: true, createdById: true, displayId: true, workerName: true, status: true },
    });
    if (!existing) return notFound();

    // Only the maker (or a reviewer) can soft-delete. The maker might
    // realise they typed the wrong worker's name and want to clean up;
    // the reviewer might cull a duplicate. Any other user is blocked.
    const isMaker = existing.createdById === session.user.id;
    const isReviewer = canReview(session.user.role);
    if (!isMaker && !isReviewer) return forbidden();

    const now = new Date();
    await prisma.safetyInduction.update({
      where: { id: existing.id },
      data: { deletedAt: now },
    });

    await recordAudit({
      projectId: existing.projectId,
      userId: session.user.id,
      action: "DELETE",
      entityType: "SafetyInduction",
      entityId: existing.id,
      summary: `Safety induction ${existing.displayId} for ${existing.workerName} soft-deleted (was ${existing.status})`,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e, "safety-inductions/[id] DELETE");
  }
}
