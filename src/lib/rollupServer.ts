// ---------------------------------------------------------------------------
// Server-side query layer for the executive rollup.
//
// Reads the persisted Block / Villa / MilestoneSection / VillaMilestone /
// WBSNode graph out of Prisma and shapes it into the plain-data inputs the
// pure `rollup.ts` math expects. Executive dashboard components call these
// server-only helpers (server components / route handlers) — never the
// browser.
//
// This module is defensive-by-design because it feeds live executive metrics:
//   • empty projects return well-formed empty rollups (no crash)
//   • orphan WBS nodes (missing villaMilestoneId) are skipped, not fatal
//   • one bad villa doesn't tank the whole block
// ---------------------------------------------------------------------------

import "server-only";

import { prisma } from "@/lib/prisma";
import {
  rollupBlock,
  rollupMilestone,
  rollupProject,
  rollupVilla,
  type BlockRollup,
  type ProjectRollup,
  type Task,
  type VillaRollup,
} from "@/lib/rollup";

// ---------------------------------------------------------------------------
// Small typed row shapes we pull from Prisma. We fetch the minimum needed
// columns to keep the query cheap even at 8000+ WBSNodes.
// ---------------------------------------------------------------------------

interface WbsRow {
  id: string;
  villaMilestoneId: string | null;
  isSubMilestone: boolean;
  baselineStart: Date | null;
  baselineFinish: Date | null;
  actualStart: Date | null;
  actualFinish: Date | null;
  projectedFinish: Date | null;
  percentComplete: number;
}

/** Estimate duration in days between two dates, min 1 to avoid divide-by-zero. */
function durationDaysBetween(start: Date | null, finish: Date | null): number {
  if (!start || !finish) return 1;
  const ms = finish.getTime() - start.getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

function toTask(row: WbsRow): Task {
  return {
    id: row.id,
    isSubMilestone: row.isSubMilestone,
    baselineStart: row.baselineStart,
    baselineFinish: row.baselineFinish,
    actualStart: row.actualStart,
    actualFinish: row.actualFinish,
    projectedFinish: row.projectedFinish,
    percentComplete: row.percentComplete,
    durationDays: durationDaysBetween(row.baselineStart, row.baselineFinish),
  };
}

// ---------------------------------------------------------------------------
// Project-wide rollup
// ---------------------------------------------------------------------------

/**
 * Fetch the entire executive rollup for a project in one shot.
 *
 * One project-wide query batches the reads so we stay under Neon's serverless
 * connection budget even when the browser loads the executive dashboard.
 *
 * Returns null if the project has no Block/Villa data ingested yet — caller
 * should render the placeholder-data view in that case (or the "import
 * schedule" empty state).
 */
export async function getProjectRollup(projectId: string): Promise<ProjectRollup | null> {
  const [blocks, sections, villaMilestones, wbsNodes] = await Promise.all([
    prisma.block.findMany({
      where: { projectId },
      orderBy: { orderIndex: "asc" },
      select: { id: true, code: true, name: true },
    }),
    prisma.milestoneSection.findMany({
      where: { projectId },
      orderBy: { orderIndex: "asc" },
      select: { id: true, code: true, name: true, orderIndex: true },
    }),
    prisma.villaMilestone.findMany({
      where: { villa: { projectId } },
      select: {
        id: true, villaId: true, sectionId: true,
        villa: { select: { id: true, number: true, blockId: true } },
      },
    }),
    prisma.wBSNode.findMany({
      where: { projectId, villaMilestoneId: { not: null } },
      select: {
        id: true, villaMilestoneId: true, isSubMilestone: true,
        baselineStart: true, baselineFinish: true,
        actualStart: true, actualFinish: true, projectedFinish: true,
        percentComplete: true,
      },
    }),
  ]);

  if (blocks.length === 0) return null;

  // Index WBSNodes by villaMilestoneId for fast per-milestone lookup.
  const tasksByVM = new Map<string, WbsRow[]>();
  for (const w of wbsNodes) {
    if (!w.villaMilestoneId) continue;
    const arr = tasksByVM.get(w.villaMilestoneId) ?? [];
    arr.push(w);
    tasksByVM.set(w.villaMilestoneId, arr);
  }

  // Index sections by id for order lookup.
  const sectionOrder = new Map<string, { name: string; order: number }>();
  for (const s of sections) sectionOrder.set(s.id, { name: s.name, order: s.orderIndex });

  // Villa rollups: for each villa, walk its milestones in section-order and roll up.
  const villaById = new Map<string, VillaRollup>();
  const villaIdsByBlock = new Map<string, string[]>();

  // Group VillaMilestones by villaId.
  const vmByVilla = new Map<string, typeof villaMilestones>();
  for (const vm of villaMilestones) {
    const arr = vmByVilla.get(vm.villaId) ?? [];
    arr.push(vm);
    vmByVilla.set(vm.villaId, arr);
  }

  for (const [villaId, vms] of vmByVilla) {
    const firstVm = vms[0];
    if (!firstVm) continue;
    const milestones = vms
      .map((vm) => {
        const sec = sectionOrder.get(vm.sectionId);
        if (!sec) return null;
        const tasks = (tasksByVM.get(vm.id) ?? []).map(toTask);
        return rollupMilestone(sec.name, sec.order, tasks);
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => a.order - b.order);

    // Locate the block code for this villa.
    const blockId = firstVm.villa.blockId;
    const block = blocks.find((b) => b.id === blockId);
    if (!block) continue;

    const villa = rollupVilla(firstVm.villa.number, block.code, milestones);
    villaById.set(villaId, villa);
    const arr = villaIdsByBlock.get(blockId) ?? [];
    arr.push(villaId);
    villaIdsByBlock.set(blockId, arr);
  }

  // Block rollups.
  const blockRollups: BlockRollup[] = blocks.map((b) => {
    const villaIds = villaIdsByBlock.get(b.id) ?? [];
    const villas = villaIds.map((vid) => villaById.get(vid)).filter((v): v is VillaRollup => !!v);
    return rollupBlock(b.code, villas);
  });

  return rollupProject(blockRollups);
}

// ---------------------------------------------------------------------------
// Milestone Matrix rows — flattened for the pivot table UI
// ---------------------------------------------------------------------------

export interface MatrixRow {
  villaId: string;
  villaNumber: number;
  villaLabel: string;      // "Villa 12" or "Villa 10 & 11"
  blockCode: string;
  cellsBySection: Map<string, {
    sectionCode: string;
    sectionName: string;
    baselineStart: Date | null;
    baselineFinish: Date | null;
    actualStart: Date | null;
    actualFinish: Date | null;
    projectedFinish: Date | null;
    pctComplete: number;
    crmDate: Date | null;
    crmDelay: number | null;
    plannedCollection: number | null;
  }>;
}

/**
 * Flattened matrix rows for the Snapshot page's Milestone Matrix pivot.
 * Villas ordered by (block orderIndex, villa number). CRM columns included.
 */
export async function getMilestoneMatrix(projectId: string): Promise<MatrixRow[]> {
  const rows = await prisma.villaMilestone.findMany({
    where: { villa: { projectId } },
    select: {
      villaId: true, sectionId: true,
      baselineStart: true, baselineFinish: true,
      actualStart: true, actualFinish: true, projectedFinish: true,
      pctComplete: true,
      crmDate: true, crmDelay: true, plannedCollection: true,
      villa: {
        select: {
          id: true, number: true, label: true,
          block: { select: { code: true, orderIndex: true } },
        },
      },
      section: { select: { code: true, name: true, orderIndex: true } },
    },
  });

  const byVilla = new Map<string, MatrixRow>();
  for (const r of rows) {
    let row = byVilla.get(r.villaId);
    if (!row) {
      row = {
        villaId: r.villaId,
        villaNumber: r.villa.number,
        villaLabel: r.villa.label ?? `Villa ${r.villa.number}`,
        blockCode: r.villa.block.code,
        cellsBySection: new Map(),
      };
      byVilla.set(r.villaId, row);
    }
    row.cellsBySection.set(r.section.code, {
      sectionCode: r.section.code,
      sectionName: r.section.name,
      baselineStart: r.baselineStart,
      baselineFinish: r.baselineFinish,
      actualStart: r.actualStart,
      actualFinish: r.actualFinish,
      projectedFinish: r.projectedFinish,
      pctComplete: r.pctComplete,
      crmDate: r.crmDate,
      crmDelay: r.crmDelay,
      plannedCollection: r.plannedCollection,
    });
  }

  // Sort villas by block orderIndex then villa number.
  return [...byVilla.values()].sort((a, b) => {
    if (a.blockCode !== b.blockCode) {
      // Rely on numeric block-code first, then string as tiebreak.
      const ai = parseInt(a.blockCode, 10);
      const bi = parseInt(b.blockCode, 10);
      if (!isNaN(ai) && !isNaN(bi) && ai !== bi) return ai - bi;
      return a.blockCode.localeCompare(b.blockCode);
    }
    return a.villaNumber - b.villaNumber;
  });
}
