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

import type { DashboardBag, MatrixRow } from "@/lib/rollupServer";
import type { BlockRollup as ClientBlock, VillaRollup as ClientVilla, ContractorRollup, MilestoneCell, ProjectHealthSummary } from "@/lib/executiveMockData";

export interface AdaptedOverview {
  health: ProjectHealthSummary;
  villas: ClientVilla[];
  blocks: ClientBlock[];
  contractors: ContractorRollup[];
  sections: string[];
}

/** Fold a DashboardBag into the shape ExecutiveOverview / ExecutiveLayout expect. */
export function adaptDashboardBag(bag: DashboardBag): AdaptedOverview {
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

  // Contractor rollup: for v1 we only track one contractor (A&T). Real
  // per-contractor breakdown lives in a follow-up (needs Contractor↔Villa
  // ownership modeling).
  const activeBlocks = rollup.blocks.filter((b) => b.villas.some((v) => v.currentSection >= 0));
  const activeVillas = activeBlocks.flatMap((b) => b.villas.filter((v) => v.currentSection >= 0));
  const totalVillas = rollup.blocks.reduce((n, b) => n + b.villas.length, 0);
  const avgSlip = activeVillas.length === 0
    ? 0
    : Math.round(activeVillas.reduce((s, v) => s + v.handoverSlipDays, 0) / activeVillas.length);
  const contractors: ContractorRollup[] = [
    {
      name: "Abraham Thomas (A&T)",
      category: "Civil / Structural — Phase 1 & 2 Lead",
      scopeVillas: totalVillas,
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
  const health: ProjectHealthSummary = {
    totalPlots: totalVillas,
    inScope: totalVillas,
    modelVillas: 0,
    phase1Villas: activeVillas.length,
    phase1BlocksActive: activeBlocks.length,
    atVillas: totalVillas,
    atBlocks: rollup.blocks.length,
    baselineStart: project.startDate ?? new Date(),
    baselineEnd: project.endDate ?? new Date(),
    projectedEnd: rollup.projectedEnd ?? project.projectedEndDate ?? project.endDate ?? new Date(),
    totalDelayDays: rollup.handoverSlipDays,
    reraDelayDays: computeReraDelay(project.reraEndDate, rollup.projectedEnd),
    hindrances: 0,                              // TODO: query Hindrance table
    criticalBlocks: rollup.criticalBlocks,
    probability: probabilityBand(project.reraEndDate, rollup.projectedEnd),
    plannedPct: 0,                              // TODO: compute from tasks (needs Task-level query)
    achievedPct: Math.round(rollup.percentComplete * 100) / 100,
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
