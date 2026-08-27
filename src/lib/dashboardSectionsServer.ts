// Server helpers for Dashboard sections added after the initial rebuild:
// Milestone Progress (Master Report Section 6) and Site Activity Highlights
// (Master Report Section 5). Both are read-only aggregations over existing
// tables — no new data model needed.

import { prisma } from "@/lib/prisma";
import { reasonLabel } from "@/lib/hindranceReasons";
import { istDayStart } from "@/lib/istDay";

// ---------------------------------------------------------------------------
// Milestone Progress — per-milestone line items due / done / pending
// ---------------------------------------------------------------------------

export interface MilestoneProgressRow {
  code: string;        // MilestoneSection.code
  name: string;        // MilestoneSection.name
  orderIndex: number;
  due: number;         // # of VillaMilestones whose baselineFinish <= asOf
  done: number;        // ...of those, actualFinish is set
  pending: number;     // due - done
  status: "not-started" | "all-done" | "pending";
  /** For hover / detail: null when due == 0. */
  latestDoneAt: string | null;
}

/**
 * Count line items due (planned finish ≤ asOf) and how many of them closed.
 * "Not started" means nothing is due yet; "All done" means every due item
 * has an actual finish; "Pending" is anything with N unclosed items.
 */
export async function getMilestoneProgress(
  projectId: string,
  asOf: Date = new Date(),
): Promise<MilestoneProgressRow[]> {
  const sections = await prisma.milestoneSection.findMany({
    where: { projectId },
    orderBy: { orderIndex: "asc" },
    select: { id: true, code: true, name: true, orderIndex: true },
  });

  // One aggregate per section — count total villa milestones with a planned
  // finish on or before asOf, and separately how many of those closed.
  const rows: MilestoneProgressRow[] = [];
  for (const section of sections) {
    const [due, done, latest] = await Promise.all([
      prisma.villaMilestone.count({
        where: {
          sectionId: section.id,
          baselineFinish: { lte: asOf, not: null },
        },
      }),
      prisma.villaMilestone.count({
        where: {
          sectionId: section.id,
          baselineFinish: { lte: asOf, not: null },
          actualFinish: { not: null },
        },
      }),
      prisma.villaMilestone.findFirst({
        where: {
          sectionId: section.id,
          actualFinish: { not: null, lte: asOf },
        },
        orderBy: { actualFinish: "desc" },
        select: { actualFinish: true },
      }),
    ]);
    const pending = Math.max(0, due - done);
    const status: MilestoneProgressRow["status"] =
      due === 0 ? "not-started" : pending === 0 ? "all-done" : "pending";
    rows.push({
      code: section.code,
      name: section.name,
      orderIndex: section.orderIndex,
      due,
      done,
      pending,
      status,
      latestDoneAt: latest?.actualFinish?.toISOString() ?? null,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Site Activity Highlights — today's logged progress entries
// ---------------------------------------------------------------------------

export interface SiteActivity {
  progressEntryId: string;
  blockCode: string;
  villaLabel: string;   // "Villa 12" or the overridden label
  villaNumber: number;
  milestoneName: string; // section name
  activityName: string;  // wbs node name
  achievedPct: number | null; // pctComplete on the villa milestone at time of entry
  loggedAt: string;
  loggedByName: string;
  contractorName: string | null;
  photoUrl: string | null;
  notes: string | null;
  reasonLabel: string | null;
  reasonNote: string | null;
  overdueDays: number | null; // days past baselineFinish for the linked villaMilestone
}

export interface SiteActivityBlockGroup {
  blockCode: string;
  villas: {
    villaNumber: number;
    villaLabel: string;
    activities: SiteActivity[];
  }[];
}

/**
 * Return progress entries logged on `forDate`, grouped by block > villa >
 * activities, ready to render as cards. Also joins the closest hindrance on
 * the same day for the same wbsNode so we can surface a delay reason inline.
 */
export async function getSiteActivityHighlights(
  projectId: string,
  forDate: Date = new Date(),
): Promise<SiteActivityBlockGroup[]> {
  const dayStart = istDayStart(forDate);
  const dayEnd = new Date(dayStart.getTime() + 86400000);

  const entries = await prisma.progressEntry.findMany({
    where: {
      projectId,
      deletedAt: null,
      date: { gte: dayStart, lt: dayEnd },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: {
      wbsNode: {
        select: {
          name: true,
          taskCode: true,
          villaMilestoneId: true,
          villaMilestone: {
            select: {
              pctComplete: true,
              baselineFinish: true,
              section: { select: { name: true } },
              villa: {
                select: {
                  number: true,
                  label: true,
                  block: { select: { code: true } },
                },
              },
            },
          },
        },
      },
      photos: { select: { url: true }, take: 1 },
      contractor: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
  }) as unknown as Array<{
    id: string;
    createdAt: Date;
    notes: string | null;
    reasonCode: string | null;
    reasonNote: string | null;
    wbsNodeId: string;
    wbsNode: {
      name: string;
      villaMilestone: {
        pctComplete: number | null;
        baselineFinish: Date | null;
        section: { name: string } | null;
        villa: { number: number; label: string | null; block: { code: string } } | null;
      } | null;
    };
    photos: { url: string }[];
    contractor: { name: string } | null;
    createdBy: { name: string };
  }>;

  // Join today's hindrances so we can attach delay reason inline. Grouped by
  // wbsNodeId so lookup is O(1) per progress entry.
  const hindrances = await prisma.hindrance.findMany({
    where: {
      projectId,
      startDate: { gte: dayStart, lt: dayEnd },
    },
    select: { wbsNodeId: true, reasonCode: true, reasonNote: true },
  });
  const hindrancesByNode = new Map<string, { reasonCode: string | null; reasonNote: string | null }>();
  for (const h of hindrances) {
    if (h.wbsNodeId) hindrancesByNode.set(h.wbsNodeId, { reasonCode: h.reasonCode, reasonNote: h.reasonNote });
  }

  // Bucket by block + villa.
  const byBlock = new Map<string, Map<number, SiteActivity[]>>();

  for (const e of entries) {
    const vm = e.wbsNode.villaMilestone;
    if (!vm || !vm.villa) continue; // skip non-villa activities
    const blockCode = vm.villa.block.code;
    const villaNumber = vm.villa.number;
    const villaLabel = vm.villa.label ?? `Villa ${villaNumber}`;

    const overdueDays = vm.baselineFinish
      ? Math.max(0, Math.round((dayStart.getTime() - vm.baselineFinish.getTime()) / 86400000))
      : null;

    // Resolve the delay reason with a two-source lookup:
    //   1. Reason tagged directly on the progress entry (preferred — the
    //      site engineer set it at log-time in the same form).
    //   2. Otherwise fall back to a hindrance opened on the same wbsNode
    //      the same day.
    const h = hindrancesByNode.get(e.wbsNodeId);
    const effectiveReasonCode = e.reasonCode ?? h?.reasonCode ?? null;
    const effectiveReasonNote = e.reasonNote ?? h?.reasonNote ?? null;

    const activity: SiteActivity = {
      progressEntryId: e.id,
      blockCode,
      villaLabel,
      villaNumber,
      milestoneName: vm.section?.name ?? "—",
      activityName: e.wbsNode.name,
      achievedPct: vm.pctComplete ?? null,
      loggedAt: e.createdAt.toISOString(),
      loggedByName: e.createdBy.name,
      contractorName: e.contractor?.name ?? null,
      photoUrl: e.photos[0]?.url ?? null,
      notes: e.notes,
      reasonLabel: effectiveReasonCode ? reasonLabel(effectiveReasonCode) : null,
      reasonNote: effectiveReasonNote,
      overdueDays: overdueDays && overdueDays > 0 ? overdueDays : null,
    };

    if (!byBlock.has(blockCode)) byBlock.set(blockCode, new Map());
    const villas = byBlock.get(blockCode)!;
    if (!villas.has(villaNumber)) villas.set(villaNumber, []);
    villas.get(villaNumber)!.push(activity);
  }

  // Sort blocks by code (numeric-aware), villas by number, activities newest first.
  const blockCodes = [...byBlock.keys()].sort((a, b) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });

  return blockCodes.map((blockCode) => {
    const villasMap = byBlock.get(blockCode)!;
    const villaNumbers = [...villasMap.keys()].sort((a, b) => a - b);
    return {
      blockCode,
      villas: villaNumbers.map((villaNumber) => ({
        villaNumber,
        villaLabel: villasMap.get(villaNumber)![0].villaLabel,
        activities: villasMap.get(villaNumber)!,
      })),
    };
  });
}
