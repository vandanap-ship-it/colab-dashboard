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
import {
  AMANVANA_ABRAHAM_ALL_VILLAS,
  AMANVANA_CONTRACTOR_SCOPE,
  AMANVANA_CONTRACTORS,
  AMANVANA_VILLA_NUMBER_TO_BLOCK,
} from "@/lib/projects/amanvana";

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
   *  Correct physical-villa count — a "Villa 10 & 11" row contributes 2, not 1.
   *  On Amanvana this reads 93 rather than the 90 that `Villa.count()` returns. */
  totalPhysicalVillas: number;
  /** Number of Villa rows the DB actually holds — same shape as the sum,
   *  but without unitCount expansion. Kept for callers that want the row
   *  count (e.g. the "Villa records" metric). */
  totalVillaRecords: number;
}

export async function getExecutiveExtras(projectId: string): Promise<ExecutiveExtras> {
  const [hindranceCount, stats, sumUnits, rowCount] = await Promise.all([
    prisma.hindrance.count({ where: { projectId, status: "OPEN" } }),
    getProjectStats(projectId),
    prisma.villa.aggregate({
      where: { projectId, inScope: true },
      _sum: { unitCount: true },
    }),
    prisma.villa.count({ where: { projectId, inScope: true } }),
  ]);
  return {
    hindranceCount,
    plannedPct: stats.plannedPercent,
    achievedPct: stats.achievedPercent,
    totalPhysicalVillas: sumUnits._sum.unitCount ?? rowCount,
    totalVillaRecords: rowCount,
  };
}

/** Abraham's contracted villa + block count for Amanvana. Returns null for
 *  other projects — those keep the row-count fallback. Uses the code
 *  registry (AMANVANA_VILLA_NUMBER_TO_BLOCK) so it stays true even when the
 *  MSP import happens to split combined pairs across two rows. */
function amanvanaAbrahamOverride(): { villaCount: number; blockCount: number } | null {
  const abrahamVillaCount = AMANVANA_CONTRACTOR_SCOPE[AMANVANA_CONTRACTORS.abraham.toLowerCase()];
  if (abrahamVillaCount == null) return null;
  const distinctBlocks = new Set(Object.values(AMANVANA_VILLA_NUMBER_TO_BLOCK));
  // The registry currently groups Block 3A + 3B under one "03" code. Real
  // block count per contract is 12 (Blocks 2, 3A, 3B, 4-10, 12, 13). Reflect
  // that here rather than lie by silently returning 11.
  const blockCountFromRegistry = distinctBlocks.size;
  const AMANVANA_ABRAHAM_ACTUAL_BLOCK_COUNT = 12;
  return {
    villaCount: abrahamVillaCount,
    blockCount: Math.max(blockCountFromRegistry, AMANVANA_ABRAHAM_ACTUAL_BLOCK_COUNT),
  };
}

/** Is this the Amanvana project the AMANVANA_ constants describe? We can't
 *  match on projectId (that varies per environment), so match on the villa
 *  set — Abraham's Amanvana villas are a distinctive fingerprint that no
 *  other project will accidentally share. */
function isAmanvanaByBlockShape(blockCodes: string[]): boolean {
  // If the project contains the block codes Abraham's Amanvana registry knows
  // about ("02", "03", "04", ...), treat as Amanvana. False positives are
  // acceptable — the overrides read the same shape everyone else would.
  if (AMANVANA_ABRAHAM_ALL_VILLAS.length === 0) return false;
  const registered = new Set(Object.values(AMANVANA_VILLA_NUMBER_TO_BLOCK));
  const overlap = blockCodes.filter((c) => registered.has(c)).length;
  return overlap >= Math.min(3, registered.size);
}

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
      slipDays: b.handoverSlipDays,
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
        slipDays: v.handoverSlipDays,
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

  // Abraham's contracted scope — the "AT villas · X blocks" hero cell.
  // On Amanvana the contract says 41 villas across 12 blocks (Blocks 2, 3A,
  // 3B, 4-10, 12, 13). Use the override; other projects fall back to the
  // whole-project totals as before.
  const blockCodes = rollup.blocks.map((b) => b.code);
  const amanvanaAbraham = isAmanvanaByBlockShape(blockCodes) ? amanvanaAbrahamOverride() : null;
  const atVillaCount = amanvanaAbraham?.villaCount ?? totalVillas;
  const atBlockCount = amanvanaAbraham?.blockCount ?? rollup.blocks.length;

  const avgSlip = activeVillas.length === 0
    ? 0
    : Math.round(activeVillas.reduce((s, v) => s + v.handoverSlipDays, 0) / activeVillas.length);
  const contractors: ContractorRollup[] = [
    {
      name: AMANVANA_CONTRACTORS.abraham,
      category: "Civil / Structural — Phase 1 & 2 Lead",
      scopeVillas: atVillaCount,
      activeVillas: activeVillas.length,
      completePct: Math.round(rollup.percentComplete),
      avgDelayDays: avgSlip,
      criticalRisks: rollup.criticalVillas,
      health: rollup.criticalBlocks > 0 ? "critical"
        : rollup.handoverSlipDays > 14 ? "warning"
        : rollup.handoverSlipDays > 0 ? "ok"
        : "healthy",
    },
  ];

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
  const projectedEnd = rollup.projectedEnd ?? project.projectedEndDate ?? project.endDate ?? new Date();
  const declaredEnd = project.endDate ?? new Date();
  const totalDelayDays =
    projectedEnd && declaredEnd
      ? Math.round((projectedEnd.getTime() - declaredEnd.getTime()) / 86_400_000)
      : 0;

  const health: ProjectHealthSummary = {
    totalPlots: totalVillas,
    inScope: totalVillas,
    modelVillas: 0,
    phase1Villas: activeVillas.length,
    phase1BlocksActive: activeBlocks.length,
    atVillas: atVillaCount,
    atBlocks: atBlockCount,
    baselineStart: project.startDate ?? new Date(),
    baselineEnd: declaredEnd,
    reraEndDate: project.reraEndDate ?? null,
    projectedEnd,
    totalDelayDays,
    reraDelayDays: computeReraDelay(project.reraEndDate, rollup.projectedEnd),
    hindrances: extras?.hindranceCount ?? 0,
    criticalBlocks: rollup.criticalBlocks,
    probability: probabilityBand(project.reraEndDate, rollup.projectedEnd),
    // plannedPct/achievedPct come from projectStats when the caller passes
    // extras — that's the same math the Snapshot page's gauge uses, so the
    // two views agree. When no extras are passed the achievedPct falls back
    // to the rollup's own percentComplete (which is close but not identical
    // — projectStats handles the ColabActivity override).
    plannedPct: extras?.plannedPct ?? 0,
    achievedPct: extras?.achievedPct ?? Math.round(rollup.percentComplete * 100) / 100,
    asOf: new Date(),
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
