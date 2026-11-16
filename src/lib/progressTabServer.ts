// Aggregations that power the Progress top tab:
//   §0 Headline card - how far behind baseline we actually are today.
//   §1 Planned vs Actual - per milestone-section, planned vs actual completion.
//   §2 Villa-wise physical progress - one row per villa with status + slip.
//   §3 Section filter - per-section villa status (Completed / Ongoing /
//      Delayed / Not started) so the view can filter and colour.
//
// All server-only; UI components take these shapes and stay Prisma-free.

import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// §0 - overall honest delay picture
// ---------------------------------------------------------------------------

export interface ProgressHeroStats {
  /** Milestones whose baselineFinish has already passed. */
  dueByToday: number;
  /** Of those, how many have an actualFinish set. */
  closedByToday: number;
  /** dueByToday - closedByToday. */
  openPastDue: number;
  /** Mean (today - baselineFinish) across the open-past-due set. 0 if none. */
  meanDaysBehind: number;
  /** Max (today - baselineFinish) across the open-past-due set. 0 if none. */
  maxDaysBehind: number;
  /** Count of milestones closed BEFORE baseline (good side). */
  aheadCount: number;
  /** Mean (baselineFinish - actualFinish) across the ahead-of-plan set. 0 if none. */
  meanDaysAhead: number;
  /** Net schedule variance in days across everything evaluated:
   *    sum of (behind days) - sum of (ahead days), divided by (behind + ahead counts).
   *  Positive = net behind, negative = net ahead. The single-number headline
   *  Vandana + boss asked for (2026-11-04, pyramid / net-delay thinking).
   *  Falls back to 0 when nothing's been evaluated yet. */
  netDaysVariance: number;
  /** Total milestones that fed the net calculation (behind + ahead counts). */
  evaluatedCount: number;
  /** Total milestones across the whole project (every in-scope villa ×
   *  every section). Vandana 2026-11-05: Completion rate should express
   *  the whole-project share, not just "of what was planned today." */
  totalMilestonesWhole: number;
  /** Milestones closed anywhere in the project (actualFinish set),
   *  irrespective of whether baseline was reached. */
  closedMilestonesWhole: number;
  /** Worst villa's cumulative slip across any single milestone, in days.
   *  Treated as a critical-path proxy: projects don't "catch up" from
   *  historical slippage, so the villa with the largest slip anchors the
   *  earliest honest projected handover date. 0 when no villa has slipped.
   *  Vandana 2026-11-05 management review. */
  worstVillaSlipDays: number;
  /** Human label for the worst villa ("Block 10 · Villa 34"). Empty when
   *  no villa has slipped. */
  worstVillaLabel: string;
  /** The worst villa's baseline handover date (last milestone by
   *  orderIndex, baselineFinish). ISO string, or empty when unknown. */
  worstVillaBaselineHandover: string;
  /** Baseline handover shifted forward by worstVillaSlipDays - the honest
   *  "at today's pace" handover date. ISO string, or empty when unknown. */
  worstVillaProjectedHandover: string;
  /** Project-level baseline handover = latest baselineFinish across every
   *  villa's handover milestone. The planned project finish date. */
  projectBaselineHandover: string;
  /** Project-level projected handover = max across all villas of
   *  (that villa's baseline handover + that villa's max observed slip).
   *  Answers "when will the last villa actually finish?". ISO string. */
  projectProjectedHandover: string;
  /** Project-level delay in days: projectProjectedHandover -
   *  projectBaselineHandover. 0 = the critical-path villa still finishes
   *  on time even if others slipped inside the window. */
  projectSlipDays: number;
  /** Label of the villa currently setting the project handover date (the
   *  latest projected finisher). Empty if no villa data. */
  projectDriverLabel: string;
}

export async function getProgressHeroStats(
  projectId: string,
  asOf: Date = new Date(),
): Promise<ProgressHeroStats> {
  const [dueByToday, closedByToday, overdue, closedRows, totalMilestonesWhole, closedMilestonesWhole, slipRows, handoverBaselines] = await Promise.all([
    prisma.villaMilestone.count({
      where: { villa: { projectId, inScope: true }, baselineFinish: { lte: asOf } },
    }),
    prisma.villaMilestone.count({
      where: {
        villa: { projectId, inScope: true },
        baselineFinish: { lte: asOf },
        actualFinish: { not: null },
      },
    }),
    prisma.villaMilestone.findMany({
      where: {
        villa: { projectId, inScope: true },
        baselineFinish: { lte: asOf },
        actualFinish: null,
      },
      select: { baselineFinish: true },
    }),
    // Every closed milestone - need both the baseline and the actualFinish
    // to compute the ahead-or-behind day diff per row.
    prisma.villaMilestone.findMany({
      where: {
        villa: { projectId, inScope: true },
        actualFinish: { not: null },
      },
      select: { baselineFinish: true, actualFinish: true },
    }),
    // Whole-project denominators (every milestone across every in-scope
    // villa + every section) so the hero's completion rate is a true
    // "% of project done to date", not just "of what was planned today".
    prisma.villaMilestone.count({ where: { villa: { projectId, inScope: true } } }),
    prisma.villaMilestone.count({ where: { villa: { projectId, inScope: true }, actualFinish: { not: null } } }),
    // Every milestone with its villa + baseline/actual - enables the
    // per-villa worst-slip calc for the "At today's pace" projection.
    prisma.villaMilestone.findMany({
      where: { villa: { projectId, inScope: true } },
      select: {
        baselineFinish: true,
        actualFinish: true,
        villa: {
          select: {
            id: true, number: true, label: true,
            block: { select: { code: true } },
          },
        },
      },
    }),
    // Per-villa baseline handover = latest baselineFinish across that
    // villa's milestones (section with max orderIndex is the handover,
    // but using max(baselineFinish) is equivalent and simpler).
    prisma.villaMilestone.groupBy({
      by: ["villaId"],
      where: { villa: { projectId, inScope: true } },
      _max: { baselineFinish: true },
    }),
  ]);

  // Behind side: open past-due milestones. Each contributes (today - baseline).
  let behindDaysSum = 0;
  let maxDays = 0;
  for (const m of overdue) {
    if (!m.baselineFinish) continue;
    const d = Math.max(0, Math.round((asOf.getTime() - m.baselineFinish.getTime()) / 86400000));
    behindDaysSum += d;
    if (d > maxDays) maxDays = d;
  }
  const meanDaysBehind = overdue.length === 0 ? 0 : Math.round(behindDaysSum / overdue.length);

  // Ahead side: closed milestones whose actualFinish beat the baseline.
  // Rows where actualFinish is AFTER baselineFinish (closed-but-late) also
  // belong on the behind side of the net, so we fold them in there.
  let aheadDaysSum = 0;
  let aheadCount = 0;
  let closedLateDaysSum = 0;
  let closedLateCount = 0;
  for (const m of closedRows) {
    if (!m.baselineFinish || !m.actualFinish) continue;
    const diffDays = Math.round((m.actualFinish.getTime() - m.baselineFinish.getTime()) / 86400000);
    if (diffDays < 0) {
      aheadDaysSum += -diffDays; // store ahead as positive magnitude
      aheadCount++;
    } else if (diffDays > 0) {
      closedLateDaysSum += diffDays;
      closedLateCount++;
    }
  }
  const meanDaysAhead = aheadCount === 0 ? 0 : Math.round(aheadDaysSum / aheadCount);

  // Net variance = (all behind days - all ahead days) / (behind + ahead).
  // "Behind" here means open-past-due AND closed-but-late (both are slippage).
  const totalBehindDays = behindDaysSum + closedLateDaysSum;
  const totalBehindCount = overdue.length + closedLateCount;
  const evaluatedCount = totalBehindCount + aheadCount;
  const netDaysVariance = evaluatedCount === 0
    ? 0
    : Math.round((totalBehindDays - aheadDaysSum) / evaluatedCount);

  // Worst-villa projection (Vandana 2026-11-05 management review): for
  // each villa, find the biggest cumulative slip across any single
  // milestone - open past-due (today - baselineFinish) or closed-late
  // (actualFinish - baselineFinish). The villa with the largest such
  // number anchors the honest "at today's pace" handover: baseline
  // handover date + max slip.
  type VillaSlipRow = { number: number | null; label: string | null; blockCode: string | null; slip: number };
  const villaMaxSlip = new Map<string, VillaSlipRow>();
  for (const m of slipRows) {
    if (!m.baselineFinish || !m.villa) continue;
    let slip = 0;
    if (!m.actualFinish) {
      slip = Math.max(0, Math.round((asOf.getTime() - m.baselineFinish.getTime()) / 86_400_000));
    } else {
      slip = Math.max(0, Math.round((m.actualFinish.getTime() - m.baselineFinish.getTime()) / 86_400_000));
    }
    const current = villaMaxSlip.get(m.villa.id);
    if (!current || slip > current.slip) {
      villaMaxSlip.set(m.villa.id, {
        number: m.villa.number ?? null,
        label: m.villa.label ?? null,
        blockCode: m.villa.block?.code ?? null,
        slip,
      });
    }
  }

  let worstVillaId: string = "";
  let worstVilla: VillaSlipRow | null = null;
  for (const [id, row] of villaMaxSlip) {
    if (!worstVilla || row.slip > worstVilla.slip) {
      worstVilla = row;
      worstVillaId = id;
    }
  }

  const worstVillaSlipDays = worstVilla?.slip ?? 0;
  const worstVillaLabel = worstVilla
    ? `${worstVilla.blockCode ? `Block ${worstVilla.blockCode} · ` : ""}${worstVilla.label ?? (worstVilla.number ? `Villa ${worstVilla.number}` : "Villa")}`
    : "";
  const worstHandoverRow = worstVillaId
    ? handoverBaselines.find((r) => r.villaId === worstVillaId)
    : undefined;
  const worstBaseline = worstHandoverRow?._max.baselineFinish ?? null;
  const worstBaselineIso = worstBaseline ? worstBaseline.toISOString() : "";
  const worstProjectedIso = worstBaseline
    ? new Date(worstBaseline.getTime() + worstVillaSlipDays * 86_400_000).toISOString()
    : "";

  // Project-level handover (Vandana 2026-11-05): the project finishes
  // when the LAST villa hands over. Compute each villa's projected
  // handover = that villa's baseline handover + its max slip to date;
  // project handover = max across all villas. A villa with huge slip
  // doesn't push the project if its projected date is still inside the
  // critical-path window.
  let latestBaselineMs = 0;
  let latestProjectedMs = 0;
  let projectDriverId = "";
  for (const h of handoverBaselines) {
    const baseline = h._max.baselineFinish;
    if (!baseline) continue;
    const villaSlip = villaMaxSlip.get(h.villaId)?.slip ?? 0;
    const baselineMs = baseline.getTime();
    const projectedMs = baselineMs + villaSlip * 86_400_000;
    if (baselineMs > latestBaselineMs) latestBaselineMs = baselineMs;
    if (projectedMs > latestProjectedMs) {
      latestProjectedMs = projectedMs;
      projectDriverId = h.villaId;
    }
  }
  const driverRow = projectDriverId ? villaMaxSlip.get(projectDriverId) : undefined;
  const projectDriverLabel = driverRow
    ? `${driverRow.blockCode ? `Block ${driverRow.blockCode} · ` : ""}${driverRow.label ?? (driverRow.number ? `Villa ${driverRow.number}` : "Villa")}`
    : "";
  const projectBaselineIso = latestBaselineMs > 0 ? new Date(latestBaselineMs).toISOString() : "";
  const projectProjectedIso = latestProjectedMs > 0 ? new Date(latestProjectedMs).toISOString() : "";
  const projectSlipDays = latestBaselineMs > 0 && latestProjectedMs > 0
    ? Math.max(0, Math.round((latestProjectedMs - latestBaselineMs) / 86_400_000))
    : 0;

  return {
    dueByToday,
    closedByToday,
    openPastDue: overdue.length,
    meanDaysBehind,
    maxDaysBehind: maxDays,
    aheadCount,
    meanDaysAhead,
    netDaysVariance,
    evaluatedCount,
    totalMilestonesWhole,
    closedMilestonesWhole,
    worstVillaSlipDays,
    worstVillaLabel,
    worstVillaBaselineHandover: worstBaselineIso,
    worstVillaProjectedHandover: worstProjectedIso,
    projectBaselineHandover: projectBaselineIso,
    projectProjectedHandover: projectProjectedIso,
    projectSlipDays,
    projectDriverLabel,
  };
}

// ---------------------------------------------------------------------------
// §1 — planned vs actual per milestone section
// ---------------------------------------------------------------------------

export interface SectionProgressRow {
  code: string;
  name: string;
  orderIndex: number;
  totalVillas: number;
  plannedPct: number;   // % of villas that SHOULD have completed this milestone by asOf
  actualPct: number;    // % that HAVE completed
  variancePct: number;  // actual − planned
  /** Tasks under this section bucketed for the drill-down. Each villa
   *  milestone contributes one entry; the bucket depends on its baseline
   *  / actual / today relationship. Vandana 2026-11-04 management
   *  review: clicking a section row expands this so management sees the
   *  specific villas driving the variance. */
  tasks: {
    /** Open and past baseline - current slippage. */
    delayedOpen: Array<SectionTaskRow>;
    /** Closed AFTER baseline - we did it, just late. */
    closedLate: Array<SectionTaskRow>;
    /** Closed BEFORE baseline - done ahead of plan. */
    closedEarly: Array<SectionTaskRow>;
    /** Closed with actualFinish set but baseline was NOT yet past. In
     *  other words: completed off-plan (the "not planned but done" bucket
     *  Vandana asked about). */
    closedOffPlan: Array<SectionTaskRow>;
  };
}

export interface SectionTaskRow {
  villaNumber: number;
  villaLabel: string;
  blockCode: string;
  baselineFinish: string | null; // ISO
  actualFinish: string | null;   // ISO
  daysDiff: number;              // +days late, -days early, 0 if neither applies
}

export async function getSectionProgress(
  projectId: string,
  asOf: Date = new Date(),
): Promise<SectionProgressRow[]> {
  const sections = await prisma.milestoneSection.findMany({
    where: { projectId },
    orderBy: { orderIndex: "asc" },
    select: { id: true, code: true, name: true, orderIndex: true },
  });

  // One wide fetch instead of 3 counts per section - cheaper, and we need
  // the villa+block context anyway for the drill-down tasks list below.
  const sectionIds = sections.map((s) => s.id);
  const allMilestones = await prisma.villaMilestone.findMany({
    where: {
      sectionId: { in: sectionIds },
      villa: { projectId, inScope: true },
    },
    select: {
      sectionId: true,
      baselineFinish: true,
      actualFinish: true,
      villa: {
        select: {
          number: true, label: true,
          block: { select: { code: true } },
        },
      },
    },
  });

  const bySection = new Map<string, typeof allMilestones>();
  for (const m of allMilestones) {
    const arr = bySection.get(m.sectionId) ?? [];
    arr.push(m);
    bySection.set(m.sectionId, arr);
  }

  const rows: SectionProgressRow[] = [];
  for (const section of sections) {
    const mine = bySection.get(section.id) ?? [];
    const total = mine.length;
    let planned = 0;
    let actual = 0;
    const delayedOpen: SectionTaskRow[] = [];
    const closedLate: SectionTaskRow[] = [];
    const closedEarly: SectionTaskRow[] = [];
    const closedOffPlan: SectionTaskRow[] = [];

    for (const m of mine) {
      const baseline = m.baselineFinish;
      const actualF = m.actualFinish;
      const baselinePast = !!baseline && baseline <= asOf;
      const closed = !!actualF && actualF <= asOf;
      if (baselinePast) planned++;
      if (closed) actual++;

      const row: SectionTaskRow = {
        villaNumber: m.villa?.number ?? 0,
        villaLabel: m.villa?.label ?? (m.villa?.number ? `Villa ${m.villa.number}` : "Villa"),
        blockCode: m.villa?.block?.code ?? "-",
        baselineFinish: baseline?.toISOString() ?? null,
        actualFinish: actualF?.toISOString() ?? null,
        daysDiff: baseline && actualF
          ? Math.round((actualF.getTime() - baseline.getTime()) / 86400000)
          : baseline && !actualF && baselinePast
            ? Math.round((asOf.getTime() - baseline.getTime()) / 86400000)
            : 0,
      };

      if (closed && baseline) {
        if (actualF! < baseline) {
          if (baselinePast) {
            closedEarly.push(row); // done early AND baseline already passed - the usual "early"
          } else {
            closedOffPlan.push(row); // baseline not yet due but we did it anyway
          }
        } else if (actualF! > baseline) {
          closedLate.push(row);
        } else {
          // exactly on baseline - count as closedEarly (a win)
          closedEarly.push(row);
        }
      } else if (baselinePast && !closed) {
        delayedOpen.push(row);
      }
      // (not past baseline AND not closed = normal in-progress, no bucket)
    }

    // Sort each bucket worst-first for delayed, best-first for ahead.
    delayedOpen.sort((a, b) => b.daysDiff - a.daysDiff);
    closedLate.sort((a, b) => b.daysDiff - a.daysDiff);
    closedEarly.sort((a, b) => a.daysDiff - b.daysDiff);
    closedOffPlan.sort((a, b) => a.daysDiff - b.daysDiff);

    const plannedPct = total > 0 ? Math.round((planned / total) * 10000) / 100 : 0;
    const actualPct = total > 0 ? Math.round((actual / total) * 10000) / 100 : 0;
    rows.push({
      code: section.code,
      name: section.name,
      orderIndex: section.orderIndex,
      totalVillas: total,
      plannedPct,
      actualPct,
      variancePct: Math.round((actualPct - plannedPct) * 100) / 100,
      tasks: { delayedOpen, closedLate, closedEarly, closedOffPlan },
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// §2 — villa-wise physical progress
// ---------------------------------------------------------------------------

export interface VillaProgressRow {
  villaId: string;
  villaNumber: number;
  villaLabel: string;
  villaType: string | null;
  blockCode: string;
  currentSectionName: string | null;
  currentSectionOrder: number | null;
  pctComplete: number;         // rolled up: average pctComplete across started milestones
  slipDays: number;            // max positive gap between projectedFinish and baselineFinish across sections
  status: "healthy" | "warning" | "critical" | "not-started";
  totalSections: number;
  closedSections: number;
}

export async function getVillaProgressRows(
  projectId: string,
): Promise<VillaProgressRow[]> {
  const villas = await prisma.villa.findMany({
    where: { projectId, inScope: true },
    orderBy: [{ block: { orderIndex: "asc" } }, { number: "asc" }],
    select: {
      id: true,
      number: true,
      label: true,
      villaType: true,
      block: { select: { code: true } },
      milestones: {
        select: {
          baselineFinish: true,
          actualStart: true,
          actualFinish: true,
          projectedFinish: true,
          pctComplete: true,
          section: { select: { name: true, orderIndex: true } },
        },
      },
    },
  });

  return villas.map((v) => {
    let closedSections = 0;
    let startedSections = 0;
    let pctSum = 0;
    let maxSlip = 0;
    let currentSectionName: string | null = null;
    let currentSectionOrder: number | null = null;

    // Sort milestones by section orderIndex so "current" = earliest not-yet-closed.
    const ordered = [...v.milestones].sort((a, b) => (a.section?.orderIndex ?? 0) - (b.section?.orderIndex ?? 0));

    for (const m of ordered) {
      if (m.actualFinish) {
        closedSections++;
      }
      if (m.actualStart) {
        startedSections++;
        pctSum += m.pctComplete ?? (m.actualFinish ? 100 : 0);
      }
      if (m.baselineFinish && m.projectedFinish) {
        const slip = Math.round((m.projectedFinish.getTime() - m.baselineFinish.getTime()) / 86400000);
        if (slip > maxSlip) maxSlip = slip;
      }
      // First not-closed section = current
      if (!currentSectionName && !m.actualFinish && m.section) {
        currentSectionName = m.section.name;
        currentSectionOrder = m.section.orderIndex;
      }
    }

    const pctComplete = startedSections > 0
      ? Math.round(pctSum / startedSections)
      : 0;
    const status: VillaProgressRow["status"] =
      startedSections === 0
        ? "not-started"
        : maxSlip > 30
        ? "critical"
        : maxSlip > 7
        ? "warning"
        : "healthy";

    return {
      villaId: v.id,
      villaNumber: v.number,
      villaLabel: v.label ?? `Villa ${v.number}`,
      villaType: v.villaType,
      blockCode: v.block.code,
      currentSectionName,
      currentSectionOrder,
      pctComplete,
      slipDays: maxSlip,
      status,
      totalSections: v.milestones.length,
      closedSections,
    };
  });
}

// ---------------------------------------------------------------------------
// §3 — interactive drawing data
// ---------------------------------------------------------------------------

export type VillaSectionStatus = "completed" | "ongoing" | "delayed" | "not-started";

export interface VillaSectionCell {
  villaNumber: number;
  villaLabel: string;
  blockCode: string;
  status: VillaSectionStatus;
  slipDays: number;
}

export interface SectionFilterOption {
  code: string;
  name: string;
  orderIndex: number;
}

export interface InteractiveDrawingData {
  masterPlanUrl: string | null;
  sections: SectionFilterOption[];
  /** villaId → array of one cell per section (parallel-indexed to `sections`). */
  villas: Array<{
    villaId: string;
    villaNumber: number;
    villaLabel: string;
    blockCode: string;
    cells: VillaSectionCell[];
  }>;
}

/**
 * Bundle everything the client-side Interactive Drawing needs so the section
 * filter toggle doesn't need a round-trip — client renders the same data
 * with a different lens.
 */
export async function getInteractiveDrawingData(
  projectId: string,
  asOf: Date = new Date(),
): Promise<InteractiveDrawingData> {
  const [project, sections, villas] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { masterPlanUrl: true },
    }),
    prisma.milestoneSection.findMany({
      where: { projectId },
      orderBy: { orderIndex: "asc" },
      select: { id: true, code: true, name: true, orderIndex: true },
    }),
    prisma.villa.findMany({
      where: { projectId, inScope: true },
      orderBy: [{ block: { orderIndex: "asc" } }, { number: "asc" }],
      select: {
        id: true,
        number: true,
        label: true,
        block: { select: { code: true } },
        milestones: {
          select: {
            sectionId: true,
            baselineStart: true,
            baselineFinish: true,
            actualStart: true,
            actualFinish: true,
            projectedFinish: true,
          },
        },
      },
    }),
  ]);

  const sectionList: SectionFilterOption[] = sections.map((s) => ({
    code: s.code,
    name: s.name,
    orderIndex: s.orderIndex,
  }));

  const sectionOrder = new Map(sections.map((s, i) => [s.id, i]));

  const villaRows: InteractiveDrawingData["villas"] = villas.map((v) => {
    const cells: VillaSectionCell[] = sections.map((s) => {
      const m = v.milestones.find((x) => x.sectionId === s.id);
      const label = v.label ?? `Villa ${v.number}`;
      if (!m) {
        return {
          villaNumber: v.number,
          villaLabel: label,
          blockCode: v.block.code,
          status: "not-started",
          slipDays: 0,
        };
      }
      const status = classifyStatus(m, asOf);
      const slipDays = m.baselineFinish && m.projectedFinish
        ? Math.max(0, Math.round((m.projectedFinish.getTime() - m.baselineFinish.getTime()) / 86400000))
        : 0;
      return {
        villaNumber: v.number,
        villaLabel: label,
        blockCode: v.block.code,
        status,
        slipDays,
      };
    });

    // cells were already built in section order — no explicit sort needed.
    void sectionOrder; // kept for future per-section indexing on the client

    return {
      villaId: v.id,
      villaNumber: v.number,
      villaLabel: v.label ?? `Villa ${v.number}`,
      blockCode: v.block.code,
      cells,
    };
  });

  return {
    masterPlanUrl: project?.masterPlanUrl ?? null,
    sections: sectionList,
    villas: villaRows,
  };
}

function classifyStatus(
  m: {
    baselineStart: Date | null;
    baselineFinish: Date | null;
    actualStart: Date | null;
    actualFinish: Date | null;
    projectedFinish: Date | null;
  },
  asOf: Date,
): VillaSectionStatus {
  if (m.actualFinish) return "completed";
  if (m.actualStart) return "ongoing";
  // Should have started by now but hasn't → delayed
  if (m.baselineStart && m.baselineStart <= asOf) return "delayed";
  return "not-started";
}
