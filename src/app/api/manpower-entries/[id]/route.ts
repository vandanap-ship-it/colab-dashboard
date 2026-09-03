import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canAccessModule, MODULES } from "@/lib/modules";
import { isAdmin } from "@/lib/roles";
import { forbidden, handleApiError, notFound, unauthorized } from "@/lib/apiErrors";

/** Soft-delete a manpower entry. Logger or admin only. Restorable via
 *  /api/admin/restore. The entry stops contributing to daily/weekly totals
 *  once removed but the audit trail keeps the number that was originally
 *  logged. */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  if (!canAccessModule(session.user.modules, MODULES.PROGRESS)) return forbidden();

  const { id } = await ctx.params;
  const entry = await prisma.manpowerEntry.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      projectId: true,
      trade: true,
      actualCount: true,
      entryDate: true,
      createdById: true,
      contractor: { select: { name: true } },
    },
  });
  if (!entry) return notFound();
  if (entry.createdById !== session.user.id && !isAdmin(session.user.role)) return forbidden();

  try {
    await prisma.manpowerEntry.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordAudit({
      projectId: entry.projectId,
      userId: session.user.id,
      action: "DELETE",
      entityType: "ManpowerEntry",
      entityId: id,
      summary: `Manpower entry removed: ${entry.contractor.name} · ${entry.trade} · ${entry.entryDate.toISOString().slice(0, 10)} (was ${entry.actualCount})`,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e, "DELETE /api/manpower-entries/:id");
  }
}
