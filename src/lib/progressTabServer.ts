// Aggregations that power the Progress top tab:
//   §1 Planned vs Actual — per milestone-section, planned vs actual completion.
//   §2 Villa-wise physical progress — one row per villa with status + slip.
//   §3 Interactive drawing data — per-section villa status (Completed /
//      Ongoing / Delayed / Not started) so the drawing can filter and colour.
//
// All server-only; UI components take these shapes and stay Prisma-free.

import { prisma } from "@/lib/prisma";

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

  const rows: SectionProgressRow[] = [];
  for (const section of sections) {
    const [total, planned, actual] = await Promise.all([
      prisma.villaMilestone.count({ where: { sectionId: section.id } }),
      prisma.villaMilestone.count({
        where: { sectionId: section.id, baselineFinish: { lte: asOf } },
      }),
      prisma.villaMilestone.count({
        where: { sectionId: section.id, actualFinish: { not: null, lte: asOf } },
      }),
    ]);
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
