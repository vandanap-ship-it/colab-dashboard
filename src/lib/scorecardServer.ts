// Aggregator for the "Site Progress Scorecard" report — the daily PDF
// Shraddha generates from Colab today (Amanvana_Phase1_Scorecard_Mobile.pdf).
//
// Structure mirrors her PDF exactly so a reader can move between the
// on-screen view and the printed PDF without hunting for sections:
//   §1 Daily Site Snapshot     — blocks/villas updated y/n counts
//   §2 Daily Movement          — per-contractor executed / not-updated
//   §3 Planned coverage        — per-block villa chips with "updated" state
//   §4 Daily Manpower          — planned vs actual per trade
//   §5 Site Activity Highlights — every progress entry as a card
//   §6 Milestone Progress      — line items due/done/pending per milestone
//   §7 Block-wise Progress     — planned vs actual dates per active block
//   §8 Project Health (footer) — start/end/duration/progress vs plan
//
// Everything is read-only aggregation over existing tables. Zero new schema.

import { prisma } from "@/lib/prisma";
import { daySummary, type DaySummary, type ManpowerEntryRow, type TradePlanRow } from "@/lib/manpower";
import {
  getMilestoneProgress,
  getSiteActivityHighlights,
  type MilestoneProgressRow,
  type SiteActivityBlockGroup,
} from "@/lib/dashboardSectionsServer";
import { istDayStart } from "@/lib/istDay";
import { isHoliday } from "@/lib/holidays";

export interface ScorecardProject {
  id: string;
  name: string;
  code: string | null;
  logoUrl: string | null;
  tagline: string | null;
  address: string | null;
  startDate: Date | null;
  endDate: Date | null;
  projectedEndDate: Date | null;
}

/** §1 — did the day's planned work get updated? */
export interface ScorecardDailySnapshot {
  progressUpdatedToday: boolean;    // "Yes / No" — was anyone logged today?
  contractorsUpdated: number;       // # contractors that had at least one log today
  contractorsExpected: number;      // # contractors that had scope planned today
  blocksUpdated: number;            // # blocks with at least one progress entry today
  blocksExpected: number;           // # blocks with scope planned today (fallback: active blocks)
  villasUpdated: number;            // # villas with at least one progress entry today
  villasExpected: number;           // # villas with scope planned today (fallback: active villas)
}

/** §2 — one row per contractor summarising today's movement.
 *  contractorId=null → the "Untagged" catch-all row for activities that
 *  aren't yet assigned to a contractor (Amanvana has 7k on Aug 27). */
export interface ScorecardContractorMovement {
  contractorId: string | null;
  contractorName: string;
  scopeVillas: number;
  executed: number;      // # villas that logged progress today
  planned: number;       // # villas planned to move today
  notUpdated: number;    // executed 0 but had scope today
  hasSchedule: boolean;  // false for "to be decided" contractors
}

/** §3 — per-block coverage: which villas were expected today, which logged. */
export interface ScorecardBlockCoverage {
  blockCode: string;
  villas: Array<{
    villaNumber: number;
    villaLabel: string;
    updated: boolean;
    /** True when the villa logged progress today but WASN'T in the planned
     *  window — a bonus/ahead-of-plan move. RUNBOOK renders these as
     *  gold-edged chips + adds a caption line in the sub-panel. */
    aheadOfPlan?: boolean;
  }>;
  updatedCount: number;
  aheadCount: number;
  totalCount: number;
  status: "none-updated" | "partially" | "all-updated";
}

/** §7 — per-block progress line: planned vs actual dates + delay. */
export interface ScorecardBlockProgress {
  blockCode: string;
  villaCount: number;
  activitiesDue: number;
  activitiesClosed: number;
  plannedPct: number;
  actualPct: number;
  plannedStart: Date | null;
  plannedFinish: Date | null;
  actualStart: Date | null;
  projectedFinish: Date | null;
  plannedDurationDays: number | null;
  actualDurationDays: number | null;
  delayDays: number;       // 0 or positive
  villas: number[];
  hasSchedule: boolean;
}

/** §8 — footer summary. */
export interface ScorecardProjectHealth {
  plannedStart: Date | null;
  actualStart: Date | null;
  plannedEnd: Date | null;
  projectedEnd: Date | null;
  startVarianceDays: number | null;
  endVarianceDays: number | null;
  plannedDurationDays: number | null;
  actualDurationDays: number | null;
  plannedProgressPct: number;
  actualProgressPct: number;
  progressVariancePct: number;
  overallCompletePct: number;
  totalActivities: number;
  activitiesToDate: number;
}

export interface Scorecard {
  project: ScorecardProject;
  asOf: Date;
  dailySnapshot: ScorecardDailySnapshot;
  movement: ScorecardContractorMovement[];
  blockCoverage: ScorecardBlockCoverage[];
  manpower: DaySummary;
  milestoneProgress: MilestoneProgressRow[];
  activityHighlights: SiteActivityBlockGroup[];
  blockProgress: ScorecardBlockProgress[];
  projectHealth: ScorecardProjectHealth;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDay(d: Date): Date {
  return istDayStart(d);
}

function daysBetween(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

/** For a given day, count which villas had ANY progress entry, and which had
 *  scope planned (baselineStart <= day AND baselineFinish >= day). */
async function computeDailySnapshotAndMovement(
  projectId: string,
  day: Date,
): Promise<{
  snapshot: ScorecardDailySnapshot;
  movement: ScorecardContractorMovement[];
  blockCoverage: ScorecardBlockCoverage[];
}> {
  const dayStart = toDay(day);
  const dayEnd = new Date(dayStart.getTime() + 86400000);

  // What was planned for the day: any villa milestone whose baseline window
  // straddles the day. This is the "expected" set for updates.
  const [
    plannedMilestonesToday,
    entriesToday,
    contractors,
    blocks,
    villas,
  ] = await Promise.all([
    // "Planned for the day" per RUNBOOK: villas whose work was scheduled
    // for the date (in their planned window) OR were overdue and still open.
    // This is the definition Colab uses — expected covers both in-window and
    // spilled-past milestones.
    prisma.villaMilestone.findMany({
      where: {
        villa: { projectId },
        OR: [
          { baselineStart: { lte: dayStart }, baselineFinish: { gte: dayStart } },
          { baselineFinish: { lt: dayStart }, actualFinish: null },
        ],
      },
      select: {
        villaId: true,
        villa: {
          select: {
            number: true,
            label: true,
            block: { select: { code: true } },
          },
        },
      },
    }),
    prisma.progressEntry.findMany({
      where: {
        projectId,
        deletedAt: null,
        date: { gte: dayStart, lt: dayEnd },
      },
      select: {
        contractorId: true,
        wbsNode: {
          select: {
            villaId: true,
            villaMilestone: {
              select: {
                villa: {
                  select: {
                    number: true,
                    block: { select: { code: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.contractor.findMany({
      where: { projectId, active: true },
      select: {
        id: true,
        name: true,
        _count: { select: { wbsNodes: true } },
      },
    }),
    prisma.block.findMany({
      where: { projectId, active: true },
      select: { code: true },
    }),
    prisma.villa.findMany({
      where: { projectId, inScope: true },
      select: {
        id: true,
        number: true,
        label: true,
        block: { select: { code: true } },
      },
    }),
  ]);

  // Expected sets
  const expectedVillaIds = new Set<string>();
  const expectedBlockCodes = new Set<string>();
  // Map by villaId (unique) to avoid grouped-villa number collisions.
  const expectedByBlock = new Map<string, Map<string, { villaId: string; villaNumber: number; villaLabel: string }>>();
  for (const vm of plannedMilestonesToday) {
    expectedVillaIds.add(vm.villaId);
    const bcode = vm.villa.block.code;
    expectedBlockCodes.add(bcode);
    if (!expectedByBlock.has(bcode)) expectedByBlock.set(bcode, new Map());
    expectedByBlock.get(bcode)!.set(vm.villaId, {
      villaId: vm.villaId,
      villaNumber: vm.villa.number,
      villaLabel: vm.villa.label ?? `Villa ${vm.villa.number}`,
    });
  }

  // Updated sets — anyone that logged today. Uses villaId (unique) as the
  // set identity so villas that share a number (grouped villas) don't collide.
  const updatedVillaIds = new Set<string>();
  const updatedBlockCodes = new Set<string>();
  // contractorId=null bucket = untagged progress entries.
  const updatedByContractor = new Map<string | null, Set<string>>();
  for (const e of entriesToday) {
    const blockCode = e.wbsNode.villaMilestone?.villa.block.code;
    const villaId = e.wbsNode.villaId;
    if (villaId) updatedVillaIds.add(villaId);
    if (blockCode) updatedBlockCodes.add(blockCode);
    if (villaId) {
      const key = e.contractorId ?? null;
      if (!updatedByContractor.has(key)) updatedByContractor.set(key, new Set());
      updatedByContractor.get(key)!.add(villaId);
    }
  }

  // §1 counts
  const snapshot: ScorecardDailySnapshot = {
    progressUpdatedToday: entriesToday.length > 0,
    contractorsUpdated: new Set(entriesToday.map((e) => e.contractorId).filter((x): x is string => !!x)).size,
    contractorsExpected: contractors.length,
    blocksUpdated: updatedBlockCodes.size,
    blocksExpected: expectedBlockCodes.size || blocks.length,
    villasUpdated: updatedVillaIds.size,
    villasExpected: expectedVillaIds.size,
  };

  // §2 contractor movement
  // Villa scope per contractor = distinct villaIds via that contractor's WBS.
  // Also count how many activities across the project are UNTAGGED (contractorId=null)
  // and surface that as its own row so the reader sees the gap.
  const contractorScope = await prisma.wBSNode.findMany({
    where: {
      projectId,
      villaId: { not: null },
    },
    select: { contractorId: true, villaId: true },
    distinct: ["contractorId", "villaId"],
  });
  const villaCountByContractor = new Map<string | null, number>();
  const expectedByContractor = new Map<string | null, Set<string>>();
  for (const row of contractorScope) {
    if (!row.villaId) continue;
    const key = row.contractorId ?? null;
    villaCountByContractor.set(key, (villaCountByContractor.get(key) ?? 0) + 1);
    if (expectedVillaIds.has(row.villaId)) {
      const setForKey = expectedByContractor.get(key) ?? new Set<string>();
      setForKey.add(row.villaId);
      expectedByContractor.set(key, setForKey);
    }
  }

  const movement: ScorecardContractorMovement[] = contractors.map((c) => {
    const executed = updatedByContractor.get(c.id)?.size ?? 0;
    const planned = expectedByContractor.get(c.id)?.size ?? 0;
    const hasSchedule = c._count.wbsNodes > 0;
    return {
      contractorId: c.id,
      contractorName: c.name,
      scopeVillas: villaCountByContractor.get(c.id) ?? 0,
      executed,
      planned,
      notUpdated: Math.max(0, planned - executed),
      hasSchedule,
    };
  });

  // "Untagged" catch-all row — only surface when there's something to say.
  const untaggedScope = villaCountByContractor.get(null) ?? 0;
  const untaggedExecuted = updatedByContractor.get(null)?.size ?? 0;
  const untaggedPlanned = expectedByContractor.get(null)?.size ?? 0;
  if (untaggedScope > 0 || untaggedExecuted > 0 || untaggedPlanned > 0) {
    movement.push({
      contractorId: null,
      contractorName: "Untagged (assign a contractor)",
      scopeVillas: untaggedScope,
      executed: untaggedExecuted,
      planned: untaggedPlanned,
      notUpdated: Math.max(0, untaggedPlanned - untaggedExecuted),
      hasSchedule: untaggedScope > 0,
    });
  }

  // §3 block coverage — every block that had EITHER planned scope today OR
  // a villa that moved today (bonus "ahead of plan" moves).
  //
  // Build the ahead-of-plan set: villas that logged progress today but
  // whose milestone wasn't in the planned-today window. Each row carries
  // { villaId, villaNumber, villaLabel, blockCode } so we can slot it into
  // the right block strip with the gold-edged chip variant.
  interface AheadVilla { villaId: string; villaNumber: number; villaLabel: string; blockCode: string }
  const aheadByBlock = new Map<string, Map<string, AheadVilla>>();
  for (const e of entriesToday) {
    const villaId = e.wbsNode.villaId;
    const vm = e.wbsNode.villaMilestone;
    if (!villaId || !vm) continue;
    if (expectedVillaIds.has(villaId)) continue; // already in planned scope — not ahead
    const blockCode = vm.villa.block.code;
    const villaNumber = vm.villa.number;
    const villa = villas.find((v) => v.id === villaId);
    const villaLabel = villa?.label ?? `Villa ${villaNumber}`;
    if (!aheadByBlock.has(blockCode)) aheadByBlock.set(blockCode, new Map());
    aheadByBlock.get(blockCode)!.set(villaId, { villaId, villaNumber, villaLabel, blockCode });
  }

  const blockCoverage: ScorecardBlockCoverage[] = [];
  const orderedBlocks = [
    ...new Set([...expectedByBlock.keys(), ...aheadByBlock.keys()]),
  ].sort((a, b) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });
  for (const bcode of orderedBlocks) {
    const villaMap = expectedByBlock.get(bcode) ?? new Map();
    const aheadMap = aheadByBlock.get(bcode) ?? new Map<string, AheadVilla>();
    const villaList = [...villaMap.values()].sort((a, b) => a.villaNumber - b.villaNumber);
    let updatedCount = 0;
    let aheadCount = 0;
    const villas = villaList.map((v) => {
      const upd = updatedVillaIds.has(v.villaId);
      if (upd) updatedCount++;
      return { villaNumber: v.villaNumber, villaLabel: v.villaLabel, updated: upd, aheadOfPlan: false };
    });
    // Append gold-edged ahead villas below the planned ones.
    for (const ah of aheadMap.values()) {
      villas.push({
        villaNumber: ah.villaNumber,
        villaLabel: ah.villaLabel,
        updated: true,
        aheadOfPlan: true,
      });
      aheadCount++;
    }
    // Sort so all planned come first (in villaNumber order), then ahead in villaNumber order.
    villas.sort((a, b) => {
      if (a.aheadOfPlan !== b.aheadOfPlan) return a.aheadOfPlan ? 1 : -1;
      return a.villaNumber - b.villaNumber;
    });
    const scopeCount = villaList.length;
    // Colab counts a villa as "updated" for the block-status label if it
    // logged progress that day, regardless of whether it was in the planned
    // window (ahead-of-plan villas count too). So the status ratio uses
    // (updatedCount + aheadCount) not just updatedCount.
    const anyUpdated = updatedCount + aheadCount;
    blockCoverage.push({
      blockCode: bcode,
      villas,
      updatedCount,
      aheadCount,
      totalCount: scopeCount,
      status:
        anyUpdated === 0
          ? "none-updated"
          : scopeCount > 0 && updatedCount === scopeCount
          ? "all-updated"
          : "partially",
    });
  }

  return { snapshot, movement, blockCoverage };
}

/** §4 — manpower day summary. */
async function computeManpower(projectId: string, day: Date): Promise<DaySummary> {
  const dayStart = toDay(day);
  const [rawPlans, rawEntries, contractors] = await Promise.all([
    prisma.tradePlan.findMany({
      where: {
        projectId,
        deletedAt: null,
        startDate: { lte: dayStart },
        OR: [{ endDate: null }, { endDate: { gt: dayStart } }],
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
      where: { projectId, deletedAt: null, entryDate: dayStart },
      select: { contractorId: true, trade: true, entryDate: true, actualCount: true },
    }),
    prisma.contractor.findMany({
      where: { projectId },
      select: { id: true, name: true },
    }),
  ]);
  const plans: TradePlanRow[] = rawPlans.map((p) => ({
    contractorId: p.contractorId,
    trade: p.trade,
    plannedCount: p.plannedCount,
    startDate: p.startDate,
    endDate: p.endDate,
  }));
  const entries: ManpowerEntryRow[] = rawEntries.map((e) => ({
    contractorId: e.contractorId,
    trade: e.trade,
    entryDate: e.entryDate,
    actualCount: e.actualCount,
  }));
  const summary = daySummary(plans, entries, day);
  // RUNBOOK point 4 — holiday days get plannedTotal zeroed so we don't
  // count them against the working-day denominator, and the view can
  // render a "HOLIDAY" badge instead of a chart bar.
  if (isHoliday(day)) {
    summary.isHoliday = true;
    summary.plannedTotal = 0;
    summary.variance = summary.actualTotal;
    summary.pctOfPlan = null;
    for (const t of summary.trades) { t.planned = 0; t.pctOfPlan = null; t.variance = t.actual; }
  }
  const nameById = new Map(contractors.map((c) => [c.id, c.name]));
  summary.trades = summary.trades
    .map((t) => ({ ...t, contractorName: nameById.get(t.contractorId) ?? "Unknown" }))
    .sort((a, b) => {
      const nameCmp = (a.contractorName ?? "").localeCompare(b.contractorName ?? "");
      if (nameCmp !== 0) return nameCmp;
      return a.trade.localeCompare(b.trade);
    });
  return summary;
}

/** §7 — per-block progress. */
async function computeBlockProgress(projectId: string, asOf: Date): Promise<ScorecardBlockProgress[]> {
  const blocks = await prisma.block.findMany({
    where: { projectId },
    orderBy: { orderIndex: "asc" },
    select: {
      id: true,
      code: true,
      active: true,
      villas: {
        select: {
          id: true,
          number: true,
          milestones: {
            select: {
              baselineStart: true,
              baselineFinish: true,
              actualStart: true,
              actualFinish: true,
              projectedFinish: true,
            },
          },
        },
      },
    },
  });

  return blocks.map((b) => {
    // Roll up all milestones under this block.
    let plannedStart: Date | null = null;
    let plannedFinish: Date | null = null;
    let actualStart: Date | null = null;
    let projectedFinish: Date | null = null;
    let activitiesDue = 0;
    let activitiesClosed = 0;
    for (const v of b.villas) {
      for (const m of v.milestones) {
        if (m.baselineStart && (!plannedStart || m.baselineStart < plannedStart)) plannedStart = m.baselineStart;
        if (m.baselineFinish && (!plannedFinish || m.baselineFinish > plannedFinish)) plannedFinish = m.baselineFinish;
        if (m.actualStart && (!actualStart || m.actualStart < actualStart)) actualStart = m.actualStart;
        const pf = m.projectedFinish ?? m.actualFinish ?? m.baselineFinish;
        if (pf && (!projectedFinish || pf > projectedFinish)) projectedFinish = pf;
        if (m.baselineFinish && m.baselineFinish <= asOf) {
          activitiesDue++;
          if (m.actualFinish) activitiesClosed++;
        }
      }
    }
    const plannedDurationDays = daysBetween(plannedStart, plannedFinish);
    const actualDurationDays = daysBetween(actualStart ?? plannedStart, projectedFinish ?? plannedFinish);
    const delayDays = plannedFinish && projectedFinish
      ? Math.max(0, Math.round((projectedFinish.getTime() - plannedFinish.getTime()) / 86400000))
      : 0;
    const plannedPct = activitiesDue > 0 ? (activitiesClosed / activitiesDue) * 100 : 0;
    // Approx: use closed as actual (avoids reaching into ProgressEntry sums for the report).
    const actualPct = plannedPct;

    return {
      blockCode: b.code,
      villaCount: b.villas.length,
      activitiesDue,
      activitiesClosed,
      plannedPct: Math.round(plannedPct * 100) / 100,
      actualPct: Math.round(actualPct * 100) / 100,
      plannedStart,
      plannedFinish,
      actualStart,
      projectedFinish,
      plannedDurationDays,
      actualDurationDays,
      delayDays,
      villas: b.villas.map((v) => v.number).sort((a, b) => a - b),
      hasSchedule: b.active && b.villas.some((v) => v.milestones.length > 0),
    };
  });
}

/** §8 — project health footer. */
async function computeProjectHealth(projectId: string, asOf: Date): Promise<ScorecardProjectHealth> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      startDate: true,
      endDate: true,
      actualStartDate: true,
      projectedEndDate: true,
    },
  });
  const milestones = await prisma.villaMilestone.findMany({
    where: { villa: { projectId } },
    select: {
      baselineStart: true,
      baselineFinish: true,
      actualFinish: true,
    },
  });

  const plannedStart = project?.startDate ?? null;
  const plannedEnd = project?.endDate ?? null;
  const actualStart = project?.actualStartDate ?? null;
  const projectedEnd = project?.projectedEndDate ?? plannedEnd;

  const totalActivities = milestones.length;
  const activitiesToDate = milestones.filter((m) => m.baselineFinish && m.baselineFinish <= asOf).length;
  const closedToDate = milestones.filter((m) => m.actualFinish && m.actualFinish <= asOf).length;
  const overallClosed = milestones.filter((m) => m.actualFinish).length;

  const plannedProgressPct = totalActivities > 0 ? (activitiesToDate / totalActivities) * 100 : 0;
  const actualProgressPct = totalActivities > 0 ? (closedToDate / totalActivities) * 100 : 0;
  const overallCompletePct = totalActivities > 0 ? (overallClosed / totalActivities) * 100 : 0;

  return {
    plannedStart,
    plannedEnd,
    actualStart,
    projectedEnd,
    startVarianceDays: daysBetween(plannedStart, actualStart),
    endVarianceDays: daysBetween(plannedEnd, projectedEnd),
    plannedDurationDays: daysBetween(plannedStart, plannedEnd),
    actualDurationDays: daysBetween(actualStart ?? plannedStart, projectedEnd ?? plannedEnd),
    plannedProgressPct: Math.round(plannedProgressPct * 100) / 100,
    actualProgressPct: Math.round(actualProgressPct * 100) / 100,
    progressVariancePct: Math.round((actualProgressPct - plannedProgressPct) * 100) / 100,
    overallCompletePct: Math.round(overallCompletePct * 100) / 100,
    totalActivities,
    activitiesToDate,
  };
}

// ---------------------------------------------------------------------------
// Public API — one call, all sections, parallelised.
// ---------------------------------------------------------------------------

export async function getScorecard(projectId: string, day: Date = new Date()): Promise<Scorecard | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      code: true,
      logoUrl: true,
      tagline: true,
      address: true,
      startDate: true,
      endDate: true,
      projectedEndDate: true,
    },
  });
  if (!project) return null;

  const [
    dailyBundle,
    manpower,
    milestoneProgress,
    activityHighlights,
    blockProgress,
    projectHealth,
  ] = await Promise.all([
    computeDailySnapshotAndMovement(projectId, day),
    computeManpower(projectId, day),
    getMilestoneProgress(projectId, day),
    getSiteActivityHighlights(projectId, day),
    computeBlockProgress(projectId, day),
    computeProjectHealth(projectId, day),
  ]);

  return {
    project,
    asOf: toDay(day),
    dailySnapshot: dailyBundle.snapshot,
    movement: dailyBundle.movement,
    blockCoverage: dailyBundle.blockCoverage,
    manpower,
    milestoneProgress,
    activityHighlights,
    blockProgress,
    projectHealth,
  };
}
