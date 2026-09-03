import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin, ROLES } from "@/lib/roles";
import { recordAudit, diffSummary } from "@/lib/audit";
import { canAccessModule, MODULES } from "@/lib/modules";
import { milestoneCompletionEmail, sendEmail } from "@/lib/email";
import { syncVillaMilestoneFromChildren } from "@/lib/milestoneRollup";
import { parseBody } from "@/lib/parseBody";
import {
  badRequest,
  forbidden,
  handleApiError,
  notFound,
  unauthorized,
} from "@/lib/apiErrors";

const PatchProgressSchema = z.object({
  date: z.string().datetime({ offset: true }).optional(),
  type: z.enum(["LABOUR_SUPPLY", "PRW", "MISC"]).optional(),
  achievedQuantity: z.number().finite().min(0).max(1_000_000).optional(),
  cumulativeQuantity: z.number().finite().min(0).max(1_000_000).optional(),
  contractorId: z.string().min(1).nullable().optional(),
  notes: z.string().max(2000).optional(),
  labour: z.array(
    z.object({
      category: z.string().max(60).optional(),
      count: z.number().finite().min(0).max(500).optional(),
    }),
  ).max(20).optional(),
});

const SIDDHI_BASE_URL = process.env.SIDDHI_BASE_URL || "https://siddhi-whitelotus.vercel.app";

/** Same helper as in POST — sends milestone-completion email for sub-milestone
 *  WBS nodes that just crossed to actualFinish. Silent no-op otherwise. */
async function maybeSendMilestoneCompletionEmail(wbsNodeId: string, actualFinishDate: Date) {
  const node = await prisma.wBSNode.findUnique({
    where: { id: wbsNodeId },
    select: {
      isSubMilestone: true,
      villaMilestone: {
        select: {
          baselineFinish: true,
          villa: {
            select: {
              number: true,
              label: true,
              project: { select: { id: true, name: true } },
            },
          },
          section: { select: { name: true } },
        },
      },
    },
  });
  if (!node?.isSubMilestone || !node.villaMilestone) return;
  const vm = node.villaMilestone;
  await sendEmail(
    milestoneCompletionEmail({
      projectName: vm.villa.project.name,
      villaLabel: vm.villa.label ?? `Villa ${vm.villa.number}`,
      sectionName: vm.section?.name ?? "Milestone",
      actualFinish: actualFinishDate,
      baselineFinish: vm.baselineFinish,
      dashboardUrl: `${SIDDHI_BASE_URL}/projects/${vm.villa.project.id}/overview?vn=${vm.villa.number}`,
    }),
  );
}

function canEditAnyEntry(role: string): boolean {
  return role === ROLES.PLANNER || role === ROLES.PRODUCT_TEAM || isAdmin(role);
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/progress/[id]">) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  if (!canAccessModule(session.user.modules, MODULES.PROGRESS)) return forbidden();

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

  const parsed = await parseBody(req, PatchProgressSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const { date, type, achievedQuantity, cumulativeQuantity, contractorId, notes, labour } = body;

  const data: {
    date?: Date;
    type?: string;
    achievedQuantity?: number;
    cumulativeQuantity?: number;
    contractorId?: string | null;
    notes?: string | null;
  } = {};

  if (date !== undefined) data.date = new Date(date);
  if (type !== undefined) data.type = type;
  if (achievedQuantity !== undefined) data.achievedQuantity = achievedQuantity;
  if (cumulativeQuantity !== undefined) data.cumulativeQuantity = cumulativeQuantity;
  if (contractorId !== undefined) data.contractorId = contractorId || null;
  if (notes !== undefined) data.notes = notes.trim() || null;

  // A contractor must belong to the entry's project — otherwise a foreign
  // contractor would pollute this project's labour/contractor rollups.
  if (data.contractorId) {
    const contractor = await prisma.contractor.findUnique({
      where: { id: data.contractorId },
      select: { projectId: true },
    });
    if (!contractor || contractor.projectId !== entry.projectId) {
      return badRequest("Invalid contractor for this project");
    }
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.progressEntry.update({ where: { id }, data });

      // Replace labour records if provided
      if (labour !== undefined) {
        const clean = labour
          .map((l) => ({
            category: (l.category ?? "").trim(),
            count: Math.floor(l.count ?? 0),
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
          // Use the edited date if supplied, else the entry's existing date, so
          // start/finish stamps land correctly even when the date isn't changed.
          const stamp = data.date ?? entry.date;
          const updates: {
            percentComplete: number;
            progressEntered: boolean;
            actualStart?: Date;
            actualFinish?: Date | null;
          } = { percentComplete: pct, progressEntered: true };
          // Mirror the POST path: stamp actualStart on first progress, and
          // set/clear actualFinish as the activity crosses 100%.
          if (!node.actualStart) updates.actualStart = stamp;
          if (pct >= 100 && !node.actualFinish) updates.actualFinish = stamp;
          if (pct < 100 && node.actualFinish) updates.actualFinish = null;
          await tx.wBSNode.update({ where: { id: u.wbsNodeId }, data: updates });

          // Roll up to parent VillaMilestone. This handles both the "just
          // closed" and "just re-opened" cases — the sync recomputes both
          // pctComplete and actualFinish from all children.
          const villaMilestoneId = (await tx.wBSNode.findUnique({
            where: { id: u.wbsNodeId },
            select: { villaMilestoneId: true },
          }))?.villaMilestoneId;
          if (villaMilestoneId) {
            await syncVillaMilestoneFromChildren(tx, villaMilestoneId);
          }

          // Signal via the returned tuple so the email fires after commit.
          if (updates.actualFinish) {
            (u as unknown as { __justClosed?: Date }).__justClosed = updates.actualFinish;
          }
        }
      }
      return u;
    });

    const justClosed = (updated as unknown as { __justClosed?: Date }).__justClosed;
    if (justClosed) {
      await maybeSendMilestoneCompletionEmail(updated.wbsNodeId, justClosed);
    }

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
  if (!canAccessModule(session.user.modules, MODULES.PROGRESS)) return forbidden();

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
    // Soft-delete: mark deletedAt instead of removing. Admin can restore from
    // /admin/trash. Photos and labour rows stay attached to the entry.
    await prisma.progressEntry.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await recordAudit({
      projectId: entry.projectId,
      userId: session.user.id,
      action: "DELETE",
      entityType: "ProgressEntry",
      entityId: entry.id,
      summary: "Progress entry moved to trash",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e, "DELETE /api/progress/:id");
  }
}
