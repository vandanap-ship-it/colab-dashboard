import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";
import { recordAudit } from "@/lib/audit";
import { PERMIT_STATUSES } from "@/lib/permit";
import {
  badRequest,
  forbidden,
  handleApiError,
  notFound,
  unauthorized,
} from "@/lib/apiErrors";
import { parseBody } from "@/lib/parseBody";

const PatchPermitSchema = z.object({
  status: z.enum(PERMIT_STATUSES).optional(),
  expiryDate: z.string().nullable().optional(),
  renewalReminderDays: z.number().int().min(1).max(365).optional(),
  notes: z.string().max(2000).nullable().optional(),
  documentUrl: z.string().url().max(2000).nullable().optional(),
  responsibleUserId: z.string().min(1).nullable().optional(),
});

const PERMIT_INCLUDE = {
  responsible: { select: { id: true, name: true } },
} as const;

export async function GET(_req: Request, ctx: RouteContext<"/api/permits/[id]">) {
  try {
    const session = await auth();
    if (!session?.user) return unauthorized();
    if (!canAccessModule(session.user.modules, MODULES.PERMIT)) return forbidden();
    const { id } = await ctx.params;
    const permit = await prisma.permit.findUnique({ where: { id }, include: PERMIT_INCLUDE });
    if (!permit) return notFound();
    return NextResponse.json({ permit });
  } catch (e) {
    return handleApiError(e, "permits/[id]");
  }
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/permits/[id]">) {
  try {
    const session = await auth();
    if (!session?.user) return unauthorized();
    if (!canAccessModule(session.user.modules, MODULES.PERMIT)) return forbidden();

    const { id } = await ctx.params;
    const existing = await prisma.permit.findUnique({ where: { id } });
    if (!existing) return notFound();

    const parsed = await parseBody(req, PatchPermitSchema);
    if (!parsed.ok) return parsed.response;
    const patch = parsed.data;

    const data: Record<string, unknown> = {};
    const changes: string[] = [];

    if (patch.status && patch.status !== existing.status) {
      data.status = patch.status;
      changes.push(`status: ${existing.status} → ${patch.status}`);
    }
    if (patch.expiryDate !== undefined) {
      const next = patch.expiryDate ? new Date(patch.expiryDate) : null;
      if (patch.expiryDate && isNaN(next!.getTime())) return badRequest("Invalid expiryDate");
      const before = existing.expiryDate?.toISOString().slice(0, 10) ?? "permanent";
      const after = next?.toISOString().slice(0, 10) ?? "permanent";
      if (before !== after) {
        data.expiryDate = next;
        changes.push(`expiry: ${before} → ${after}`);
      }
    }
    if (patch.renewalReminderDays != null && patch.renewalReminderDays !== existing.renewalReminderDays) {
      data.renewalReminderDays = patch.renewalReminderDays;
      changes.push(`reminder: ${existing.renewalReminderDays}d → ${patch.renewalReminderDays}d`);
    }
    if (patch.notes !== undefined) data.notes = patch.notes?.trim() || null;
    if (patch.documentUrl !== undefined) data.documentUrl = patch.documentUrl?.trim() || null;
    if (patch.responsibleUserId !== undefined && patch.responsibleUserId !== existing.responsibleUserId) {
      data.responsibleUserId = patch.responsibleUserId || null;
      changes.push(`reassigned`);
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ permit: existing });
    }

    const updated = await prisma.permit.update({ where: { id }, data, include: PERMIT_INCLUDE });

    if (changes.length > 0) {
      await recordAudit({
        projectId: existing.projectId,
        userId: session.user.id,
        action: "UPDATE",
        entityType: "Permit",
        entityId: id,
        summary: `${existing.name} · ${changes.join(", ")}`,
      });
    }

    return NextResponse.json({ permit: updated });
  } catch (e) {
    return handleApiError(e, "permits/[id]");
  }
}
