/**
 * POST /api/inspections/[id]/reschedule
 *
 * Colab-parity third action alongside "Save As Draft" and "Send For
 * Review": park an inspection until a later date because the site isn't
 * ready for it (rebar delivery slipped, permit not yet issued, etc.).
 *
 * Sets Inspection.status = "RESCHEDULED" and Inspection.rescheduledFor,
 * plus an optional Inspection.rescheduledNote. Anyone with QA/QC or
 * Safety module access can reschedule — the filler themselves, a reviewer,
 * or an admin — because on Colab any of them can pick this action.
 *
 * The push notification tells the original filler + the assigned reviewers
 * (or the role-based reviewer set when no explicit reviewers were picked)
 * so the queue reflects the new date without anyone having to refresh.
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

const RescheduleSchema = z.object({
  // ISO date string (YYYY-MM-DD or full ISO). The client sends it from a
  // date picker; the server accepts either and coerces to a Date. Refuses
  // dates in the past — a "reschedule to yesterday" is either a bug or a
  // misfire, and letting it through leaves the WIR parked in a state the
  // list view has no bucket for.
  rescheduledFor: z.string().min(4).max(64),
  note: z.string().max(500).optional(),
  expectedUpdatedAt: z.string().optional(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/inspections/[id]/reschedule">) {
  const session = await auth();
  if (!session?.user) return unauthorized();

  // Module gate — the same rule as PATCH /api/inspections/[id]: any user
  // with QA/QC OR Safety access can act on an inspection they can see.
  if (
    !canAccessModule(session.user.modules, MODULES.QAQC) &&
    !canAccessModule(session.user.modules, MODULES.SAFETY)
  ) {
    return forbidden();
  }

  const { id } = await ctx.params;
  const parsed = await parseBody(req, RescheduleSchema);
  if (!parsed.ok) return parsed.response;
  const { rescheduledFor, note, expectedUpdatedAt } = parsed.data;

  const parsedDate = new Date(rescheduledFor);
  if (isNaN(parsedDate.getTime())) {
    return NextResponse.json({ error: "Invalid rescheduledFor date" }, { status: 400 });
  }
  // Compare against start-of-today in server tz — a same-day reschedule
  // is fine ("reopen at 3pm"), but yesterday is not.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (parsedDate.getTime() < startOfToday.getTime()) {
    return NextResponse.json({ error: "Reschedule date must be today or later." }, { status: 400 });
  }

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

    // Once a WIR has been PASSED, rescheduling makes no sense — the
    // reviewer has already signed it off. Rejected WIRs are meant to be
    // re-submitted (a fresh row), not parked. Only IN_REVIEW and existing
    // RESCHEDULED rows may be pushed to a new date.
    if (before.status !== "IN_REVIEW" && before.status !== "RESCHEDULED") {
      return NextResponse.json(
        { error: `Can't reschedule a ${before.status.toLowerCase()} inspection.` },
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
        status: "RESCHEDULED",
        rescheduledFor: parsedDate,
        rescheduledNote: note?.trim() || null,
      },
      include: {
        filledBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
        items: { orderBy: { orderIndex: "asc" } },
        photos: true,
      },
    });

    await recordAudit({
      projectId: inspection.projectId,
      userId: session.user.id,
      action: "STATUS_CHANGE",
      entityType: "Inspection",
      entityId: inspection.id,
      summary: `Inspection "${before.title.slice(0, 60)}${before.title.length > 60 ? "…" : ""}" rescheduled to ${parsedDate.toISOString().slice(0, 10)}${note?.trim() ? ` — ${note.trim().slice(0, 80)}` : ""}`,
    });

    // Notify: the filler (if it wasn't them clicking Reschedule) + every
    // assigned reviewer. Fall back to role-based reviewers when the WIR
    // had none explicitly picked.
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
    const dateLabel = parsedDate.toISOString().slice(0, 10);
    for (const uid of toNotify) {
      void sendPushToUser(uid, {
        title: `WIR rescheduled · ${before.title.slice(0, 40)}`,
        body: `${session.user.name ?? session.user.username} pushed the inspection to ${dateLabel}.${note?.trim() ? ` "${note.trim().slice(0, 80)}"` : ""}`,
        url: `/mobile/${inspection.projectId}/qaqc/${inspection.id}`,
        tag: `wir-reschedule-${inspection.id}`,
      });
    }

    return NextResponse.json({ inspection });
  } catch (e) {
    return handleApiError(e, "POST /api/inspections/:id/reschedule");
  }
}
