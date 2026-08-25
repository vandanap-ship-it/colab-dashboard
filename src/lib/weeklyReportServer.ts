// Aggregator for the Weekly Site Progress report — matches Shraddha's
// Aug 17-23 Amanvana Weekly Report PDF section-for-section:
//   §1 Overall Progress            — planned vs actual % at week end
//   §2 Milestone Plan              — per contractor: to-complete / to-start
//                                    / in-progress / stalled
//   §3 Manpower                    — weekly totals, best day, day-by-day
//                                    trade breakdown table
//   §4 Delay Reasons & Mitigation  — reason cluster with recommended
//                                    mitigation text per reason
//
// All aggregation over existing tables. Zero new schema.

import { prisma } from "@/lib/prisma";
import { rangeSummary, type DaySummary, type ManpowerEntryRow, type TradePlanRow } from "@/lib/manpower";
import { reasonLabel } from "@/lib/hindranceReasons";
import { mitigationFor } from "@/lib/reasonMitigations";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface WeeklyOverallProgress {
  plannedPct: number;
  actualPct: number;
  variancePct: number;
}

export interface WeeklyMilestoneItem {
  villaNumber: number;
  villaLabel: string;
  blockCode: string;
  milestoneName: string;
  // Days late relative to baseline. Positive = late, negative = ahead.
  daysLate: number | null;
  // For in-progress items: has any progress logged this week?
  movedThisWeek?: boolean;
  daysIdle?: number;
  reason?: string; // reason label if a hindrance covers this
}

export interface WeeklyMilestonePlan {
  contractorId: string | null;
  contractorName: string;
  hasSchedule: boolean;
  toComplete: { total: number; closed: number; items: WeeklyMilestoneItem[] };
  toStart:    { total: number; started: number; items: WeeklyMilestoneItem[] };
  inProgress: { total: number; moving: number; stalled: number; movingItems: WeeklyMilestoneItem[]; stalledItems: WeeklyMilestoneItem[] };
}

export interface WeeklyManpowerRow {
  contractorId: string;
  contractorName: string;
  hasPlan: boolean;
  weeklyPlanned: number;
  weeklyActual: number;
  pctOfPlan: number | null;
  bestDayActual: number;
  bestDayDate: string | null;
  perDay: DaySummary[];
}

export interface DelayReasonWithMitigation {
  code: string;
  label: string;
  count: number;
  daysImpact: number;
  affectedVillas: number[];
  activityCount: number;
  mitigation: string;
}

export interface WeeklyReport {
  project: {
    id: string;
    name: string;
    code: string | null;
    logoUrl: string | null;
    tagline: string | null;
  };
  weekStart: Date;
  weekEnd: Date;
  overall: WeeklyOverallProgress;
  milestonePlans: WeeklyMilestonePlan[];
  manpowerByContractor: WeeklyManpowerRow[];
  delayReasons: DelayReasonWithMitigation[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getWeeklyReport(projectId: string, weekEnding: Date): Promise<WeeklyReport | null> {
  const weekEnd = toDay(weekEnding);
  const weekStart = new Date(weekEnd.getTime() - 6 * 86400000);
  const weekEndExclusive = new Date(weekEnd.getTime() + 86400000);

  const [
    project,
    villas,
    contractors,
    weekEntries,
    tradePlans,
    manpower,
    weekHindrances,
    projectMilestones,
  ] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, code: true, logoUrl: true, tagline: true },
    }),
    prisma.villa.findMany({
      where: { projectId, inScope: true },
      select: {
        id: true,
        number: true,
        label: true,
        block: { select: { code: true } },
        milestones: {
          select: {
            baselineStart: true,
            baselineFinish: true,
            actualStart: true,
            actualFinish: true,
            projectedFinish: true,
            pctComplete: true,
            section: { select: { name: true, orderIndex: true } },
            wbsNodes: { select: { id: true, contractorId: true } },
          },
        },
      },
    }),
    prisma.contractor.findMany({
      where: { projectId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, _count: { select: { wbsNodes: true } } },
    }),
    prisma.progressEntry.findMany({
      where: {
        projectId,
        deletedAt: null,
        date: { gte: weekStart, lt: weekEndExclusive },
      },
      select: {
        date: true,
        wbsNode: {
          select: {
            villaId: true,
            villaMilestone: { select: { villaId: true, sectionId: true } },
          },
        },
      },
    }),
    prisma.tradePlan.findMany({
      where: {
        projectId,
        deletedAt: null,
        startDate: { lte: weekEnd },
        OR: [{ endDate: null }, { endDate: { gt: weekStart } }],
      },
      select: {
        contractorId: true,
        trade: true,
        plannedCount: true,
        startDate: true,
        endDate: true,
      },
    }),
    prisma.manpowerEntry.findMany({
      where: {
        projectId,
        deletedAt: null,
        entryDate: { gte: weekStart, lte: weekEnd },
      },
      select: {
        contractorId: true,
        trade: true,
        entryDate: true,
        actualCount: true,
      },
    }),
    prisma.hindrance.findMany({
      where: {
        projectId,
        status: "OPEN",
        startDate: { lte: weekEnd },
      },
      select: {
        id: true,
        reasonCode: true,
        daysImpact: true,
        wbsNode: {
          select: {
            villaMilestone: { select: { villaId: true } },
          },
        },
      },
    }),
    prisma.villaMilestone.findMany({
      where: { villa: { projectId } },
      select: { baselineFinish: true, actualFinish: true },
    }),
  ]);

  if (!project) return null;

  const villaIdToNumber = new Map(villas.map((v) => [v.id, v.number]));

  // ------- §1 Overall Progress at week end -------
  const overall: WeeklyOverallProgress = (() => {
    const total = projectMilestones.length;
    const plannedThroughWeek = projectMilestones.filter(
      (m) => m.baselineFinish && m.baselineFinish <= weekEnd,
    ).length;
    const actualThroughWeek = projectMilestones.filter(
      (m) => m.actualFinish && m.actualFinish <= weekEnd,
    ).length;
    const p = total > 0 ? Math.round((plannedThroughWeek / total) * 10000) / 100 : 0;
    const a = total > 0 ? Math.round((actualThroughWeek / total) * 10000) / 100 : 0;
    return { plannedPct: p, actualPct: a, variancePct: Math.round((a - p) * 100) / 100 };
  })();

  // ------- §2 Milestone Plan per contractor -------
  // Villas that logged progress this week, by villa id.
  const villaIdsMoved = new Set<string>(
    weekEntries
      .map((e) => e.wbsNode.villaMilestone?.villaId)
      .filter((x): x is string => !!x),
  );
  const villaIdsMovedThisWeekWithSection = new Set<string>(
    weekEntries
      .map((e) => e.wbsNode.villaMilestone?.villaId + "::" + e.wbsNode.villaMilestone?.sectionId)
      .filter((x) => !x.startsWith("undefined")),
  );

  // Group milestones by responsible contractor via wbsNodes.
  const contractorItems = new Map<
    string,
    {
      toComplete: WeeklyMilestoneItem[];
      toStart: WeeklyMilestoneItem[];
      inProgressMoving: WeeklyMilestoneItem[];
      inProgressStalled: WeeklyMilestoneItem[];
    }
  >();
  contractors.forEach((c) => contractorItems.set(c.id, {
    toComplete: [], toStart: [], inProgressMoving: [], inProgressStalled: [],
  }));

  for (const v of villas) {
    for (const m of v.milestones) {
      const contractorId = m.wbsNodes[0]?.contractorId;
      if (!contractorId) continue;
      const bucket = contractorItems.get(contractorId);
      if (!bucket) continue;

      const item: WeeklyMilestoneItem = {
        villaNumber: v.number,
        villaLabel: v.label ?? `Villa ${v.number}`,
        blockCode: v.block.code,
        milestoneName: m.section?.name ?? "—",
        daysLate: m.baselineFinish ? daysBetween(m.baselineFinish, weekEnd) : null,
      };

      // TO COMPLETE: baselineFinish falls inside this week.
      if (m.baselineFinish && m.baselineFinish >= weekStart && m.baselineFinish <= weekEnd) {
        bucket.toComplete.push(item);
      }
      // TO START: baselineStart falls inside this week AND actualStart is null.
      if (m.baselineStart && m.baselineStart >= weekStart && m.baselineStart <= weekEnd && !m.actualStart) {
        bucket.toStart.push(item);
      }
      // IN PROGRESS: has actualStart, no actualFinish yet.
      if (m.actualStart && !m.actualFinish) {
        const moved = villaIdsMoved.has(v.id);
        const daysIdle = moved
          ? 0
          : m.actualStart
          ? daysBetween(m.actualStart, weekEnd)
          : 0;
        if (moved) {
          bucket.inProgressMoving.push({ ...item, movedThisWeek: true });
        } else {
          bucket.inProgressStalled.push({ ...item, movedThisWeek: false, daysIdle });
        }
      }
    }
  }

  const milestonePlans: WeeklyMilestonePlan[] = contractors.map((c) => {
    const b = contractorItems.get(c.id)!;
    const toComplete = b.toComplete;
    const toStart = b.toStart;
    const moving = b.inProgressMoving;
    const stalled = b.inProgressStalled;
    return {
      contractorId: c.id,
      contractorName: c.name,
      hasSchedule: c._count.wbsNodes > 0,
      toComplete: {
        total: toComplete.length,
        closed: 0, // We don't know within this week if they closed — could refine later
        items: toComplete,
      },
      toStart: {
        total: toStart.length,
        started: 0,
        items: toStart,
      },
      inProgress: {
        total: moving.length + stalled.length,
        moving: moving.length,
        stalled: stalled.length,
        movingItems: moving.slice(0, 8),
        stalledItems: stalled.slice(0, 8),
      },
    };
  });

  // ------- §3 Manpower -------
  const planRows: TradePlanRow[] = tradePlans.map((p) => ({
    contractorId: p.contractorId,
    trade: p.trade,
    plannedCount: p.plannedCount,
    startDate: p.startDate,
    endDate: p.endDate,
  }));
  const entryRows: ManpowerEntryRow[] = manpower.map((e) => ({
    contractorId: e.contractorId,
    trade: e.trade,
    entryDate: e.entryDate,
    actualCount: e.actualCount,
  }));

  const manpowerByContractor: WeeklyManpowerRow[] = contractors.map((c) => {
    const contractorPlanCount = planRows.filter((p) => p.contractorId === c.id).length;
    const hasPlan = contractorPlanCount > 0;
    const perDay = rangeSummary(planRows, entryRows, weekStart, weekEnd, c.id);
    const weeklyPlanned = perDay.reduce((n, d) => n + d.plannedTotal, 0);
    const weeklyActual  = perDay.reduce((n, d) => n + d.actualTotal, 0);
    let bestDayActual = 0;
    let bestDayDate: string | null = null;
    for (const d of perDay) {
      if (d.actualTotal > bestDayActual) {
        bestDayActual = d.actualTotal;
        bestDayDate = d.date.toISOString().slice(0, 10);
      }
    }
    return {
      contractorId: c.id,
      contractorName: c.name,
      hasPlan,
      weeklyPlanned,
      weeklyActual,
      pctOfPlan: weeklyPlanned > 0 ? Math.round((weeklyActual / weeklyPlanned) * 100) : null,
      bestDayActual,
      bestDayDate,
      perDay,
    };
  });

  // ------- §4 Delay Reasons & Mitigation -------
  const reasonMap = new Map<string, {
    label: string;
    count: number;
    daysImpact: number;
    villas: Set<number>;
    activityCount: number;
  }>();
  for (const h of weekHindrances) {
    const code = h.reasonCode ?? "UNSPECIFIED";
    const entry = reasonMap.get(code) ?? {
      label: reasonLabel(code === "UNSPECIFIED" ? null : code),
      count: 0,
      daysImpact: 0,
      villas: new Set<number>(),
      activityCount: 0,
    };
    entry.count++;
    entry.daysImpact += h.daysImpact ?? 0;
    const villaId = h.wbsNode?.villaMilestone?.villaId;
    if (villaId) {
      const num = villaIdToNumber.get(villaId);
      if (num != null) entry.villas.add(num);
    }
    entry.activityCount++;
    reasonMap.set(code, entry);
  }
  const delayReasons: DelayReasonWithMitigation[] = [...reasonMap.entries()]
    .map(([code, v]) => ({
      code,
      label: v.label,
      count: v.count,
      daysImpact: v.daysImpact,
      affectedVillas: [...v.villas].sort((a, b) => a - b),
      activityCount: v.activityCount,
      mitigation: mitigationFor(code),
    }))
    .sort((a, b) => b.daysImpact - a.daysImpact || b.count - a.count);

  // Fold the sub-week-flag warning
  void villaIdsMovedThisWeekWithSection;

  return {
    project,
    weekStart,
    weekEnd,
    overall,
    milestonePlans,
    manpowerByContractor,
    delayReasons,
  };
}
