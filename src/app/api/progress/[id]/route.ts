import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin, ROLES } from "@/lib/roles";
import { recordAudit, diffSummary } from "@/lib/audit";
import {
  badRequest,
  forbidden,
  handleApiError,
  notFound,
  unauthorized,
} from "@/lib/apiErrors";

const VALID_TYPES = new Set(["LABOUR_SUPPLY", "PRW", "MISC"]);

type LabourInput = { category?: string; count?: number };

function canEditAnyEntry(role: string): boolean {
  return role === ROLES.PLANNER || role === ROLES.PRODUCT_TEAM || isAdmin(role);
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/progress/[id]">) {
  const session = await auth();
  if (!session?.user) return unauthorized();

  const { id } = await ctx.params;
  const entry = await prisma.progressEntry.findUnique({
    where: { id },
    select: {
      id: true,
      createdById: true,
      wbsNodeId: true,
      projectId: true,
      date: true,
      type: true,
      achievedQuantity: true,
      cumulativeQuantity: true,
      contractorId: true,
      notes: true,
    },
  });
  if (!entry) return notFound();

  // Engineer can only edit own; Planner+ can edit any.
  if (entry.createdById !== session.user.id && !canEditAnyEntry(session.user.role)) {
    return forbidden();
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  const {
    date,
    type,
    achievedQuantity,
    cumulativeQuantity,
    contractorId,
    notes,
    labour,
  } = (body ?? {}) as {
    date?: string;
    type?: string;
    achievedQuantity?: number;
    cumulativeQuantity?: number;
    contractorId?: string | null;
    notes?: string;
    labour?: LabourInput[];
  };

  const data: {
    date?: Date;
    type?: string;
    achievedQuantity?: number;
    cumulativeQuantity?: number;
    contractorId?: string | null;
    notes?: string | null;
  } = {};

  if (date !== undefined) {
    const d = new Date(date);
    if (isNaN(d.getTime())) return badRequest("Invalid date");
    data.date = d;
  }
  if (type !== undefined) {
    if (!VALID_TYPES.has(type)) return badRequest("Invalid type");
    data.type = type;
  }
  if (achievedQuantity !== undefined) {
    const n = Number(achievedQuantity);
    if (!isFinite(n) || n < 0) return badRequest("Invalid achievedQuantity");
    data.achievedQuantity = n;
  }
  if (cumulativeQuantity !== undefined) {
    const n = Number(cumulativeQuantity);
    if (!isFinite(n) || n < 0) return badRequest("Invalid cumulativeQuantity");
    data.cumulativeQuantity = n;
  }
  if (contractorId !== undefined) data.contractorId = contractorId || null;
  if (notes !== undefined) data.notes = (notes ?? "").trim() || null;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.progressEntry.update({ where: { id }, data });

      // Replace labour records if provided
      if (Array.isArray(labour)) {
        const clean = labour
          .map((l) => ({
            category: (l.category ?? "").trim(),
            count: Math.max(0, Math.floor(Number(l.count ?? 0))),
          }))
          .filter((l) => l.category.length > 0 && l.count > 0);
        await tx.progressLabour.deleteMany({ where: { progressEntryId: id } });
        if (clean.length > 0) {
          await tx.progressLabour.createMany({
            data: clean.map((c) => ({ ...c, progressEntryId: id })),
          });
        }
      }

      // Recompute activity % if cumulative changed
      if (data.cumulativeQuantity !== undefined) {
        const node = await tx.wBSNode.findUnique({
          where: { id: u.wbsNodeId },
          select: { totalQuantity: true, actualStart: true, actualFinish: true },
        });
        if (node?.totalQuantity && node.totalQuantity > 0) {
          const pct = Math.max(
            0,
            Math.min(100, (data.cumulativeQuantity / node.totalQuantity) * 100),
          );
          const updates: { percentComplete: number; actualFinish?: Date | null } = {
            percentComplete: pct,
          };
          if (pct >= 100 && !node.actualFinish && data.date) updates.actualFinish = data.date;
          if (pct < 100 && node.actualFinish) updates.actualFinish = null;
          await tx.wBSNode.update({ where: { id: u.wbsNodeId }, data: updates });
        }
      }
      return u;
    });

    const diff = diffSummary(
      {
        date: entry.date,
        type: entry.type,
        achievedQuantity: entry.achievedQuantity,
        cumulativeQuantity: entry.cumulativeQuantity,
        contractorId: entry.contractorId,
        notes: entry.notes,
      },
      {
        date: updated.date,
        type: updated.type,
        achievedQuantity: updated.achievedQuantity,
        cumulativeQuantity: updated.cumulativeQuantity,
        contractorId: updated.contractorId,
        notes: updated.notes,
      },
    );
    await recordAudit({
      projectId: entry.projectId,
      userId: session.user.id,
      action: "UPDATE",
      entityType: "ProgressEntry",
      entityId: entry.id,
      summary: diff.summary || "Progress entry updated",
      changes: diff.changes,
    });

    return NextResponse.json({ entry: updated });
  } catch (e) {
    return handleApiError(e, "PATCH /api/progress/:id");
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/progress/[id]">) {
  const session = await auth();
  if (!session?.user) return unauthorized();

  const { id } = await ctx.params;
  const entry = await prisma.progressEntry.findUnique({
    where: { id },
    select: { id: true, createdById: true, projectId: true },
  });
  if (!entry) return notFound();

  if (entry.createdById !== session.user.id && !canEditAnyEntry(session.user.role)) {
    return forbidden();
  }

  try {
    await prisma.progressEntry.delete({ where: { id } });
    await recordAudit({
      projectId: entry.projectId,
      userId: session.user.id,
      action: "DELETE",
      entityType: "ProgressEntry",
      entityId: entry.id,
      summary: "Progress entry deleted",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e, "DELETE /api/progress/:id");
  }
}
