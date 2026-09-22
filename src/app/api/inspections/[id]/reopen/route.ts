/**
 * POST /api/inspections/[id]/reopen
 *
 * Companion to /reschedule: pull a parked WIR back into the active review
 * queue. Clears rescheduledFor and rescheduledNote, flips status to
 * IN_REVIEW, and notifies the filler and the assigned reviewers (or the
 * role-based reviewer fallback) so the queue reflects the new state.
 *
 * Same module-gate as /reschedule: any user with QA/QC or Safety module
 * access can reopen — the filler themselves, a reviewer, an admin. On
 * Colab the "unpark" affordance sits inside the same detail view as
 * the reschedule button; the parity here is deliberate.
 *
 * Refuses anything that isn't currently RESCHEDULED. A PASSED or REJECTED
 * WIR has been reviewed and shouldn't be silently reopened from this
 * path; a fresh IN_REVIEW is already active — there's nothing to reopen.
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

const ReopenSchema = z.object({
  expectedUpdatedAt: z.string().optional(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/inspections/[id]/reopen">) {
  const session = await auth();
  if (!session?.user) return unauthorized();

  if (
    !canAccessModule(session.user.modules, MODULES.QAQC) &&
    !canAccessModule(session.user.modules, MODULES.SAFETY)
  ) {
    return forbidden();
  }

  const { id } = await ctx.params;
  const parsed = await parseBody(req, ReopenSchema);
  if (!parsed.ok) return parsed.response;
  const { expectedUpdatedAt } = parsed.data;

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
        rescheduledFor: true,
      },
    });
    if (!before) return notFound();
    if (!canAccessScopedRow(session.user.modules, before.module)) return forbidden();

    if (before.status !== "RESCHEDULED") {
      return NextResponse.json(
        { error: `Nothing to reopen — this WIR is ${before.status.toLowerCase()}.` },
        { status: 409 },
      );
    }

    const conflict = checkConflict(expectedUpdatedAt, before.updatedAt, {
      id: before.id,
      status: before.status,
      title: before.title,
    });
    if (!conflict.ok) return conflict.response!;

    const inspection = await prisma.inspection.update({
      where: { id },
      data: {
        status: "IN_REVIEW",
        // Clear the parked-date fields — historical state lives in the
        // AuditLog trail; keeping stale rescheduledFor on an active WIR
        // would confuse every card that renders "Reopens {date}".
        rescheduledFor: null,
        rescheduledNote: null,
      },
      include: {
        filledBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
        items: { orderBy: { orderIndex: "asc" } },
        photos: true,
      },
    });

    const wasParkedFor = before.rescheduledFor
      ? before.rescheduledFor.toISOString().slice(0, 10)
      : null;

    await recordAudit({
      projectId: inspection.projectId,
      userId: session.user.id,
      action: "STATUS_CHANGE",
      entityType: "Inspection",
      entityId: inspection.id,
      summary: `Inspection "${before.title.slice(0, 60)}${before.title.length > 60 ? "…" : ""}" reopened${wasParkedFor ? ` (was parked for ${wasParkedFor})` : ""}`,
    });

    // Notify: the filler (if it wasn't them) + every assigned reviewer.
    // Falls back to the role-based broadcast when the WIR had no
    // explicit reviewers — same shape as /reschedule so the two
    // endpoints stay symmetric.
    const toNotify = new Set<string>();
    if (before.filledById && before.filledById !== session.user.id) toNotify.add(before.filledById);
    if (before.assignedReviewerIds.length > 0) {
      for (const rid of before.assignedReviewerIds) {
        if (rid !== session.user.id) toNotify.add(rid);
      }
    } else {
      const reviewers = await prisma.user.findMany({
        where: {
          active: true,
          role: { in: [ROLES.PLANNER, ROLES.PRODUCT_TEAM, ROLES.ADMIN] },
          id: { not: session.user.id },
        },
        select: { id: true },
      });
      for (const r of reviewers) toNotify.add(r.id);
    }
    for (const uid of toNotify) {
      void sendPushToUser(uid, {
        title: `WIR reopened · ${before.title.slice(0, 40)}`,
        body: `${session.user.name ?? session.user.username} moved it back into the review queue.`,
        url: `/mobile/${inspection.projectId}/qaqc/${inspection.id}`,
        tag: `wir-reopen-${inspection.id}`,
      });
    }

    return NextResponse.json({ inspection });
  } catch (e) {
    return handleApiError(e, "POST /api/inspections/:id/reopen");
  }
}
