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
import { istDayStart } from "@/lib/istDay";
import { isHoliday } from "@/lib/holidays";

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
  daysLate: number | null;
  movedThisWeek?: boolean;
  daysIdle?: number;
  reason?: string;
  /** ISO of milestone actualStart — used by the Stalled aging-bar panel's
   *  "since DD MMM" caption (RUNBOOK weekly §3). Only populated for the
   *  inProgressStalled items to keep other buckets lean. */
  sinceDate?: string;
}

export interface WeeklyMilestonePlan {
  contractorId: string | null; // null = "Untagged / project-level" bucket
  contractorName: string;
  hasSchedule: boolean;
  toComplete: { total: number; closed: number; items: WeeklyMilestoneItem[] };
  toStart:    { total: number; started: number; items: WeeklyMilestoneItem[]; spill: number; spillItems: WeeklyMilestoneItem[] };
  inProgress: { total: number; moving: number; stalled: number; movingItems: WeeklyMilestoneItem[]; stalledItems: WeeklyMilestoneItem[] };
  overdue:    { total: number; items: WeeklyMilestoneItem[] };
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
  count: number;              // # of hindrance / progress-reason rows contributing
  daysImpact: number;         // sum of daysImpact from hindrances
  /** Avg days late per activity — daysImpact / count, rounded. Colab §5
   *  headline is "avg Xd · worst Yd · N acts · M villas". */
  avgDaysImpact: number;
  /** Worst (max) days late seen in this reason bucket. */
  maxDaysImpact: number;
  affectedVillas: number[];
  activityCount: number;      // distinct wbsNodes involved
  hasProjectLevel: boolean;   // true if any project-level (no wbsNode) row
  mitigation: string;
}

export interface WeeklyManpowerSiteTotal {
  weeklyPlanned: number;
  weeklyActual: number;
  pctOfPlan: number | null;
  bestDayActual: number;
  bestDayDate: string | null;
  workingDays: number;
  loggedDays: number;
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
  manpowerSiteTotal: WeeklyManpowerSiteTotal;
  manpowerByContractor: WeeklyManpowerRow[];
  delayReasons: DelayReasonWithMitigation[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UNTAGGED_LABEL = "Untagged / to be assigned";

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
function daysLatePos(baseline: Date | null | undefined, at: Date): number | null {
  if (!baseline) return null;
  return Math.max(0, daysBetween(baseline, at));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getWeeklyReport(projectId: string, weekEnding: Date): Promise<WeeklyReport | null> {
  const weekEnd = istDayStart(weekEnding);
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
    weekProgressReasons,
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
            id: true,
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
            villaMilestone: { select: { id: true, villaId: true } },
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
    // Hindrances that were OPEN at any point during the week — either
    // started this week, or already open going in and either resolved
    // this week or still open. This matches "impacted this week", not
    // "still open forever".
    prisma.hindrance.findMany({
      where: {
        projectId,
        OR: [
          { startDate: { gte: weekStart, lte: weekEnd } },
          {
            startDate: { lt: weekStart },
            OR: [{ status: "OPEN" }, { resolvedDate: { gte: weekStart, lte: weekEndExclusive } }],
          },
        ],
      },
      select: {
        id: true,
        reasonCode: true,
        daysImpact: true,
        startDate: true,
        resolvedDate: true,
        status: true,
        wbsNodeId: true,
        wbsNode: {
          select: {
            id: true,
            villaMilestone: { select: { id: true, villaId: true } },
          },
        },
      },
    }),
    // Progress entries this week that carry a reasonCode — they never
    // opened a Hindrance, but the site engineer flagged a delay reason
    // on the log itself. These must feed the Weekly Delay Reasons.
    prisma.progressEntry.findMany({
      where: {
        projectId,
        deletedAt: null,
        date: { gte: weekStart, lt: weekEndExclusive },
        reasonCode: { not: null },
      },
      select: {
        reasonCode: true,
        wbsNodeId: true,
        wbsNode: {
          select: {
            id: true,
            villaMilestone: { select: { villaId: true } },
          },
        },
      },
    }),
  ]);

  if (!project) return null;

  const villaIdToNumber = new Map(villas.map((v) => [v.id, v.number]));

  // ------- §1 Overall Progress at week end -------
  // Python-parity (build_wk23.py L12-14): sum Physical_Progress directly from
  // the raw Colab CSV mirror (ColabActivity), NOT from wbsNode.weightPct.
  // wbsNodes and Colab activities don't map 1:1 (fuzzy matching lands on
  // ~20 %), so wbsNode-based sums undercount by ~4×. Reading from
  // ColabActivity gives us the exact same 100-% universe Python sees.
  //   target = sum(physicalProgress) where plannedEnd <= weekEnd
  //   actual = sum(physicalProgress) where progressDate NOT NULL and <= weekEnd
  const [tgtAgg, actAgg] = await Promise.all([
    prisma.colabActivity.aggregate({
      where: { projectId, plannedEnd: { lte: weekEnd } },
      _sum: { physicalProgress: true },
    }),
    prisma.colabActivity.aggregate({
      where: { projectId, progressDate: { not: null, lte: weekEnd } },
      _sum: { physicalProgress: true },
    }),
  ]);
  const overall: WeeklyOverallProgress = (() => {
    const p = Math.round((tgtAgg._sum.physicalProgress ?? 0) * 100) / 100;
    const a = Math.round((actAgg._sum.physicalProgress ?? 0) * 100) / 100;
    return { plannedPct: p, actualPct: a, variancePct: Math.round((a - p) * 100) / 100 };
  })();

  // ------- Reason index: per villaMilestone, best-effort reason label -------
  // Weekly Milestone Breakdown wants each item to show WHY it's late.
  // Sources in order of preference:
  //   1) Hindrance opened on the milestone's wbsNode(s) this week
  //   2) ProgressEntry.reasonCode logged on the milestone's wbsNode(s) this week
  const reasonByMilestone = new Map<string, string>();
  {
    // Build a wbsNode -> villaMilestoneId lookup from villas we already loaded.
    const wbsToMilestone = new Map<string, string>();
    for (const v of villas) {
      for (const m of v.milestones) {
        for (const w of m.wbsNodes) wbsToMilestone.set(w.id, m.id);
      }
    }
    for (const h of weekHindrances) {
      if (!h.reasonCode) continue;
      const wbsId = h.wbsNode?.id;
      const mid = wbsId ? wbsToMilestone.get(wbsId) : h.wbsNode?.villaMilestone?.id;
      if (!mid || reasonByMilestone.has(mid)) continue;
      reasonByMilestone.set(mid, reasonLabel(h.reasonCode));
    }
    for (const pe of weekProgressReasons) {
      if (!pe.reasonCode) continue;
      const wbsId = pe.wbsNode?.id;
      const mid = wbsId ? wbsToMilestone.get(wbsId) : undefined;
      if (!mid || reasonByMilestone.has(mid)) continue;
      reasonByMilestone.set(mid, reasonLabel(pe.reasonCode));
    }
  }

  // ------- §2 Milestone Plan per contractor -------
  // Milestones that had a ProgressEntry this week — a villa can move on
  // one milestone while another on the same villa sits stalled, so we
  // track at milestone granularity, not villa granularity.
  const movedMilestoneIds = new Set<string>(
    weekEntries
      .map((e) => e.wbsNode.villaMilestone?.id)
      .filter((x): x is string => !!x),
  );
  // Milestones that closed this week (for `toComplete.closed`).
  const closedThisWeekMilestones = new Set<string>();
  // Milestones that started this week (for `toStart.started`).
  const startedThisWeekMilestones = new Set<string>();
  for (const v of villas) {
    for (const m of v.milestones) {
      if (m.actualFinish && m.actualFinish >= weekStart && m.actualFinish <= weekEnd) {
        closedThisWeekMilestones.add(m.id);
      }
      if (m.actualStart && m.actualStart >= weekStart && m.actualStart <= weekEnd) {
        startedThisWeekMilestones.add(m.id);
      }
    }
  }

  type Bucket = {
    toComplete: WeeklyMilestoneItem[];
    toStart: WeeklyMilestoneItem[];
    toStartSpill: WeeklyMilestoneItem[];
    inProgressMoving: WeeklyMilestoneItem[];
    inProgressStalled: WeeklyMilestoneItem[];
    overdue: WeeklyMilestoneItem[];
    closedCount: number;
    startedCount: number;
  };
  const emptyBucket = (): Bucket => ({
    toComplete: [], toStart: [], toStartSpill: [], inProgressMoving: [], inProgressStalled: [], overdue: [],
    closedCount: 0, startedCount: 0,
  });

  const contractorItems = new Map<string, Bucket>();
  contractors.forEach((c) => contractorItems.set(c.id, emptyBucket()));
  // Untagged bucket — populated on demand so we don't show it for projects
  // with 100 % coverage.
  const untaggedBucket: Bucket = emptyBucket();
  let untaggedHasAny = false;

  // Python-parity: bucket by the villa's CURRENT stage (earliest not-done
  // milestone by section orderIndex), not every milestone. Otherwise a villa
  // with V15 Foundation active + V15 Plinth planned counts in both "in
  // progress" and "to start", double-inflating the weekly buckets.
  for (const v of villas) {
    const sortedMs = [...v.milestones].sort(
      (a, b) => (a.section?.orderIndex ?? 0) - (b.section?.orderIndex ?? 0),
    );
    const currentStage = sortedMs.find((m) => m.actualFinish == null);
    if (!currentStage) continue; // villa fully closed — nothing to bucket this week
    for (const m of [currentStage]) {
      // Which contractor(s) claim this milestone? A milestone with no
      // wbsNodes, or wbsNodes with all-null contractorId, is "untagged".
      const contractorIds = [...new Set(
        m.wbsNodes.map((w) => w.contractorId).filter((c): c is string => !!c),
      )];
      let buckets: Bucket[];
      if (contractorIds.length > 0) {
        buckets = contractorIds
          .map((cid) => contractorItems.get(cid))
          .filter((b): b is Bucket => !!b);
        if (buckets.length === 0) {
          // Tagged to contractor(s) that aren't active — fall back to untagged.
          buckets = [untaggedBucket];
          untaggedHasAny = true;
        }
      } else {
        buckets = [untaggedBucket];
        untaggedHasAny = true;
      }

      const reason = reasonByMilestone.get(m.id);
      const baseItem: WeeklyMilestoneItem = {
        villaNumber: v.number,
        villaLabel: v.label ?? `Villa ${v.number}`,
        blockCode: v.block.code,
        milestoneName: m.section?.name ?? "—",
        daysLate: daysLatePos(m.baselineFinish, weekEnd),
        reason,
      };

      // Python-parity "closed / started" — bounded by weekEnd (historical
      // weeks must not count milestones that closed AFTER the reporting week).
      const notDoneByWeekEnd = !m.actualFinish || m.actualFinish > weekEnd;
      const startedByWeekEnd = !!m.actualStart && m.actualStart <= weekEnd;

      for (const b of buckets) {
        // Python parity (build_wk23.py lines 71-80):
        //   tc_wk   = pe in [WKS, WKE] AND NOT done                   → toComplete "this week"
        //   tc_done = pe in [WKS, WKE] AND     done                   → toComplete closed counter
        //   tc_sp   = pe < WKS AND NOT done                           → overdue (spill)
        //   ts_wk   = ps in [WKS, WKE] AND NOT done                   → toStart "this week" (regardless of started)
        //   ts_started = ts_wk AND started                            → toStart started counter
        //   ts_sp   = ps < WKS AND NOT started AND NOT done           → toStart spill (rendered as overdue-to-start)
        //   ip_plan = ps <= WKE AND pe >= WKS AND NOT done            → inProgress "planned this week"
        //   ip_actual = ip_plan AND started                           → moving; the rest = stalled

        // TO COMPLETE
        if (m.baselineFinish && m.baselineFinish >= weekStart && m.baselineFinish <= weekEnd) {
          if (notDoneByWeekEnd) b.toComplete.push(baseItem);
          else b.closedCount++;
        }
        // TO START (this week bucket includes both started + not-started)
        if (m.baselineStart && m.baselineStart >= weekStart && m.baselineStart <= weekEnd && notDoneByWeekEnd) {
          b.toStart.push(baseItem);
          if (startedByWeekEnd) b.startedCount++;
        }
        // IN PROGRESS = span overlaps week AND not done. Regardless of actualStart —
        // that's what Python's `ip_plan` captures. `moving` = started,
        // `stalled` = no actualStart yet even though the plan says we should be in it.
        if (
          m.baselineStart && m.baselineFinish &&
          m.baselineStart <= weekEnd && m.baselineFinish >= weekStart &&
          notDoneByWeekEnd
        ) {
          if (startedByWeekEnd) {
            b.inProgressMoving.push({ ...baseItem, movedThisWeek: movedMilestoneIds.has(m.id) });
          } else {
            b.inProgressStalled.push({
              ...baseItem,
              movedThisWeek: false,
              daysIdle: Math.max(0, daysBetween(m.baselineStart, weekEnd)),
            });
          }
        }
        // SPILL — items whose scheduled window is behind us:
        //   overdue = to_complete spill (pe < weekStart, still open)
        //   toStartSpill = to_start spill (ps < weekStart, still not started, still open)
        if (m.baselineFinish && m.baselineFinish < weekStart && notDoneByWeekEnd) {
          b.overdue.push(baseItem);
        }
        if (m.baselineStart && m.baselineStart < weekStart && !startedByWeekEnd && notDoneByWeekEnd) {
          b.toStartSpill.push(baseItem);
        }
      }
    }
  }

  const buildPlan = (
    contractorId: string | null,
    contractorName: string,
    hasSchedule: boolean,
    b: Bucket,
  ): WeeklyMilestonePlan => ({
    contractorId,
    contractorName,
    hasSchedule,
    toComplete: {
      // Python parity (build_wk23.py L114): wk_plan = open + closed.
      total: b.toComplete.length + b.closedCount,
      closed: b.closedCount,
      items: b.toComplete,
    },
    toStart: {
      total: b.toStart.length,
      started: b.startedCount,
      items: b.toStart,
      spill: b.toStartSpill.length,
      spillItems: b.toStartSpill.slice(0, 12),
    },
    inProgress: {
      total: b.inProgressMoving.length + b.inProgressStalled.length,
      moving: b.inProgressMoving.length,
      stalled: b.inProgressStalled.length,
      movingItems: b.inProgressMoving.slice(0, 12),
      stalledItems: b.inProgressStalled.slice(0, 12),
    },
    overdue: {
      total: b.overdue.length,
      items: b.overdue.slice(0, 12),
    },
  });

  const milestonePlans: WeeklyMilestonePlan[] = contractors.map((c) =>
    buildPlan(c.id, c.name, c._count.wbsNodes > 0, contractorItems.get(c.id)!),
  );
  // Per WEEKLY_HANDOFF.md: only two contractors on Amanvana Phase 1
  // (Abraham + Elegant). Untagged wbsNodes are data-hygiene work — not a
  // report bucket. Leave `untaggedHasAny` computed for future diagnostics
  // but never emit a "Contractor 3 · Untagged" row.
  void UNTAGGED_LABEL;
  void untaggedBucket;
  void untaggedHasAny;

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
    // Holiday post-processing per RUNBOOK point 4 — holiday days contribute
    // zero to the weekly planned denominator (no work expected), keep the
    // actualTotal as-is (workers may have shown up), and are flagged so the
    // view can shade them.
    for (const d of perDay) {
      if (isHoliday(d.date)) {
        d.isHoliday = true;
        d.plannedTotal = 0;
        for (const t of d.trades) { t.planned = 0; t.pctOfPlan = null; t.variance = t.actual; }
      }
    }
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

  // Site-total roll-up for the §4 header tile (Python parity — build_wk23.py
  // L179-191). Sums across all contractors so the report opens with one
  // clear "how did the whole site do this week" number before the per-
  // contractor breakdown.
  const manpowerSiteTotal: WeeklyManpowerSiteTotal = (() => {
    let plan = 0, actual = 0, bestActual = 0;
    let bestDate: string | null = null;
    let workingDays = 7, loggedDays = 0;
    if (manpowerByContractor.length > 0) {
      // Sum per-day totals across contractors — one loggedDays / workingDays
      // per DATE (union across contractors).
      const first = manpowerByContractor[0].perDay;
      workingDays = first.filter((d) => !d.isHoliday).length;
      for (let i = 0; i < first.length; i++) {
        let dayPlan = 0, dayActual = 0, anyLogged = false;
        for (const c of manpowerByContractor) {
          const d = c.perDay[i];
          if (!d) continue;
          dayPlan += d.plannedTotal;
          dayActual += d.actualTotal;
          if (d.actualTotal > 0) anyLogged = true;
        }
        plan += dayPlan;
        actual += dayActual;
        if (anyLogged) loggedDays++;
        if (dayActual > bestActual) {
          bestActual = dayActual;
          bestDate = first[i].date.toISOString().slice(0, 10);
        }
      }
    }
    return {
      weeklyPlanned: plan,
      weeklyActual: actual,
      pctOfPlan: plan > 0 ? Math.round((actual / plan) * 100) : null,
      bestDayActual: bestActual,
      bestDayDate: bestDate,
      workingDays,
      loggedDays,
    };
  })();

  // ------- §4 Delay Reasons & Mitigation -------
  const reasonMap = new Map<string, {
    label: string;
    count: number;
    daysImpact: number;
    maxDaysImpact: number;
    villas: Set<number>;
    activityIds: Set<string>;
    hasProjectLevel: boolean;
  }>();
  const upsertReason = (
    code: string | null,
    daysImpact: number,
    villaId: string | null | undefined,
    activityId: string | null | undefined,
    isProjectLevel: boolean,
  ) => {
    const key = code ?? "UNSPECIFIED";
    const entry = reasonMap.get(key) ?? {
      label: reasonLabel(code),
      count: 0,
      daysImpact: 0,
      maxDaysImpact: 0,
      villas: new Set<number>(),
      activityIds: new Set<string>(),
      hasProjectLevel: false,
    };
    entry.count++;
    entry.daysImpact += daysImpact;
    if (daysImpact > entry.maxDaysImpact) entry.maxDaysImpact = daysImpact;
    if (villaId) {
      const num = villaIdToNumber.get(villaId);
      if (num != null) entry.villas.add(num);
    }
    if (activityId) entry.activityIds.add(activityId);
    if (isProjectLevel) entry.hasProjectLevel = true;
    reasonMap.set(key, entry);
  };

  for (const h of weekHindrances) {
    const villaId = h.wbsNode?.villaMilestone?.villaId ?? null;
    const activityId = h.wbsNode?.id ?? null;
    upsertReason(h.reasonCode, h.daysImpact ?? 0, villaId, activityId, !h.wbsNodeId);
  }
  for (const pe of weekProgressReasons) {
    // ProgressEntry reasons don't have a daysImpact — count them but don't inflate days.
    const villaId = pe.wbsNode?.villaMilestone?.villaId ?? null;
    upsertReason(pe.reasonCode, 0, villaId, pe.wbsNodeId, !pe.wbsNodeId);
  }
  const delayReasons: DelayReasonWithMitigation[] = [...reasonMap.entries()]
    .map(([code, v]) => ({
      code,
      label: v.label,
      count: v.count,
      daysImpact: v.daysImpact,
      avgDaysImpact: v.count > 0 ? Math.round(v.daysImpact / v.count) : 0,
      maxDaysImpact: v.maxDaysImpact,
      affectedVillas: [...v.villas].sort((a, b) => a - b),
      activityCount: v.activityIds.size,
      hasProjectLevel: v.hasProjectLevel,
      mitigation: mitigationFor(code),
    }))
    .sort((a, b) => b.daysImpact - a.daysImpact || b.count - a.count);

  return {
    project,
    weekStart,
    weekEnd,
    overall,
    milestonePlans,
    manpowerSiteTotal,
    manpowerByContractor,
    delayReasons,
  };
}
