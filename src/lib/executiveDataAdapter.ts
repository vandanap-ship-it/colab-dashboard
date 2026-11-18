// ---------------------------------------------------------------------------
// Executive-dashboard data adapter — real DB → component-friendly shape.
//
// The Overview / Layout / Matrix components were built against the mock-data
// module's shape (BLOCKS, VILLA_SLIPS, healthSummary, etc.). Rather than
// tear the components apart, this module maps a live DashboardBag (from
// rollupServer.ts) onto that same shape. If the transform hits missing data
// it fills in null / zero / "TBD" so the component still renders cleanly.
//
// Kept dependency-free of Prisma so it stays testable as a pure function.
// ---------------------------------------------------------------------------

import "server-only";

import { prisma } from "@/lib/prisma";
import type { DashboardBag, MatrixRow } from "@/lib/rollupServer";
import type { BlockRollup as ClientBlock, VillaRollup as ClientVilla, ContractorRollup, MilestoneCell, ProjectHealthSummary } from "@/lib/executiveMockData";
import { getProjectStats } from "@/lib/projectStats";
import { getProjectOverride } from "@/lib/projects";
import { milestoneSlipDays } from "@/lib/scheduleSlip";
// Kept only for the fallback mock contractor name below — the rest of the
// project-specific facts flow through getProjectOverride.
import { AMANVANA_CONTRACTORS } from "@/lib/projects/amanvana";

export interface AdaptedOverview {
  health: ProjectHealthSummary;
  villas: ClientVilla[];
  blocks: ClientBlock[];
  contractors: ContractorRollup[];
  sections: string[];
}

/**
 * Extras the adapter needs but a plain DashboardBag doesn't carry:
 * hindrance count and planned/achieved % from the shared projectStats math.
 * Fetch these alongside the bag so the Overview page can hand a complete
 * bundle to `adaptDashboardBag` — otherwise those cells fall back to 0
 * silently, which is the pre-launch audit's "always-zero KPI" complaint.
 */
export interface ExecutiveExtras {
  hindranceCount: number;
  plannedPct: number;
  achievedPct: number;
  /** Sum of Villa.unitCount across every in-scope villa in the project.
   *  Correct physical-villa count - a "Villa 10 & 11" row contributes 2, not 1.
   *  On Amanvana this reads 93 rather than the 90 that `Villa.count()` returns. */
  totalPhysicalVillas: number;
  /** Number of Villa rows the DB actually holds - same shape as the sum,
   *  but without unitCount expansion. Kept for callers that want the row
   *  count (e.g. the "Villa records" metric). */
  totalVillaRecords: number;
  /** Earliest villa-milestone baselineStart across the whole project - the
   *  actual first day of work on any villa. Used as the "Baseline Window"
   *  start so it spans BOTH contractors' schedules, not just Project.startDate. */
  scheduleStart: Date | null;
  /** Latest villa-milestone baselineFinish across the whole project - the
   *  actual last day of planned work. Paired with scheduleStart to form the
   *  Baseline Window. */
  scheduleEnd: Date | null;
  /** The honest headline-delay number for the Total Delay KPI:
   *  mean days overdue across milestones whose baseline has passed but which
   *  are not yet closed. Beats `projectedEnd - declaredEnd` as a KPI because
   *  projectedFinish is stale on most villas, so that math swings hundreds of
   *  days in the wrong direction. This math reflects what the site team is
   *  actually behind on today. 0 when nothing is overdue. */
  meanOpenSlipDays: number;
  /** Count of milestones whose baseline has passed. */
  milestonesDueByToday: number;
  /** Of those, how many are closed (actualFinish not null). */
  milestonesClosedByToday: number;
  /** Milestones that closed BEFORE their baseline date - work done ahead
   *  of plan. The positive counterpart to the Total Delay number. */
  milestonesAheadOfPlan: number;
  /** Mean days-ahead across the ahead-of-plan set. 0 when none. */
  meanAheadDays: number;
  /** Net schedule variance in days: behind - ahead, averaged across all
   *  milestones that have hit baseline or closed. Positive = net behind,
   *  negative = net ahead. Credits in-flight progress — the Total Delay
   *  headline. */
  netDaysVariance: number;
  /** Same net math on RAW calendar slip (no progress credit). Shown as the
   *  secondary "raw calendar slippage" figure beneath the headline so the
   *  conservative number stays visible. */
  calendarDelayDays: number;
  /** Total milestones feeding the net calc (behind + ahead). */
  evaluatedCount: number;
  /** Total behind-count feeding the net: open past-due + closed late. */
  behindCount: number;
  /** Rows for the "Where is the delay?" drill-down below the Total Delay
   *  tile. Newest-slipped-first; capped at 50 entries so a single pass
   *  gives management the shape without scrolling forever. */
  overdueList: Array<{
    villaNumber: number;
    villaLabel: string;
    blockCode: string;
    sectionName: string;
    activityName: string | null;
    baselineFinish: string;
    daysBehind: number;
  }>;
  /** Parallel list for milestones closed BEFORE their baseline date -
   *  the good-news side of the net. Lets the Total Delay drill-down show
   *  BOTH tracks (behind + ahead) in one place. Vandana 2026-11-04. */
  aheadList: Array<{
    villaNumber: number;
    villaLabel: string;
    blockCode: string;
    sectionName: string;
    baselineFinish: string;
    actualFinish: string;
    daysAhead: number;
  }>;
  /** Count of blocks that have at least one milestone with slip > 15 days,
   *  counting BOTH open-past-due AND closed-late milestones. The headline-
   *  friendly "Critical Blocks" number. The old rule only looked at the
   *  currently-active in-flight milestone, which read 0 when the delay
   *  lived in already-closed milestones that had rolled over. Vandana
   *  2026-11-05 management review. */
  criticalBlocksTotal: number;
  /** Project-level projected handover using the SAME critical-path math
   *  as the Progress tab (progressTabServer.getProgressHeroStats). For each
   *  villa, projected = (that villa's latest baselineFinish) + (that villa's
   *  max slip across all its milestones). Project handover = the max
   *  projected date across all villas — because the project finishes when
   *  the last villa hands over. Replaces baselineEnd + netDaysVariance,
   *  which averaged slip across milestones and therefore disagreed with
   *  the Progress tab's number (Vandana 2026-11-16 review-day unify). */
  projectProjectedHandover: Date | null;
  /** Live max credited milestone slip, keyed by villa.number and by block.code.
   *  Uses the SAME milestoneSlipDays engine (and the SAME VillaMilestone rows)
   *  that feed netDaysVariance + criticalBlocksTotal, so the Overview
   *  Healthy/Warning/Critical buckets bucket on the live number instead of the
   *  stale projectedFinish rollup (which under-counted: 7 critical in the bucket
   *  vs 10 in the tile — Vandana 2026-11-18). Rounded days. */
  villaSlipByNumber: Record<number, number>;
  blockSlipByCode: Record<string, number>;
}

export async function getExecutiveExtras(projectId: string): Promise<ExecutiveExtras> {
  const now = new Date();
  const [hindranceCount, stats, sumUnits, rowCount, milestoneWindow, overdueMilestones, dueByToday, closedByToday, aheadOfPlan, slipRows, handoverBaselines] = await Promise.all([
    prisma.hindrance.count({ where: { projectId, status: "OPEN" } }),
    getProjectStats(projectId),
    prisma.villa.aggregate({
      where: { projectId, inScope: true },
      _sum: { unitCount: true },
    }),
    prisma.villa.count({ where: { projectId, inScope: true } }),
    prisma.villaMilestone.aggregate({
      where: { villa: { projectId, inScope: true } },
      _min: { baselineStart: true },
      _max: { baselineFinish: true },
    }),
    // Rows past their baseline that aren't closed yet - the mean of
    // (today - baselineFinish) across these is the honest headline delay.
    // Pulled WITH enough context to render the "Where is the delay?"
    // drill-down list below the Total Delay tile.
    prisma.villaMilestone.findMany({
      where: {
        villa: { projectId, inScope: true },
        baselineFinish: { lte: now },
        actualFinish: null,
      },
      select: {
        baselineFinish: true,
        actualFinish: true,
        pctComplete: true,
        section: { select: { name: true } },
        villa: {
          select: {
            number: true, label: true,
            block: { select: { code: true } },
          },
        },
        // The first not-yet-closed activity under this milestone - gives the
        // overdue-list a concrete line-item for each row ("Footing
        // Reinforcement", "Plinth Beam Shuttering", ...).
        wbsNodes: {
          where: { actualFinish: null },
          orderBy: { orderIndex: "asc" },
          take: 1,
          select: { name: true },
        },
      },
    }),
    prisma.villaMilestone.count({
      where: { villa: { projectId, inScope: true }, baselineFinish: { lte: now } },
    }),
    prisma.villaMilestone.count({
      where: {
        villa: { projectId, inScope: true },
        baselineFinish: { lte: now },
        actualFinish: { not: null },
      },
    }),
    // Milestones closed before their baseline - work completed ahead of
    // plan. The positive counterpart to the Total Delay number so
    // management sees both sides, not only slippage. Now carries villa +
    // section context so the drill-down under Total Delay can show the
    // ahead-of-plan list next to the overdue list.
    prisma.villaMilestone.findMany({
      where: {
        villa: { projectId, inScope: true },
        actualFinish: { not: null },
      },
      select: {
        baselineFinish: true,
        actualFinish: true,
        pctComplete: true,
        section: { select: { name: true } },
        villa: {
          select: {
            number: true, label: true,
            block: { select: { code: true } },
          },
        },
      },
    }),
    // Every in-scope milestone with villa + baseline + actual — feeds the
    // villa-max-slip calc (critical-path projected handover). Same shape
    // the Progress tab fetches; keeps the two calculations aligned.
    prisma.villaMilestone.findMany({
      where: { villa: { projectId, inScope: true } },
      select: {
        baselineFinish: true,
        actualFinish: true,
        pctComplete: true,
        villa: { select: { id: true, number: true, block: { select: { code: true } } } },
      },
    }),
    prisma.villaMilestone.groupBy({
      by: ["villaId"],
      where: { villa: { projectId, inScope: true } },
      _max: { baselineFinish: true },
    }),
  ]);
  // Behind side - two contributors:
  //   1. Open past-due milestones: credited slip (days behind × work remaining).
  //   2. Closed-but-late milestones: actualFinish - baselineFinish (final).
  // Both are slippage and both belong in the net. We also keep a RAW
  // (un-credited) behind-sum so the Dashboard can show "X days raw calendar
  // slippage" beside the credited headline — see scheduleSlip.ts for why.
  let behindDaysSum = 0;       // credited
  let behindDaysSumRaw = 0;    // raw calendar
  for (const m of overdueMilestones) {
    behindDaysSum += milestoneSlipDays(m, now, true);
    behindDaysSumRaw += milestoneSlipDays(m, now, false);
  }
  let closedLateCount = 0;
  let closedLateDaysSum = 0;
  let aheadCount = 0;
  let aheadDaysSum = 0;
  for (const m of aheadOfPlan) {
    if (!m.baselineFinish || !m.actualFinish) continue;
    const diffDays = Math.round((m.actualFinish.getTime() - m.baselineFinish.getTime()) / 86_400_000);
    if (diffDays < 0) {
      aheadCount++;
      aheadDaysSum += -diffDays;
    } else if (diffDays > 0) {
      closedLateCount++;
      closedLateDaysSum += diffDays;
    }
  }
  const behindCount = overdueMilestones.length + closedLateCount;
  const behindTotal = behindDaysSum + closedLateDaysSum;         // credited
  const behindTotalRaw = behindDaysSumRaw + closedLateDaysSum;   // raw

  // Legacy mean-behind on the open-past-due set only, kept for the old
  // Total Delay fallback and the Progress-tab subtitles.
  const meanOpenSlipDays = overdueMilestones.length === 0
    ? 0
    : Math.round(behindDaysSum / overdueMilestones.length);
  const meanAheadDays = aheadCount === 0 ? 0 : Math.round(aheadDaysSum / aheadCount);

  // Net schedule variance: one number that captures slippage AND work done
  // ahead of plan. Positive = net behind. netDaysVariance credits in-flight
  // progress (the headline); calendarDelayDays is the same math on raw
  // calendar slip (the secondary "raw" figure).
  const evaluatedCount = behindCount + aheadCount;
  const netDaysVariance = evaluatedCount === 0
    ? 0
    : Math.round((behindTotal - aheadDaysSum) / evaluatedCount);
  const calendarDelayDays = evaluatedCount === 0
    ? 0
    : Math.round((behindTotalRaw - aheadDaysSum) / evaluatedCount);

  const overdueList = overdueMilestones
    .map((m) => {
      const v = m.villa;
      const daysBehind = Math.max(0, Math.round((now.getTime() - (m.baselineFinish?.getTime() ?? now.getTime())) / 86_400_000));
      return {
        villaNumber: v?.number ?? 0,
        villaLabel: v?.label ?? (v?.number ? `Villa ${v.number}` : "Villa"),
        blockCode: v?.block?.code ?? "-",
        sectionName: m.section?.name ?? "-",
        activityName: m.wbsNodes?.[0]?.name ?? null,
        baselineFinish: m.baselineFinish?.toISOString() ?? new Date(0).toISOString(),
        daysBehind,
      };
    })
    .sort((a, b) => b.daysBehind - a.daysBehind)
    .slice(0, 50);

  const aheadList = aheadOfPlan
    .map((m) => {
      if (!m.baselineFinish || !m.actualFinish) return null;
      const diffDays = Math.round((m.actualFinish.getTime() - m.baselineFinish.getTime()) / 86_400_000);
      if (diffDays >= 0) return null; // only ahead-of-plan rows
      const v = m.villa;
      return {
        villaNumber: v?.number ?? 0,
        villaLabel: v?.label ?? (v?.number ? `Villa ${v.number}` : "Villa"),
        blockCode: v?.block?.code ?? "-",
        sectionName: m.section?.name ?? "-",
        baselineFinish: m.baselineFinish.toISOString(),
        actualFinish: m.actualFinish.toISOString(),
        daysAhead: -diffDays,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.daysAhead - a.daysAhead)
    .slice(0, 50);

  // Critical Blocks (2026-11-05): distinct blocks that carry at least one
  // milestone slipped > 15 days, counting BOTH open past-due AND closed-late
  // milestones. The old rule only looked at the villa's currently-active
  // in-flight milestone which read 0 whenever the slippage had already
  // rolled over into a closed milestone.
  // Critical = block with any milestone whose CREDITED slip exceeds 15 days.
  // Using credited slip keeps this consistent with the headline: a block
  // that's 95% done and a few weeks past date isn't "critical", but one
  // genuinely stuck is. On Amanvana today this is unchanged at 10 blocks
  // either way — the stuck blocks stay flagged.
  const criticalBlockCodes = new Set<string>();
  for (const m of overdueMilestones) {
    if (!m.villa?.block?.code) continue;
    if (milestoneSlipDays(m, now, true) > 15) criticalBlockCodes.add(m.villa.block.code);
  }
  for (const m of aheadOfPlan) {
    if (!m.villa?.block?.code) continue;
    if (milestoneSlipDays(m, now, true) > 15) criticalBlockCodes.add(m.villa.block.code);
  }
  const criticalBlocksTotal = criticalBlockCodes.size;

  // Project-level projected handover using the same critical-path math as
  // the Progress tab. Per villa: max slip across its milestones; project
  // handover = max across villas of (baseline + slip). Same code lives in
  // progressTabServer.getProgressHeroStats; both call sites must move
  // together if the formula changes.
  const villaMaxSlip = new Map<string, number>();
  // Live max credited slip per villa.number and per block.code — the SAME
  // engine the Total Delay + Critical Blocks tiles use — so the Overview
  // health buckets stop reading the stale projectedFinish rollup. Rounded for
  // display; the >15 / >0 thresholds match blockStatus/villaStatus.
  const villaSlipByNumber: Record<number, number> = {};
  const blockSlipByCode: Record<string, number> = {};
  for (const m of slipRows) {
    if (!m.villa) continue;
    const slip = milestoneSlipDays(m, now, true); // credited
    if (slip > (villaMaxSlip.get(m.villa.id) ?? 0)) villaMaxSlip.set(m.villa.id, slip);
    const rounded = Math.round(slip);
    const num = m.villa.number;
    if (num != null) villaSlipByNumber[num] = Math.max(villaSlipByNumber[num] ?? 0, rounded);
    const code = m.villa.block?.code;
    if (code) blockSlipByCode[code] = Math.max(blockSlipByCode[code] ?? 0, rounded);
  }
  let latestProjectedMs = 0;
  for (const h of handoverBaselines) {
    const baseline = h._max.baselineFinish;
    if (!baseline) continue;
    const villaSlip = villaMaxSlip.get(h.villaId) ?? 0;
    const projectedMs = baseline.getTime() + villaSlip * 86_400_000;
    if (projectedMs > latestProjectedMs) latestProjectedMs = projectedMs;
  }
  const projectProjectedHandover = latestProjectedMs > 0 ? new Date(latestProjectedMs) : null;

  return {
    hindranceCount,
    plannedPct: stats.plannedPercent,
    achievedPct: stats.achievedPercent,
    totalPhysicalVillas: sumUnits._sum.unitCount ?? rowCount,
    totalVillaRecords: rowCount,
    scheduleStart: milestoneWindow._min.baselineStart ?? null,
    scheduleEnd:   milestoneWindow._max.baselineFinish ?? null,
    meanOpenSlipDays,
    milestonesDueByToday: dueByToday,
    milestonesClosedByToday: closedByToday,
    milestonesAheadOfPlan: aheadCount,
    meanAheadDays,
    netDaysVariance,
    calendarDelayDays,
    evaluatedCount,
    behindCount,
    overdueList,
    aheadList,
    criticalBlocksTotal,
    projectProjectedHandover,
    villaSlipByNumber,
    blockSlipByCode,
  };
}

// Project-specific overrides (Amanvana's contracted villa + block counts,
// detect-from-block-shape fingerprinting, etc.) live in
// src/lib/projects/*.ts and are dispatched through getProjectOverride.
// This adapter stays project-agnostic — it just asks the registry.

/** Fold a DashboardBag into the shape ExecutiveOverview / ExecutiveLayout expect. */
export function adaptDashboardBag(bag: DashboardBag, extras?: ExecutiveExtras): AdaptedOverview {
  const { project, sections: dbSections, rollup } = bag;

  const sections = dbSections.map((s) => s.name);

  // Map every block from the rollup into the client shape.
  const blocks: ClientBlock[] = rollup.blocks.map((b, i) => {
    const active = b.villas.some((v) => v.currentSection >= 0);
    const currentSection = active
      ? Math.max(0, ...b.villas.filter((v) => v.currentSection >= 0).map((v) => v.currentSection))
      : -1;
    return {
      code: b.code,
      villas: b.villas.map((v) => v.number),
      villaLabels: b.villas.map((v) => `Villa ${v.number}`),
      active,
      // Health bucket + colour read the LIVE max credited milestone slip —
      // the SAME milestoneSlipDays engine (over the same VillaMilestone rows)
      // that feeds the Total Delay + Critical Blocks tiles — so the bucket
      // count matches the tile exactly. Previously used b.currentSlipDays off
      // the rollup, whose slip derives from the STALE projectedFinish field,
      // so badly-behind blocks showed GREEN and the bucket read 7 critical vs
      // the tile's 10 (Vandana 2026-11-18). Falls back to the rollup value if
      // extras weren't fetched.
      slipDays: extras?.blockSlipByCode?.[b.code] ?? b.currentSlipDays,
      currentSection,
      currentPct: Math.round(b.percentComplete),
      pod: `Block ${b.code}`,      // pod grouping isn't in schema yet; fall back to block name
      // orderIndex is not part of the client shape but we preserve ordering via array position
      // (rollup.blocks is already sorted by orderIndex from the query).
      _order: i,
    } as ClientBlock & { _order: number };
  });

  const villas: ClientVilla[] = rollup.blocks.flatMap((b) =>
    b.villas
      .filter((v) => v.currentSection >= 0)  // active only
      .map((v) => ({
        number: v.number,
        blockCode: b.code,
        // Live max credited slip (same engine as the tiles); see block note above.
        slipDays: extras?.villaSlipByNumber?.[v.number] ?? v.currentSlipDays,
        pctComplete: Math.round(v.percentComplete),
        currentSection: v.currentSection,
        staleDays: v.staleDays ?? 0,
      })),
  );

  // Contractor rollup: for v1 we only track one contractor (Abraham Thomas).
  // Real per-contractor breakdown lives in a follow-up (needs Contractor↔
  // Villa ownership modeling).
  const activeBlocks = rollup.blocks.filter((b) => b.villas.some((v) => v.currentSection >= 0));
  const activeVillas = activeBlocks.flatMap((b) => b.villas.filter((v) => v.currentSection >= 0));

  // "Total villas" is the PHYSICAL count — 93 on Amanvana, not 90 —
  // because a combined-pair Villa row ("Villa 10 & 11") represents two
  // physical villas. Prefer the DB-derived sum(unitCount) from extras; fall
  // back to a row-count sum if the caller didn't fetch extras.
  const totalVillas =
    extras?.totalPhysicalVillas ?? rollup.blocks.reduce((n, b) => n + b.villas.length, 0);

  // Ask the project registry for any project-specific facts about the two
  // contractor hero cells (Abraham + Elegant). On Amanvana the contracts say
  // 41 / 12 and 52 / 12; other projects with no registered override fall
  // back to the whole-project row counts.
  const blockCodes = rollup.blocks.map((b) => b.code);
  const projectOverride = getProjectOverride({ blockCodes });
  const abrahamScope = projectOverride?.abrahamScopeOverride() ?? null;
  const atVillaCount = abrahamScope?.villaCount ?? totalVillas;
  const atBlockCount = abrahamScope?.blockCount ?? rollup.blocks.length;
  const elegantScope = projectOverride?.elegantScopeOverride() ?? null;
  const elegantVillaCount = elegantScope?.villaCount ?? 0;
  const elegantBlockCount = elegantScope?.blockCount ?? 0;

  // Split the rollup's blocks by contractor so each contractor's row on
  // Contractor Scope Health uses the villas they actually own. Previously
  // Abraham was given the whole-project rollup and Elegant was hardcoded
  // to zero / "tbd", which was wrong (Harish is updating Elegant villas
  // every day). Vandana 2026-11-04: fix this for the Nov-5 review.
  const { abraham: abrahamBlocks, elegant: elegantBlocks } =
    projectOverride?.splitBlocksByContractor(rollup.blocks) ?? { abraham: rollup.blocks, elegant: [] };

  const rollupFor = (blks: typeof rollup.blocks) => {
    const villas = blks.flatMap((b) => b.villas);
    const active = villas.filter((v) => v.currentSection >= 0);
    const avgPct = villas.length === 0
      ? 0
      : Math.round(villas.reduce((s, v) => s + v.percentComplete, 0) / villas.length);
    const avgCurrentSlip = active.length === 0
      ? 0
      : Math.round(active.reduce((s, v) => s + v.currentSlipDays, 0) / active.length);
    const criticalBlocks = blks.filter((b) => b.currentSlipDays > 15).length;
    const criticalVillas = active.filter((v) => v.currentSlipDays > 15).length;
    const handoverSlip = Math.max(0, ...active.map((v) => v.handoverSlipDays));
    return { activeCount: active.length, avgPct, avgCurrentSlip, criticalBlocks, criticalVillas, handoverSlip };
  };
  const abrahamR = rollupFor(abrahamBlocks);
  const elegantR = rollupFor(elegantBlocks);

  const healthFor = (r: ReturnType<typeof rollupFor>): ContractorRollup["health"] => {
    if (r.activeCount === 0) return "tbd";
    if (r.criticalBlocks > 0) return "critical";
    if (r.handoverSlip > 14) return "warning";
    if (r.handoverSlip > 0) return "ok";
    return "healthy";
  };

  const contractors: ContractorRollup[] = [
    {
      name: AMANVANA_CONTRACTORS.abraham,
      category: "Civil / Structural - Phase 1",
      scopeVillas: atVillaCount,
      activeVillas: abrahamR.activeCount,
      completePct: abrahamR.avgPct,
      avgDelayDays: abrahamR.avgCurrentSlip,
      criticalRisks: abrahamR.criticalVillas,
      health: healthFor(abrahamR),
    },
  ];
  if (elegantScope && elegantVillaCount > 0) {
    contractors.push({
      name: AMANVANA_CONTRACTORS.elegant,
      category: "Civil / Structural - Phase 2",
      scopeVillas: elegantVillaCount,
      activeVillas: elegantR.activeCount,
      completePct: elegantR.avgPct,
      avgDelayDays: elegantR.avgCurrentSlip,
      criticalRisks: elegantR.criticalVillas,
      health: healthFor(elegantR),
    });
  }
  // Legacy name kept for the KPI cards below (hero slip / rail critical).
  const avgSlip = abrahamR.avgCurrentSlip;
  void avgSlip;

  // Build the top-of-page ProjectHealthSummary from real project metadata + rollup numbers.
  // Total Delay definition: signed days between the schedule's latest
  // projected finish and the project's declared end date. Positive = the
  // schedule extends past the declared end (either an outlier villa
  // baseline that predates a re-baseline, or actual slip that hasn't been
  // reconciled into project.endDate). Negative = schedule ends before the
  // declared end (project overshot its own committed date and should
  // shorten its declared end). Zero = they agree.
  //
  // Was: rollup.handoverSlipDays — which is a per-villa milestone-slip
  // rollup (max across villas of handover milestone delayDays). That
  // metric can read 0 while the schedule's latest villa finish sits
  // months past project.endDate (villa 63 in Amanvana P1 has a baseline
  // handover of 20 Mar 29 vs a project.endDate of 25 Sept 27 — no
  // milestone is "slipping", but the project as a whole IS 541 days
  // beyond its own declared end date). The hero card would say
  // "0 days / on track" and hide the 18-month gap. The audit for the
  // Sept 15 walkthrough surfaced this as the single most confusing
  // number on the dashboard.
  const declaredEnd = project.endDate ?? new Date();

  // Baseline Window - earliest villa-milestone baselineStart across the
  // WHOLE project, and latest baselineFinish across the whole project.
  // Spans both contractors' schedules (previously used project.startDate /
  // .endDate which was Abraham-only). Falls back to project.startDate /
  // .endDate when the DB doesn't have milestone dates yet.
  const baselineStart = extras?.scheduleStart ?? project.startDate ?? new Date();
  const baselineEnd = extras?.scheduleEnd ?? declaredEnd;

  // Total Delay (unchanged semantics): mean drag across all evaluated
  // milestones. A portfolio-level signal that doesn't hide behind a
  // critical-path villa that hasn't started yet. Positive = net behind.
  const totalDelayDays = extras?.netDaysVariance ?? 0;

  // Projected handover (2026-11-16 unify): Dashboard and Progress tab
  // now share the SAME critical-path math — each villa's baseline + its
  // max slip, then max across villas. Was previously baselineEnd +
  // netDaysVariance, so the two tabs could disagree whenever slip wasn't
  // evenly distributed. Falls back to the old shift if extras didn't
  // compute the per-villa projection (e.g. empty DB).
  const projectedEnd = extras?.projectProjectedHandover
    ?? new Date(baselineEnd.getTime() + totalDelayDays * 86_400_000);

  const health: ProjectHealthSummary = {
    totalPlots: totalVillas,
    inScope: totalVillas,
    villaRecordCount: extras?.totalVillaRecords,
    modelVillas: 0,
    phase1Villas: activeVillas.length,
    phase1BlocksActive: activeBlocks.length,
    atVillas: atVillaCount,
    atBlocks: atBlockCount,
    elegantVillas: elegantVillaCount,
    elegantBlocks: elegantBlockCount,
    baselineStart,
    baselineEnd,
    reraEndDate: project.reraEndDate ?? null,
    projectedEnd,
    totalDelayDays,
    calendarDelayDays: extras?.calendarDelayDays,
    reraDelayDays: computeReraDelay(project.reraEndDate, rollup.projectedEnd),
    hindrances: extras?.hindranceCount ?? 0,
    // Prefer the slip-inclusive count from extras (counts closed-late milestones
    // too). Falls back to rollup.criticalBlocks when the caller didn't pass
    // extras - that path only looks at currently-in-flight slip.
    criticalBlocks: extras?.criticalBlocksTotal ?? rollup.criticalBlocks,
    probability: probabilityBand(project.reraEndDate, rollup.projectedEnd),
    // plannedPct/achievedPct come from projectStats when the caller passes
    // extras — that's the same math the Snapshot page's gauge uses, so the
    // two views agree. When no extras are passed the achievedPct falls back
    // to the rollup's own percentComplete (which is close but not identical
    // — projectStats handles the ColabActivity override).
    plannedPct: extras?.plannedPct ?? 0,
    achievedPct: extras?.achievedPct ?? Math.round(rollup.percentComplete * 100) / 100,
    asOf: new Date(),
    milestonesDueByToday: extras?.milestonesDueByToday,
    milestonesClosedByToday: extras?.milestonesClosedByToday,
    milestonesAheadOfPlan: extras?.milestonesAheadOfPlan,
    meanAheadDays: extras?.meanAheadDays,
    overdueList: extras?.overdueList,
    aheadList: extras?.aheadList,
  };

  return { health, villas, blocks, contractors, sections };
}

function computeReraDelay(rera: Date | null, projected: Date | null): number {
  if (!rera || !projected) return 0;
  return Math.max(0, Math.round((projected.getTime() - rera.getTime()) / 86_400_000));
}

function probabilityBand(rera: Date | null, projected: Date | null): "low" | "med" | "high" {
  if (!rera || !projected) return "high";
  const slip = Math.round((projected.getTime() - rera.getTime()) / 86_400_000);
  if (slip <= 0) return "high";
  if (slip <= 15) return "med";
  return "low";
}

// ---------------------------------------------------------------------------
// Milestone Matrix adapter — real MatrixRow[] → component's MilestoneCell[]
// ---------------------------------------------------------------------------

export interface AdaptedMatrix {
  villaOrder: number[];
  villaLabels: Map<number, string>;
  cellsByVilla: Map<number, MilestoneCell[]>;
  sectionNames: string[];
  sectionHeaders: string[];
}

export function adaptMatrixRows(rows: MatrixRow[], sections: DashboardBag["sections"]): AdaptedMatrix {
  const villaOrder: number[] = rows.map((r) => r.villaNumber);
  const villaLabels = new Map(rows.map((r) => [r.villaNumber, r.villaLabel]));

  const cellsByVilla = new Map<number, MilestoneCell[]>();
  for (const r of rows) {
    // Build a section→cell lookup for this villa.
    const bySection = new Map(r.cells.map((c) => [c.sectionCode, c]));
    const orderedCells: MilestoneCell[] = sections.map((s): MilestoneCell => {
      const c = bySection.get(s.code);
      if (!c) {
        return {
          plannedDate: new Date(0),
          actualDate: null,
          projectedDate: null,
          delayDays: null,
          crmDate: null,
          crmDelayDays: null,
          plannedCollection: 0,
          progressPct: 0,
        };
      }
      const delayDays = c.baselineFinish && (c.actualFinish || c.projectedFinish)
        ? Math.max(0, Math.round(
            ((c.actualFinish ?? c.projectedFinish!).getTime() - c.baselineFinish.getTime()) / 86_400_000,
          ))
        : null;
      return {
        plannedDate: c.baselineFinish ?? new Date(0),
        actualDate: c.actualFinish,
        projectedDate: c.projectedFinish,
        delayDays,
        crmDate: c.crmDate,
        crmDelayDays: c.crmDelay,
        plannedCollection: c.plannedCollection ?? 0,
        progressPct: Math.round(c.pctComplete),
      };
    });
    cellsByVilla.set(r.villaNumber, orderedCells);
  }

  const sectionNames = sections.map((s) => s.name);
  const sectionHeaders = sectionNames.map((s) => s.toUpperCase());
  return { villaOrder, villaLabels, cellsByVilla, sectionNames, sectionHeaders };
}
