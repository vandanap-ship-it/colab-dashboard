import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canAccessModule, MODULES } from "@/lib/modules";
import { checkPrecheck } from "@/lib/progressGates";
import { isValidReasonCode } from "@/lib/hindranceReasons";
import { syncVillaMilestoneFromChildren } from "@/lib/milestoneRollup";
import { parseBody, zDateString } from "@/lib/parseBody";
import { maybeSendMilestoneCompletionEmail } from "@/lib/progressPublish";

/**
 * POST /api/progress/[id]/publish
 *
 * Converts a DRAFT ProgressEntry into a PUBLISHED one. Body is the same
 * shape the mobile form's Save-progress path sends — the engineer may
 * have edited fields on the resumed form, so we let them overwrite the
 * whole row before publishing.
 *
 * Fires everything POST /api/progress fires on a fresh publish:
 *   1. Precheck gate (a draft that skipped the gate has to pass it now).
 *   2. Percent-complete rollup + VillaMilestone sync.
 *   3. Milestone-completion email if the activity crossed to done.
 *   4. Audit line as CREATE — this is the row's first "real" state.
 *
 * The draft's own createdAt is preserved so historical listing order
 * stays honest ("this progress happened last Tuesday, the engineer
 * just took two days to publish it").
 */

const PublishSchema = z.object({
  date: zDateString.optional(),
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
  photoUrls: z.array(z.string().url()).max(6).optional(),
  reasonCode: z.string().max(40).optional(),
  reasonNote: z.string().max(500).optional(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/progress/[id]/publish">) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAccessModule(session.user.modules, MODULES.PROGRESS)) {
    return NextResponse.json({ error: "Your account doesn't have access to progress logging." }, { status: 403 });
  }

  const { id } = await ctx.params;
  // findFirst with explicit status filter — the Prisma soft-filter would
  // otherwise hide DRAFT rows and every publish call would return 404.
  const draft = await prisma.progressEntry.findFirst({
    where: { id, status: "DRAFT", deletedAt: null },
    select: {
      id: true,
      projectId: true,
      wbsNodeId: true,
      createdById: true,
    },
  });
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  // Drafts are owned by the author. Nobody publishes someone else's
  // unfinished work — even planners.
  if (draft.createdById !== session.user.id) {
    return NextResponse.json({ error: "You can only publish your own drafts." }, { status: 403 });
  }

  const parsed = await parseBody(req, PublishSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Precheck gate — the draft skipped it on save; now it must pass or
  // the publish is refused with the same 409 the fresh POST would give.
  const gate = await checkPrecheck(draft.wbsNodeId);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.reason }, { status: 409 });
  }

  const node = await prisma.wBSNode.findUnique({
    where: { id: draft.wbsNodeId },
    select: { totalQuantity: true, projectId: true },
  });
  if (!node) return NextResponse.json({ error: "Activity not found" }, { status: 404 });

  if (body.contractorId) {
    const contractor = await prisma.contractor.findUnique({
      where: { id: body.contractorId },
      select: { projectId: true },
    });
    if (!contractor || contractor.projectId !== node.projectId) {
      return NextResponse.json({ error: "Invalid contractor for this project" }, { status: 400 });
    }
  }

  const finalType = body.type ?? "LABOUR_SUPPLY";
  const entryDate = body.date ? new Date(body.date) : new Date();
  const achieved = body.achievedQuantity ?? 0;
  const cumulative = body.cumulativeQuantity ?? 0;
  const labourClean = (body.labour ?? [])
    .map((l) => ({ category: (l.category ?? "").trim(), count: Math.floor(l.count ?? 0) }))
    .filter((l) => l.category.length > 0 && l.count > 0);
  const photosClean = (body.photoUrls ?? []).slice(0, 6);
  const reason = isValidReasonCode(body.reasonCode) ? body.reasonCode : null;
  const reasonNoteClean = typeof body.reasonNote === "string" ? body.reasonNote.trim().slice(0, 500) : "";

  const entryInclude = {
    labour: true,
    photos: true,
    contractor: { select: { id: true, name: true } },
    createdBy: { select: { id: true, name: true } },
  } as const;

  const { entry, justClosed } = await prisma.$transaction(async (tx) => {
    // Nuke and repave labour + photos so the resumed edits stick.
    // Simpler than diffing per-row, and the draft is tiny.
    await tx.progressLabour.deleteMany({ where: { progressEntryId: id } });
    await tx.progressPhoto.deleteMany({ where: { progressEntryId: id } });

    const updated = await tx.progressEntry.update({
      where: { id },
      data: {
        date: entryDate,
        type: finalType,
        achievedQuantity: isFinite(achieved) ? achieved : 0,
        cumulativeQuantity: isFinite(cumulative) ? cumulative : 0,
        contractorId: body.contractorId ?? null,
        notes: body.notes?.trim() || null,
        reasonCode: reason,
        reasonNote: reasonNoteClean || null,
        status: "PUBLISHED",
        labour: labourClean.length > 0 ? { create: labourClean } : undefined,
        photos: photosClean.length > 0 ? { create: photosClean.map((url) => ({ url })) } : undefined,
      },
      include: entryInclude,
    });

    // Rollup + villa milestone sync — same math the fresh POST runs.
    let closed: Date | undefined;
    if (node.totalQuantity && node.totalQuantity > 0 && isFinite(cumulative)) {
      const pct = Math.max(0, Math.min(100, (cumulative / node.totalQuantity) * 100));
      const current = await tx.wBSNode.findUnique({
        where: { id: draft.wbsNodeId },
        select: { actualStart: true, actualFinish: true, villaMilestoneId: true },
      });
      const updates: { percentComplete: number; progressEntered: boolean; actualStart?: Date; actualFinish?: Date } = {
        percentComplete: pct,
        progressEntered: true,
      };
      if (current && !current.actualStart) updates.actualStart = entryDate;
      if (pct >= 100 && current && !current.actualFinish) {
        updates.actualFinish = entryDate;
        closed = entryDate;
      }
      await tx.wBSNode.update({ where: { id: draft.wbsNodeId }, data: updates });
      if (current?.villaMilestoneId) {
        await syncVillaMilestoneFromChildren(tx, current.villaMilestoneId);
      }
    }

    return { entry: updated, justClosed: closed };
  });

  await recordAudit({
    projectId: draft.projectId,
    userId: session.user.id,
    action: "CREATE",
    entityType: "ProgressEntry",
    entityId: entry.id,
    summary: `Progress published from draft (${achieved} achieved, cumulative ${cumulative})`,
  });

  // Milestone-completion email fires outside the transaction so a slow
  // Resend never blocks the DB commit. Silent no-op unless the row is
  // a sub-milestone WBS node that just crossed to actualFinish.
  if (justClosed) {
    await maybeSendMilestoneCompletionEmail(draft.wbsNodeId, justClosed);
  }

  return NextResponse.json({ entry });
}
