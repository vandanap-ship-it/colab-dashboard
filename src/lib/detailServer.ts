// ---------------------------------------------------------------------------
// Detail-drawer server queries.
//
// Fetches the data shown when a user clicks a villa box or a block card on
// the Dashboard / Layout tabs. Kept separate from rollupServer.ts because
// drilling into ONE villa or ONE block has a very different query shape
// than the whole-project rollup — no need to pull everything.
// ---------------------------------------------------------------------------

import "server-only";

import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Villa detail
// ---------------------------------------------------------------------------

export interface VillaDetailMilestone {
  sectionCode: string;
  sectionName: string;
  sectionOrder: number;
  baselineStart: Date | null;
  baselineFinish: Date | null;
  actualStart: Date | null;
  actualFinish: Date | null;
  projectedFinish: Date | null;
  pctComplete: number;
  slipDays: number;         // 0 if on-time / not-started; positive if late
  status: "not-started" | "in-progress" | "done" | "done-late" | "at-risk";
}

export interface VillaDetail {
  villaId: string;
  villaNumber: number;
  villaLabel: string;              // "Villa 12" or "Villa 10 & 11"
  blockCode: string;
  unitCount: number;
  projectId: string;
  projectName: string;
  currentSection: number;          // -1 if not started; else index into milestones[]
  currentSlipDays: number;         // slip of the currently in-flight milestone
  handoverSlipDays: number;        // slip of the last (Handover) milestone
  overallPctComplete: number;      // duration-weighted mean across milestones
  milestones: VillaDetailMilestone[];  // ordered by sectionOrder
}

const MS_PER_DAY = 86_400_000;

function computeSlipDays(baseline: Date | null, actual: Date | null, projected: Date | null): number {
  if (!baseline) return 0;
  const finish = actual ?? projected;
  if (!finish) return 0;
  return Math.max(0, Math.round((finish.getTime() - baseline.getTime()) / MS_PER_DAY));
}

function statusForMilestone(m: {
  actualStart: Date | null;
  actualFinish: Date | null;
  pctComplete: number;
  slipDays: number;
}): VillaDetailMilestone["status"] {
  if (m.pctComplete >= 100 && m.actualFinish) {
    return m.slipDays > 0 ? "done-late" : "done";
  }
  if (m.actualStart) return "in-progress";
  if (m.slipDays > 0) return "at-risk";
  return "not-started";
}

const villaSelect = {
  id: true, number: true, label: true, unitCount: true, projectId: true,
  block: { select: { code: true } },
  project: { select: { name: true } },
  milestones: {
    select: {
      baselineStart: true, baselineFinish: true,
      actualStart: true, actualFinish: true, projectedFinish: true,
      pctComplete: true,
      section: { select: { code: true, name: true, orderIndex: true } },
    },
  },
} as const;

type VillaRow = {
  id: string; number: number; label: string | null; unitCount: number; projectId: string;
  block: { code: string };
  project: { name: string };
  milestones: Array<{
    baselineStart: Date | null; baselineFinish: Date | null;
    actualStart: Date | null; actualFinish: Date | null; projectedFinish: Date | null;
    pctComplete: number;
    section: { code: string; name: string; orderIndex: number };
  }>;
};

function shapeVilla(villa: VillaRow): VillaDetail {
  const milestones: VillaDetailMilestone[] = villa.milestones
    .map((m) => {
      const slipDays = computeSlipDays(m.baselineFinish, m.actualFinish, m.projectedFinish);
      return {
        sectionCode: m.section.code,
        sectionName: m.section.name,
        sectionOrder: m.section.orderIndex,
        baselineStart: m.baselineStart,
        baselineFinish: m.baselineFinish,
        actualStart: m.actualStart,
        actualFinish: m.actualFinish,
        projectedFinish: m.projectedFinish,
        pctComplete: m.pctComplete,
        slipDays,
        status: statusForMilestone({
          actualStart: m.actualStart,
          actualFinish: m.actualFinish,
          pctComplete: m.pctComplete,
          slipDays,
        }),
      };
    })
    .sort((a, b) => a.sectionOrder - b.sectionOrder);

  const overallPctComplete = milestones.length === 0
    ? 0
    : milestones.reduce((s, m) => s + m.pctComplete, 0) / milestones.length;

  let currentSection = -1;
  const inFlight = milestones.filter((m) => m.actualStart && !m.actualFinish);
  if (inFlight.length > 0) {
    currentSection = Math.min(...inFlight.map((m) => m.sectionOrder));
  } else {
    const done = milestones.filter((m) => m.actualFinish);
    if (done.length > 0) {
      const lastDone = Math.max(...done.map((m) => m.sectionOrder));
      currentSection = Math.min(milestones.length - 1, lastDone + 1);
    }
  }

  const currentSlipDays = currentSection >= 0
    ? (milestones.find((m) => m.sectionOrder === currentSection)?.slipDays ?? 0)
    : 0;
  const handoverSlipDays = milestones[milestones.length - 1]?.slipDays ?? 0;

  return {
    villaId: villa.id,
    villaNumber: villa.number,
    villaLabel: villa.label ?? `Villa ${villa.number}`,
    blockCode: villa.block.code,
    unitCount: villa.unitCount,
    projectId: villa.projectId,
    projectName: villa.project.name,
    currentSection,
    currentSlipDays,
    handoverSlipDays,
    overallPctComplete: Math.round(overallPctComplete * 100) / 100,
    milestones,
  };
}

export async function getVillaDetail(villaId: string): Promise<VillaDetail | null> {
  const villa = await prisma.villa.findUnique({
    where: { id: villaId },
    select: villaSelect,
  });
  return villa ? shapeVilla(villa) : null;
}

export async function getVillaDetailByNumber(projectId: string, number: number): Promise<VillaDetail | null> {
  const villa = await prisma.villa.findUnique({
    where: { projectId_number: { projectId, number } },
    select: villaSelect,
  });
  return villa ? shapeVilla(villa) : null;
}

// ---------------------------------------------------------------------------
// Block detail
// ---------------------------------------------------------------------------

export interface BlockDetailVilla {
  villaId: string;
  villaNumber: number;
  villaLabel: string;
  overallPctComplete: number;
  handoverSlipDays: number;
  currentSlipDays: number;
  currentSectionName: string | null;   // "Foundation / Substructure" or null if not started
  status: "not-started" | "healthy" | "warning" | "critical";
}

export interface BlockDetail {
  blockId: string;
  code: string;
  name: string | null;
  pod: string | null;
  projectId: string;
  projectName: string;
  villaCount: number;              // sum of unitCount across villas
  villaRecordCount: number;        // distinct Villa records (may be < villaCount if grouped)
  handoverSlipDays: number;        // max villa handover slip
  currentSlipDays: number;         // max in-flight slip
  overallPctComplete: number;      // mean across villas
  villas: BlockDetailVilla[];      // ordered by villa number
}

/** Bucket a slip into a status label. Mirrors the executive rollup rules. */
function statusForSlip(slip: number, started: boolean): BlockDetailVilla["status"] {
  if (!started) return "not-started";
  if (slip > 30) return "critical";
  if (slip > 0)  return "warning";
  return "healthy";
}

export async function getBlockDetail(projectId: string, blockCode: string): Promise<BlockDetail | null> {
  const block = await prisma.block.findUnique({
    where: { projectId_code: { projectId, code: blockCode } },
    select: {
      id: true, code: true, name: true, pod: true, projectId: true,
      project: { select: { name: true } },
      villas: {
        select: {
          id: true, number: true, label: true, unitCount: true,
          milestones: {
            select: {
              baselineFinish: true, actualStart: true, actualFinish: true,
              projectedFinish: true, pctComplete: true,
              section: { select: { name: true, orderIndex: true } },
            },
          },
        },
        orderBy: { number: "asc" },
      },
    },
  });

  if (!block) return null;

  const villas: BlockDetailVilla[] = block.villas.map((v) => {
    const ms = [...v.milestones].sort(
      (a, b) => a.section.orderIndex - b.section.orderIndex,
    );
    // Handover slip = last milestone slip
    const lastMilestone = ms[ms.length - 1];
    const handoverSlipDays = lastMilestone
      ? computeSlipDays(lastMilestone.baselineFinish, lastMilestone.actualFinish, lastMilestone.projectedFinish)
      : 0;
    // Current milestone = first in-flight; else next-after-last-done
    const inFlight = ms.filter((m) => m.actualStart && !m.actualFinish);
    const currentMilestone = inFlight.length > 0
      ? inFlight.reduce((a, b) => (a.section.orderIndex < b.section.orderIndex ? a : b))
      : null;
    const currentSlipDays = currentMilestone
      ? computeSlipDays(currentMilestone.baselineFinish, currentMilestone.actualFinish, currentMilestone.projectedFinish)
      : 0;
    const started = ms.some((m) => m.actualStart);
    const overallPctComplete = ms.length === 0
      ? 0
      : ms.reduce((s, m) => s + m.pctComplete, 0) / ms.length;
    return {
      villaId: v.id,
      villaNumber: v.number,
      villaLabel: v.label ?? `Villa ${v.number}`,
      overallPctComplete: Math.round(overallPctComplete * 100) / 100,
      handoverSlipDays,
      currentSlipDays,
      currentSectionName: currentMilestone?.section.name ?? null,
      status: statusForSlip(handoverSlipDays, started),
    };
  });

  const villaCount = block.villas.reduce((n, v) => n + v.unitCount, 0);
  const handoverSlipDays = Math.max(0, ...villas.map((v) => v.handoverSlipDays));
  const currentSlipDays = Math.max(0, ...villas.map((v) => v.currentSlipDays));
  const overallPctComplete = villas.length === 0
    ? 0
    : villas.reduce((s, v) => s + v.overallPctComplete, 0) / villas.length;

  return {
    blockId: block.id,
    code: block.code,
    name: block.name,
    pod: block.pod,
    projectId: block.projectId,
    projectName: block.project.name,
    villaCount,
    villaRecordCount: block.villas.length,
    handoverSlipDays,
    currentSlipDays,
    overallPctComplete: Math.round(overallPctComplete * 100) / 100,
    villas,
  };
}
