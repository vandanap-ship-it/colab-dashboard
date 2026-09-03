import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canAccessModule, MODULES } from "@/lib/modules";
import { createIdempotent, readIdempotencyKey } from "@/lib/idempotency";
import { milestoneCompletionEmail, sendEmail } from "@/lib/email";
import { syncVillaMilestoneFromChildren } from "@/lib/milestoneRollup";
import { isValidReasonCode } from "@/lib/hindranceReasons";
import { parseBody, zDateString } from "@/lib/parseBody";

const SIDDHI_BASE_URL = process.env.SIDDHI_BASE_URL || "https://siddhi-whitelotus.vercel.app";

/**
 * Look up the sub-milestone context and fire the completion email. Safe to
 * call after a DB update; silent no-op when the node isn't tied to a villa
 * milestone, isn't a sub-milestone, or when RESEND_API_KEY isn't set.
 */
async function maybeSendMilestoneCompletionEmail(wbsNodeId: string, actualFinishDate: Date) {
  const node = await prisma.wBSNode.findUnique({
    where: { id: wbsNodeId },
    select: {
      isSubMilestone: true,
      villaMilestoneId: true,
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
  if (!node?.isSubMilestone) return;
  const vm = node.villaMilestone;
  if (!vm) return;
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

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Read access respects module scope: a contractor without PROGRESS sees none.
  if (!canAccessModule(session.user.modules, MODULES.PROGRESS)) {
    return NextResponse.json({ entries: [] });
  }

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const wbsNodeId = searchParams.get("wbsNodeId");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);

  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const where: { projectId: string; wbsNodeId?: string; deletedAt: null } = { projectId, deletedAt: null };
  if (wbsNodeId) where.wbsNodeId = wbsNodeId;

  const entries = await prisma.progressEntry.findMany({
    where,
    orderBy: { date: "desc" },
    take: limit,
    include: {
      createdBy: { select: { id: true, name: true } },
      contractor: { select: { id: true, name: true } },
      photos: { select: { id: true, url: true } },
      labour: { select: { id: true, category: true, count: true } },
      wbsNode: { select: { id: true, name: true, taskCode: true, totalQuantity: true, unit: true } },
    },
  });

  return NextResponse.json({ entries });
}

// Bounds:
//   - achieved/cumulativeQuantity: negatives make no sense on a site; upper
//     bound is generous but real (a villa is unlikely to log > 1e6 in any
//     single unit).
//   - date: allow future dates only up to a week — engineers sometimes log
//     from a slightly-wrong device clock but not from Q3 next year.
//   - labour count: 0-500 per row (site-realistic).
//   - photoUrls: max 6 per entry (matches existing slice).
//   - notes: 2000 chars (a full paragraph).
const PostProgressSchema = z.object({
  wbsNodeId: z.string().min(1, "wbsNodeId required"),
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
  // Idempotency key — kept flexible; validated at readIdempotencyKey().
  idempotencyKey: z.string().max(120).optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Daily progress is the PROGRESS module — contractors scoped to QAQC/Safety
  // cannot log progress.
  if (!canAccessModule(session.user.modules, MODULES.PROGRESS)) {
    return NextResponse.json({ error: "Your account doesn't have access to progress logging." }, { status: 403 });
  }

  const parsed = await parseBody(req, PostProgressSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const {
    wbsNodeId,
    date,
    type,
    achievedQuantity,
    cumulativeQuantity,
    contractorId,
    notes,
    labour,
    photoUrls,
    reasonCode,
    reasonNote,
  } = body;
  const node = await prisma.wBSNode.findUnique({
    where: { id: wbsNodeId },
    select: { id: true, projectId: true, contractorId: true, totalQuantity: true },
  });
  if (!node) return NextResponse.json({ error: "Activity not found" }, { status: 404 });

  // A contractor must belong to the same project as the activity — otherwise a
  // foreign contractor would pollute this project's labour/contractor rollups.
  if (contractorId) {
    const contractor = await prisma.contractor.findUnique({
      where: { id: contractorId },
      select: { projectId: true },
    });
    if (!contractor || contractor.projectId !== node.projectId) {
      return NextResponse.json({ error: "Invalid contractor for this project" }, { status: 400 });
    }
  }

  // Zod already validated date is a proper ISO string when provided, so
  // `new Date(date)` is safe — no more NaN guard.
  const finalType = type ?? "LABOUR_SUPPLY";
  const entryDate = date ? new Date(date) : new Date();
  const achieved = achievedQuantity ?? 0;
  const cumulative = cumulativeQuantity ?? 0;

  const labourClean = (labour ?? [])
    .map((l) => ({ category: (l.category ?? "").trim(), count: Math.floor(l.count ?? 0) }))
    .filter((l) => l.category.length > 0 && l.count > 0);

  const photosClean = (photoUrls ?? []).slice(0, 6);

  // Silent-drop unknown reason codes rather than 400 — the entry is more
  // important than the tag.
  const reason = isValidReasonCode(reasonCode) ? reasonCode : null;
  const reasonNoteClean = typeof reasonNote === "string" ? reasonNote.trim().slice(0, 500) : "";

  const idempotencyKey = readIdempotencyKey(body);
  const entryInclude = {
    labour: true,
    photos: true,
    contractor: { select: { id: true, name: true } },
    createdBy: { select: { id: true, name: true } },
  } as const;

  const { record: entry, duplicate } = await createIdempotent(
    idempotencyKey,
    () => prisma.progressEntry.findUnique({ where: { idempotencyKey: idempotencyKey! }, include: entryInclude }),
    () => prisma.$transaction(async (tx) => {
    const created = await tx.progressEntry.create({
      data: {
        projectId: node.projectId,
        wbsNodeId,
        date: entryDate,
        type: finalType,
        achievedQuantity: isFinite(achieved) ? achieved : 0,
        cumulativeQuantity: isFinite(cumulative) ? cumulative : 0,
        contractorId: contractorId ?? null,
        notes: notes?.trim() || null,
        reasonCode: reason,
        reasonNote: reasonNoteClean || null,
        createdById: session.user.id,
        idempotencyKey,
        labour: labourClean.length > 0 ? { create: labourClean } : undefined,
        photos: photosClean.length > 0 ? { create: photosClean.map((url) => ({ url })) } : undefined,
      },
      include: entryInclude,
    });

    // Update activity % complete from cumulative if total quantity known.
    if (node.totalQuantity && node.totalQuantity > 0 && isFinite(cumulative)) {
      const pct = Math.max(0, Math.min(100, (cumulative / node.totalQuantity) * 100));
      const current = await tx.wBSNode.findUnique({
        where: { id: wbsNodeId },
        select: { actualStart: true, actualFinish: true, villaMilestoneId: true },
      });
      // progressEntered flips an activity from "unstarted" to "tracked" so it
      // counts in the dashboard rollup (getProjectStats averages over tracked
      // leaves only). Logging any progress value — even 0% — marks it entered.
      const updates: { percentComplete: number; progressEntered: boolean; actualStart?: Date; actualFinish?: Date } = {
        percentComplete: pct,
        progressEntered: true,
      };
      if (current && !current.actualStart) updates.actualStart = entryDate;
      if (pct >= 100 && current && !current.actualFinish) updates.actualFinish = entryDate;
      await tx.wBSNode.update({ where: { id: wbsNodeId }, data: updates });

      // Roll the child's new state up to its parent VillaMilestone so the
      // Milestone Progress table, Block-wise Progress, and Weekly Milestone
      // Plan all read fresh data. No-op when the node isn't linked to a
      // VillaMilestone (e.g. structural WBS nodes).
      if (current?.villaMilestoneId) {
        await syncVillaMilestoneFromChildren(tx, current.villaMilestoneId);
      }

      // Signal via the returned tuple so the outer code can send the
      // milestone-completion email AFTER the transaction commits.
      if (updates.actualFinish) {
        (created as unknown as { __justClosed?: Date }).__justClosed = updates.actualFinish;
      }
    }

    return created;
    }),
  );

  // Fire-and-forget email side-effects outside the transaction so a slow
  // Resend call never blocks the DB commit.
  const justClosed = (entry as unknown as { __justClosed?: Date }).__justClosed;
  if (justClosed && !duplicate) {
    await maybeSendMilestoneCompletionEmail(wbsNodeId, justClosed);
  }

  // On a replayed duplicate the entry (and its rollup + audit) already exist —
  // just hand back the original so the client clears it from the queue.
  if (!duplicate) {
    await recordAudit({
      projectId: node.projectId,
      userId: session.user.id,
      action: "CREATE",
      entityType: "ProgressEntry",
      entityId: entry.id,
      summary: `Progress logged for activity (${achieved} achieved, cumulative ${cumulative})`,
    });
  }

  return NextResponse.json({ entry }, { status: duplicate ? 200 : 201 });
}
