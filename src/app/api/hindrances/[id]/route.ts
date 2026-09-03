import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canReview, isAdmin } from "@/lib/roles";
import { canAccessModule, MODULES } from "@/lib/modules";
import { recordAudit, diffSummary } from "@/lib/audit";
import { checkConflict } from "@/lib/optimisticLock";
import { parseBody } from "@/lib/parseBody";
import {
  badRequest,
  forbidden,
  handleApiError,
  notFound,
  unauthorized,
} from "@/lib/apiErrors";

const PatchHindranceSchema = z.object({
  status: z.enum(["OPEN", "RESOLVED"]).optional(),
  daysImpact: z.number().finite().min(0).max(365).optional(),
  expectedUpdatedAt: z.string().optional(),
});

export async function PATCH(req: Request, ctx: RouteContext<"/api/hindrances/[id]">) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  // A contractor without HINDRANCE access must not edit a hindrance by ID,
  // even fields that don't require reviewer rights (IDOR guard).
  if (!canAccessModule(session.user.modules, MODULES.HINDRANCE)) return forbidden();

  const { id } = await ctx.params;
  const parsed = await parseBody(req, PatchHindranceSchema);
  if (!parsed.ok) return parsed.response;
  const { status, daysImpact, expectedUpdatedAt } = parsed.data;

  if (status === "RESOLVED" && !canReview(session.user.role)) {
    return forbidden();
  }

  const data: { status?: string; daysImpact?: number; resolvedDate?: Date | null } = {};
  if (status) {
    data.status = status;
    if (status === "RESOLVED") data.resolvedDate = new Date();
    if (status === "OPEN") data.resolvedDate = null;
  }
  if (daysImpact != null) data.daysImpact = Math.floor(daysImpact);
  if (Object.keys(data).length === 0) return badRequest("Nothing to update");

  try {
    const before = await prisma.hindrance.findUnique({
      where: { id },
      select: { id: true, projectId: true, status: true, daysImpact: true, updatedAt: true },
    });
    if (!before) return notFound();
    // Optimistic-lock guard — reject if someone else edited between the
    // client's read and this write. No-op when the client didn't send
    // expectedUpdatedAt (backward compat during rollout).
    const conflict = checkConflict(expectedUpdatedAt, before.updatedAt, {
      id: before.id,
      status: before.status,
      daysImpact: before.daysImpact,
    });
    if (!conflict.ok) return conflict.response!;
    const hindrance = await prisma.hindrance.update({
      where: { id },
      data,
      include: {
        createdBy: { select: { id: true, name: true } },
        wbsNode: { select: { id: true, name: true } },
        photos: true,
      },
    });
    {
      const diff = diffSummary(
        { status: before.status, daysImpact: before.daysImpact },
        { status: hindrance.status, daysImpact: hindrance.daysImpact },
      );
      const isStatusChange = before.status !== hindrance.status;
      await recordAudit({
        projectId: hindrance.projectId,
        userId: session.user.id,
        action: isStatusChange ? "STATUS_CHANGE" : "UPDATE",
        entityType: "Hindrance",
        entityId: hindrance.id,
        summary:
          diff.summary ||
          (isStatusChange ? `Hindrance → ${hindrance.status}` : "Hindrance updated"),
        changes: diff.changes,
      });
    }
    return NextResponse.json({ hindrance });
  } catch (e) {
    return handleApiError(e, "PATCH /api/hindrances/:id");
  }
}

/** Soft-delete a hindrance. Creator or admin only. Sets deletedAt so the
 *  record moves to /admin/trash and can be restored via /api/admin/restore. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/hindrances/[id]">) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  if (!canAccessModule(session.user.modules, MODULES.HINDRANCE)) return forbidden();

  const { id } = await ctx.params;
  const existing = await prisma.hindrance.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, projectId: true, description: true, createdById: true },
  });
  if (!existing) return notFound();
  // Creator OR admin. Reviewers (planners) don't get the delete right — they
  // can already RESOLVE via PATCH; removal is a stronger act reserved for
  // whoever raised it and for admins cleaning up.
  if (existing.createdById !== session.user.id && !isAdmin(session.user.role)) return forbidden();

  try {
    await prisma.hindrance.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordAudit({
      projectId: existing.projectId,
      userId: session.user.id,
      action: "DELETE",
      entityType: "Hindrance",
      entityId: id,
      summary: `Hindrance moved to trash: ${existing.description.slice(0, 60)}${existing.description.length > 60 ? "…" : ""}`,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e, "DELETE /api/hindrances/:id");
  }
}
