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
import { sanitizeUploadUrls } from "@/lib/upload";
import { parseBody, zDateString } from "@/lib/parseBody";
import { checkPrecheck } from "@/lib/progressGates";
import { generateProgressDisplayId, monotonicViolationMessage } from "@/lib/progress";

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
  const status = searchParams.get("status"); // "draft" for the Drafts tab
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);

  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  // Drafts are private to the author: return only the current user's
  // rows and only when they explicitly asked for status=draft. Without
  // that param, the query defaults to PUBLISHED-only via the Prisma
  // soft-filter (see @/lib/prisma).
  const isDraftQuery = status === "draft";
  const where: {
    projectId: string;
    wbsNodeId?: string;
    deletedAt: null;
    status?: string;
    createdById?: string;
  } = { projectId, deletedAt: null };
  if (wbsNodeId) where.wbsNodeId = wbsNodeId;
  if (isDraftQuery) {
    where.status = "DRAFT";
    where.createdById = session.user.id;
  }

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
  // "publish" is the site-engineer-hits-Save path; "draft" is the
  // Save Draft path where the engineer is stepping away and wants
  // the entry stashed for later. Drafts skip precheck, rollup,
  // milestone-completion emails, and the audit line — they aren't
  // "real progress" until the engineer comes back and publishes.
  mode: z.enum(["draft", "publish"]).optional(),
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
    mode,
  } = body;
  const isDraft = mode === "draft";

  // Backdate window — Shraddha 2026-10-01: engineers can log progress up
  // to 7 days back, no further. The client enforces this with min/max
  // on the date picker; this is the belt-and-braces server guard so a
  // scripted / curl'd POST can't backdate further. Drafts skip the
  // check — a draft started before the window will fail only when
  // the engineer tries to PUBLISH it, which routes through
  // /api/progress/[id]/publish with its own date check.
  if (!isDraft && date) {
    const parsedDate = new Date(date);
    if (!Number.isNaN(parsedDate.getTime())) {
      const now = new Date();
      const minMs = now.getTime() - 7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000; // 1h slack for IST
      const maxMs = now.getTime() + 24 * 60 * 60 * 1000; // 1 day forward slack for clock drift
      if (parsedDate.getTime() < minMs) {
        return NextResponse.json(
          { error: "You can only log progress up to 7 days back." },
          { status: 400 },
        );
      }
      if (parsedDate.getTime() > maxMs) {
        return NextResponse.json(
          { error: "Progress date can't be in the future." },
          { status: 400 },
        );
      }
    }
  }

  // Idempotency short-circuit · if the offline-queue replay carries a
  // key we've already committed, return the existing row without
  // re-running validation. Without this, a replay whose original write
  // sat under a monotonic cap that has since moved (another engineer
  // logged higher progress in between) would 409 on the retry even
  // though the row already exists. Reading the entry directly here is
  // cheap (unique-indexed) and skips the precheck / contractor /
  // monotonic gates that the original POST already cleared.
  const idempotencyKey = readIdempotencyKey(body);
  if (idempotencyKey) {
    const existing = await prisma.progressEntry.findUnique({
      where: { idempotencyKey },
      include: {
        labour: true,
        photos: true,
        contractor: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    if (existing) {
      return NextResponse.json({ entry: existing }, { status: 200 });
    }
  }

  const node = await prisma.wBSNode.findUnique({
    where: { id: wbsNodeId },
    select: { id: true, projectId: true, contractorId: true, totalQuantity: true },
  });
  if (!node) return NextResponse.json({ error: "Activity not found" }, { status: 404 });

  // Precheck gate — some activities can't be logged until a prerequisite
  // inspection on the same villa has passed (Rebar before Concreting,
  // Waterproofing before Flooring, etc). Rules live in @/lib/progressGates
  // — same helper the mobile form calls in advance so the UX shows the
  // block before the engineer scrolls to Save. Enforced here too so a
  // direct POST can't bypass it. Drafts skip the gate: an engineer
  // stashing an unfinished entry hasn't claimed anything is done, so
  // the prerequisite doesn't matter until they hit Publish.
  if (!isDraft) {
    const gate = await checkPrecheck(wbsNodeId);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.reason }, { status: 409 });
    }
  }

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

  // Colab-parity monotonic constraint (Madhavan zip · Edit Progress
  // slider min-locks to the current cumulative). Progress can only
  // increase — a new PUBLISHED entry's cumulative must be >= the max
  // cumulative of prior PUBLISHED entries on the same activity.
  // Drafts skip the check for the same reason they skip the precheck
  // gate: the engineer's stashed unfinished attempt shouldn't be
  // policed until they hit Publish.
  //
  // Pre-check outside the tx: cheap, catches the vast majority of
  // violations before the tx cost. The tx below re-runs the check so
  // two concurrent submits can't BOTH pass this pre-check and BOTH
  // commit — an in-tx aggregate over PUBLISHED rows is the closest
  // Prisma gets to SELECT ... FOR UPDATE across the constraint.
  if (!isDraft) {
    const maxPrior = await prisma.progressEntry.aggregate({
      where: { wbsNodeId, status: "PUBLISHED", deletedAt: null },
      _max: { cumulativeQuantity: true },
    });
    const priorMax = maxPrior._max.cumulativeQuantity ?? 0;
    if (cumulative < priorMax) {
      return NextResponse.json({ error: monotonicViolationMessage(priorMax, "new") }, { status: 409 });
    }
  }

  const labourClean = (labour ?? [])
    .map((l) => ({ category: (l.category ?? "").trim(), count: Math.floor(l.count ?? 0) }))
    .filter((l) => l.category.length > 0 && l.count > 0);

  // Provenance filter: URLs must have come from our own uploader
  // (Vercel Blob prod, /uploads local dev). A hostile external URL is
  // silently dropped so a legitimate submit with junk mixed in still
  // succeeds with the good rows.
  const photosClean = sanitizeUploadUrls(photoUrls).slice(0, 6);

  // Silent-drop unknown reason codes rather than 400 — the entry is more
  // important than the tag.
  const reason = isValidReasonCode(reasonCode) ? reasonCode : null;
  const reasonNoteClean = typeof reasonNote === "string" ? reasonNote.trim().slice(0, 500) : "";

  // idempotencyKey was already read + short-circuit-checked above.
  const entryInclude = {
    labour: true,
    photos: true,
    contractor: { select: { id: true, name: true } },
    createdBy: { select: { id: true, name: true } },
  } as const;

  let entry: Awaited<ReturnType<typeof prisma.progressEntry.findUnique>>;
  let duplicate: boolean;
  try {
    const outcome = await createIdempotent(
      idempotencyKey,
      () => prisma.progressEntry.findUnique({ where: { idempotencyKey: idempotencyKey! }, include: entryInclude }),
      () => prisma.$transaction(async (tx) => {
    // Re-check the monotonic invariant inside the tx. Without this,
    // two concurrent PUBLISHED submits could both pass the pre-check
    // above (they'd both read the same priorMax before either wrote)
    // and both commit — silent invariant violation. The tx-scoped
    // aggregate + throw is Prisma's closest equivalent to
    // "SELECT MAX(cumulativeQuantity) ... FOR UPDATE".
    if (!isDraft) {
      const maxPriorTx = await tx.progressEntry.aggregate({
        where: { wbsNodeId, status: "PUBLISHED", deletedAt: null },
        _max: { cumulativeQuantity: true },
      });
      const priorMaxTx = maxPriorTx._max.cumulativeQuantity ?? 0;
      if (cumulative < priorMaxTx) {
        throw new RangeError(`MONOTONIC:${priorMaxTx}`);
      }
    }
    const created = await tx.progressEntry.create({
      data: {
        projectId: node.projectId,
        wbsNodeId,
        date: entryDate,
        type: finalType,
        // Colab-parity displayId (PROG-XXXXXXXX). Generated even for
        // drafts so the id is stable when the engineer publishes.
        displayId: generateProgressDisplayId(),
        achievedQuantity: isFinite(achieved) ? achieved : 0,
        cumulativeQuantity: isFinite(cumulative) ? cumulative : 0,
        contractorId: contractorId ?? null,
        notes: notes?.trim() || null,
        reasonCode: reason,
        reasonNote: reasonNoteClean || null,
        status: isDraft ? "DRAFT" : "PUBLISHED",
        createdById: session.user.id,
        idempotencyKey,
        labour: labourClean.length > 0 ? { create: labourClean } : undefined,
        photos: photosClean.length > 0 ? { create: photosClean.map((url) => ({ url })) } : undefined,
      },
      include: entryInclude,
    });

    // Update activity % complete from cumulative if total quantity known.
    // Skipped for drafts — a stashed unfinished entry shouldn't move the
    // dashboard's percent-complete or trigger a milestone-completion email.
    if (!isDraft && node.totalQuantity && node.totalQuantity > 0 && isFinite(cumulative)) {
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
    entry = outcome.record;
    duplicate = outcome.duplicate;
  } catch (e) {
    // In-tx monotonic re-check refused the write because another
    // concurrent submit landed higher first. Return the same 409 shape
    // the pre-tx check returns so the client's error handling doesn't
    // have to know about the race path.
    if (e instanceof RangeError && e.message.startsWith("MONOTONIC:")) {
      const priorMax = Number(e.message.split(":")[1] ?? "0");
      return NextResponse.json(
        { error: monotonicViolationMessage(priorMax, "new") },
        { status: 409 },
      );
    }
    throw e;
  }

  // Fire-and-forget email side-effects outside the transaction so a slow
  // Resend call never blocks the DB commit.
  const justClosed = (entry as unknown as { __justClosed?: Date }).__justClosed;
  if (justClosed && !duplicate) {
    await maybeSendMilestoneCompletionEmail(wbsNodeId, justClosed);
  }

  // On a replayed duplicate the entry (and its rollup + audit) already exist —
  // just hand back the original so the client clears it from the queue.
  // Draft rows also skip the audit — audit tracks "state changes to the
  // project" and an unfinished entry the engineer might discard doesn't
  // qualify. The audit lands when they publish the draft.
  if (!duplicate && !isDraft) {
    await recordAudit({
      projectId: node.projectId,
      userId: session.user.id,
      action: "CREATE",
      entityType: "ProgressEntry",
      entityId: entry.id,
      summary: `Progress logged${entry.displayId ? ` ${entry.displayId}` : ""} for activity (${achieved} achieved, cumulative ${cumulative})`,
    });
  }

  return NextResponse.json({ entry }, { status: duplicate ? 200 : 201 });
}
