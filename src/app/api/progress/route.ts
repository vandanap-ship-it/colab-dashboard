import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canAccessModule, MODULES } from "@/lib/modules";
import { createIdempotent, readIdempotencyKey } from "@/lib/idempotency";
import { milestoneCompletionEmail, sendEmail } from "@/lib/email";

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

const VALID_TYPES = new Set(["LABOUR_SUPPLY", "PRW", "MISC"]);

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

type LabourInput = { category?: string; count?: number };

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Daily progress is the PROGRESS module — contractors scoped to QAQC/Safety
  // cannot log progress.
  if (!canAccessModule(session.user.modules, MODULES.PROGRESS)) {
    return NextResponse.json({ error: "Your account doesn't have access to progress logging." }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

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
  } = (body ?? {}) as {
    wbsNodeId?: string;
    date?: string;
    type?: string;
    achievedQuantity?: number;
    cumulativeQuantity?: number;
    contractorId?: string | null;
    notes?: string;
    labour?: LabourInput[];
    photoUrls?: string[];
  };

  if (!wbsNodeId) return NextResponse.json({ error: "wbsNodeId required" }, { status: 400 });
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

  const finalType = type && VALID_TYPES.has(type) ? type : "LABOUR_SUPPLY";
  const entryDate = date ? new Date(date) : new Date();
  if (isNaN(entryDate.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }
  const achieved = Number(achievedQuantity ?? 0);
  const cumulative = Number(cumulativeQuantity ?? 0);

  const labourClean = Array.isArray(labour)
    ? labour
        .map((l) => ({ category: (l.category ?? "").trim(), count: Math.max(0, Math.floor(Number(l.count ?? 0))) }))
        .filter((l) => l.category.length > 0 && l.count > 0)
    : [];

  const photosClean = Array.isArray(photoUrls) ? photoUrls.filter((u) => typeof u === "string" && u.length > 0).slice(0, 6) : [];

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
        select: { actualStart: true, actualFinish: true },
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
