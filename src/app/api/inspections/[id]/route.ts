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

const PatchInspectionSchema = z.object({
  status: z.enum(["IN_REVIEW", "PASSED", "REJECTED"]),
  rejectionReason: z.string().max(1000).optional(),
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
  const { status, rejectionReason, expectedUpdatedAt } = parsed.data;

  try {
    const before = await prisma.inspection.findUnique({
      where: { id },
      select: { id: true, projectId: true, status: true, title: true, updatedAt: true, module: true },
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
      await recordAudit({
        projectId: inspection.projectId,
        userId: session.user.id,
        action: "STATUS_CHANGE",
        entityType: "Inspection",
        entityId: inspection.id,
        summary: `Inspection "${before.title}" → ${status}${
          status === "REJECTED" && rejectionReason ? ` (${rejectionReason.slice(0, 60)})` : ""
        }`,
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
