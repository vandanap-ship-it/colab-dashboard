import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import { recordAudit } from "@/lib/audit";
import { badRequest, forbidden, handleApiError, notFound, unauthorized } from "@/lib/apiErrors";
import { parseBody } from "@/lib/parseBody";

/**
 * Admin-only contractor edit + retire. Contractor has no `deletedAt` on the
 * schema — retiring uses `active: false` instead, which is what every
 * downstream query already filters against (e.g. the manpower plan editor
 * shows only active contractors in the picker). Retire is reversible via
 * PATCH { active: true }.
 */

const PatchContractorSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  category: z.string().min(2).max(80).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  if (!isAdmin(session.user.role)) return forbidden();

  const { id } = await ctx.params;
  const contractor = await prisma.contractor.findUnique({
    where: { id },
    select: { id: true, projectId: true, name: true, category: true, active: true },
  });
  if (!contractor) return notFound();

  const parsed = await parseBody(req, PatchContractorSchema);
  if (!parsed.ok) return parsed.response;
  const patch = parsed.data;
  if (Object.keys(patch).length === 0) return badRequest("Nothing to update");

  try {
    const data: { name?: string; category?: string; active?: boolean } = {};
    if (patch.name !== undefined) data.name = patch.name.trim();
    if (patch.category !== undefined) data.category = patch.category.trim();
    if (patch.active !== undefined) data.active = patch.active;

    const updated = await prisma.contractor.update({ where: { id }, data });

    // Auditing intent — retire is a stronger action than a rename, so its
    // summary reads distinctly in /admin/audit.
    const isRetire = patch.active === false && contractor.active === true;
    const isReactivate = patch.active === true && contractor.active === false;
    await recordAudit({
      projectId: contractor.projectId,
      userId: session.user.id,
      action: isRetire || isReactivate ? "STATUS_CHANGE" : "UPDATE",
      entityType: "Contractor",
      entityId: id,
      summary:
        isRetire ? `Contractor retired: ${contractor.name}` :
        isReactivate ? `Contractor reactivated: ${contractor.name}` :
        `Contractor updated: ${contractor.name}`,
    });
    return NextResponse.json({ contractor: updated });
  } catch (e) {
    if (typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002") {
      return badRequest("A contractor with that name already exists for this project");
    }
    return handleApiError(e, "PATCH /api/admin/contractors/:id");
  }
}

/** Retire (soft) a contractor. Shortcut for PATCH { active: false } — matches
 *  the DELETE ergonomics of other admin routes. Contractor rows are never
 *  hard-deleted because they're referenced by progress entries, bills,
 *  manpower and wbsNodes; retiring hides them from active pickers instead. */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  if (!isAdmin(session.user.role)) return forbidden();

  const { id } = await ctx.params;
  const contractor = await prisma.contractor.findUnique({
    where: { id },
    select: { id: true, projectId: true, name: true, active: true },
  });
  if (!contractor) return notFound();
  if (!contractor.active) return NextResponse.json({ ok: true, alreadyInactive: true });

  try {
    await prisma.contractor.update({ where: { id }, data: { active: false } });
    await recordAudit({
      projectId: contractor.projectId,
      userId: session.user.id,
      action: "STATUS_CHANGE",
      entityType: "Contractor",
      entityId: id,
      summary: `Contractor retired: ${contractor.name}`,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e, "DELETE /api/admin/contractors/:id");
  }
}
