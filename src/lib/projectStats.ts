import { prisma } from "@/lib/prisma";
import { plannedPercentFor } from "@/lib/schedule";

export type ProjectStats = {
  totalActivities: number;
  plannedPercent: number;
  achievedPercent: number;
  totalDelayDays: number;
  hindranceCount: number;
};

/**
 * Minimal WBS node shape needed for the rollup math. Both Prisma fetchers
 * below select these columns; the pure compute below works against the type.
 */
export type StatsNode = {
  id: string;
  parentId: string | null;
  baselineStart: Date | null;
  baselineFinish: Date | null;
  actualFinish: Date | null;
  projectedFinish: Date | null;
  percentComplete: number;
  progressEntered: boolean;
  /** Colab CSV Physical_Progress — the activity's weight contribution to
   *  overall project completion. Set by Colab progress sync; null for
   *  projects that only came from MSP. */
  weightPct: number | null;
};

export type ProjectMeta = {
  endDate: Date | null;
  projectedEndDate: Date | null;
};

/**
 * PURE function — computes per-project rollup from already-loaded data.
 * Extracted so it can be unit tested without a DB and so the portfolio
 * batcher can reuse the same logic per project.
 *
 * Matches the Colab Tools rollup: only averages across leaves with a progress
 * value entered. Unstarted activities (progressEntered=false) are skipped
 * from both numerator and denominator. The Master Report does the same as of
 * the Tier 2 math-reconciliation fix.
 */
export function computeProjectStats(
  nodes: StatsNode[],
  meta: ProjectMeta,
  today: Date,
): Omit<ProjectStats, "hindranceCount"> {
  const hasChildren = new Set<string>();
  for (const n of nodes) if (n.parentId) hasChildren.add(n.parentId);
  const leaves = nodes.filter((n) => !hasChildren.has(n.id));

  if (leaves.length === 0) {
    return { totalActivities: 0, plannedPercent: 0, achievedPercent: 0, totalDelayDays: 0 };
  }

  // Colab-parity project completion %:
  //   achieved = Σ(weightPct × percentComplete / 100) across weighted leaves
  //   planned  = Σ(weightPct × plannedPercentFor(...) / 100) across weighted leaves
  // Both sum to a project-completion percentage on the same 0-100 scale as
  // Weekly §1. Falls back to the equal-weighted average with denominator =
  // ALL leaves (NOT just tracked — the old "tracked only" denom biased the
  // number wildly high on partially-imported projects) when no weightPct
  // data is available (e.g. MSP-only projects that never got Colab sync).
  const weighted = leaves.filter((l) => l.weightPct != null);
  let plannedPercent: number;
  let achievedPercent: number;
  if (weighted.length > 0) {
    let wPlanned = 0, wAchieved = 0;
    for (const a of weighted) {
      const w = a.weightPct ?? 0;
      wAchieved += (w * (a.percentComplete ?? 0)) / 100;
      wPlanned  += (w * plannedPercentFor(a.baselineStart, a.baselineFinish, today)) / 100;
    }
    plannedPercent = wPlanned;
    achievedPercent = wAchieved;
  } else {
    let plannedSum = 0, achievedSum = 0;
    for (const a of leaves) {
      achievedSum += a.percentComplete ?? 0;
      plannedSum  += plannedPercentFor(a.baselineStart, a.baselineFinish, today);
    }
    plannedPercent = plannedSum / leaves.length;
    achievedPercent = achievedSum / leaves.length;
  }

  // Total delay: prefer live-computed slippage from the leaves — Project.
  // projectedEndDate goes stale unless someone manually updates it. Take the
  // max slip across leaves (projected/actual finish − baseline finish).
  // Falls back to the project-level override only when no leaves have both
  // baseline + projected/actual.
  let totalDelayDays = 0;
  let anyLeafDelay = false;
  for (const a of leaves) {
    if (a.baselineFinish) {
      const finish = a.projectedFinish ?? a.actualFinish ?? null;
      if (finish) {
        anyLeafDelay = true;
        const d = Math.round((finish.getTime() - a.baselineFinish.getTime()) / 86400000);
        if (d > totalDelayDays) totalDelayDays = d;
      }
    }
  }
  if (!anyLeafDelay && meta.endDate && meta.projectedEndDate) {
    totalDelayDays = Math.max(
      0,
      Math.round((meta.projectedEndDate.getTime() - meta.endDate.getTime()) / 86400000),
    );
  }

  return {
    totalActivities: leaves.length,
    plannedPercent: Math.round(plannedPercent * 100) / 100,
    achievedPercent: Math.round(achievedPercent * 100) / 100,
    totalDelayDays,
  };
}

/**
 * Compute project-wide planned + achieved %, delay, hindrance count for a
 * single project. Used by the per-project snapshot tab.
 *
 * 3 DB round-trips. For listing multiple projects use getPortfolioStats
 * instead — it batches everything into 3 queries total regardless of N.
 */
export async function getProjectStats(projectId: string, today = new Date()): Promise<ProjectStats> {
  const [nodes, project, hindranceCount, colabPlanned, colabActual] = await Promise.all([
    prisma.wBSNode.findMany({
      where: { projectId },
      select: {
        id: true,
        parentId: true,
        baselineStart: true,
        baselineFinish: true,
        actualFinish: true,
        projectedFinish: true,
        percentComplete: true,
        progressEntered: true,
        weightPct: true,
      },
    }),
    prisma.project.findUnique({
      where: { id: projectId },
      select: { endDate: true, projectedEndDate: true },
    }),
    prisma.hindrance.count({ where: { projectId, status: "OPEN" } }),
    // ColabActivity is the authoritative Colab-parity source when present —
    // Weekly §1 reads from it. Use the same sums here so the landing table
    // and the Weekly Report agree to the decimal.
    prisma.colabActivity.aggregate({
      where: { projectId, plannedEnd: { lte: today } },
      _sum: { physicalProgress: true },
    }),
    prisma.colabActivity.aggregate({
      where: { projectId, progressDate: { not: null, lte: today } },
      _sum: { physicalProgress: true },
    }),
  ]);

  const stats = computeProjectStats(nodes, project ?? { endDate: null, projectedEndDate: null }, today);
  // Override planned/achieved with Colab authoritative sums when available.
  const colabActualPct = colabActual._sum.physicalProgress ?? 0;
  const colabPlannedPct = colabPlanned._sum.physicalProgress ?? 0;
  if (colabActualPct > 0 || colabPlannedPct > 0) {
    stats.achievedPercent = Math.round(colabActualPct * 100) / 100;
    stats.plannedPercent = Math.round(colabPlannedPct * 100) / 100;
  }
  return { ...stats, hindranceCount };
}

/**
 * Batched portfolio rollup — same math as getProjectStats but for an
 * arbitrary set of projects in 3 DB queries total (parallel) instead of
 * 5N. Used by /api/projects/summary, which powers the home page.
 *
 * Returns a Record keyed by projectId. Projects with no WBS nodes get a
 * zeroed-out entry (matches getProjectStats behaviour).
 */
export async function getPortfolioStats(
  projectIds: string[],
  today = new Date(),
): Promise<Record<string, ProjectStats>> {
  if (projectIds.length === 0) return {};

  const [allNodes, projects, hindranceCounts, colabPlannedRows, colabActualRows] = await Promise.all([
    prisma.wBSNode.findMany({
      where: { projectId: { in: projectIds } },
      select: {
        id: true,
        projectId: true,
        parentId: true,
        baselineStart: true,
        baselineFinish: true,
        actualFinish: true,
        projectedFinish: true,
        percentComplete: true,
        progressEntered: true,
        weightPct: true,
      },
    }),
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, endDate: true, projectedEndDate: true },
    }),
    prisma.hindrance.groupBy({
      by: ["projectId"],
      where: { projectId: { in: projectIds }, status: "OPEN" },
      _count: { _all: true },
    }),
    // Colab-parity per-project sums, matches Weekly §1's math.
    prisma.colabActivity.groupBy({
      by: ["projectId"],
      where: { projectId: { in: projectIds }, plannedEnd: { lte: today } },
      _sum: { physicalProgress: true },
    }),
    prisma.colabActivity.groupBy({
      by: ["projectId"],
      where: { projectId: { in: projectIds }, progressDate: { not: null, lte: today } },
      _sum: { physicalProgress: true },
    }),
  ]);

  // Index by projectId for O(1) lookup per project.
  const nodesByProject = new Map<string, StatsNode[]>();
  for (const n of allNodes) {
    const bucket = nodesByProject.get(n.projectId);
    if (bucket) bucket.push(n);
    else nodesByProject.set(n.projectId, [n]);
  }
  const metaById = new Map(
    projects.map((p) => [p.id, { endDate: p.endDate, projectedEndDate: p.projectedEndDate }]),
  );
  const hindranceById = new Map(hindranceCounts.map((h) => [h.projectId, h._count._all]));
  const colabPlannedById = new Map(colabPlannedRows.map((r) => [r.projectId, r._sum.physicalProgress ?? 0]));
  const colabActualById  = new Map(colabActualRows .map((r) => [r.projectId, r._sum.physicalProgress ?? 0]));

  const result: Record<string, ProjectStats> = {};
  for (const pid of projectIds) {
    const nodes = nodesByProject.get(pid) ?? [];
    const meta = metaById.get(pid) ?? { endDate: null, projectedEndDate: null };
    const stats = computeProjectStats(nodes, meta, today);
    const cAct = colabActualById.get(pid) ?? 0;
    const cPln = colabPlannedById.get(pid) ?? 0;
    if (cAct > 0 || cPln > 0) {
      stats.achievedPercent = Math.round(cAct * 100) / 100;
      stats.plannedPercent = Math.round(cPln * 100) / 100;
    }
    result[pid] = { ...stats, hindranceCount: hindranceById.get(pid) ?? 0 };
  }
  return result;
}
