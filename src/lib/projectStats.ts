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

  const tracked = leaves.filter((l) => l.progressEntered);
  const denom = tracked.length || leaves.length;

  let plannedSum = 0;
  let achievedSum = 0;
  for (const a of tracked) {
    achievedSum += a.percentComplete ?? 0;
    // plannedPercentFor returns 0 for activities without baselines, so adding
    // unconditionally matches the old "only count leaves with baselines" logic.
    plannedSum += plannedPercentFor(a.baselineStart, a.baselineFinish, today);
  }

  const plannedPercent = denom > 0 ? plannedSum / denom : 0;
  const achievedPercent = denom > 0 ? achievedSum / denom : 0;

  // Total delay: project-level override (projectedEndDate vs endDate) wins.
  // Falls back to per-leaf rollup when no override is set.
  let totalDelayDays = 0;
  if (meta.endDate && meta.projectedEndDate) {
    totalDelayDays = Math.max(
      0,
      Math.round((meta.projectedEndDate.getTime() - meta.endDate.getTime()) / 86400000),
    );
  } else {
    for (const a of leaves) {
      if (a.baselineFinish) {
        const finish = a.projectedFinish ?? a.actualFinish ?? null;
        if (finish) {
          const d = Math.round((finish.getTime() - a.baselineFinish.getTime()) / 86400000);
          if (d > totalDelayDays) totalDelayDays = d;
        }
      }
    }
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
  const [nodes, project, hindranceCount] = await Promise.all([
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
      },
    }),
    prisma.project.findUnique({
      where: { id: projectId },
      select: { endDate: true, projectedEndDate: true },
    }),
    prisma.hindrance.count({ where: { projectId, status: "OPEN" } }),
  ]);

  const stats = computeProjectStats(nodes, project ?? { endDate: null, projectedEndDate: null }, today);
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

  const [allNodes, projects, hindranceCounts] = await Promise.all([
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

  const result: Record<string, ProjectStats> = {};
  for (const pid of projectIds) {
    const nodes = nodesByProject.get(pid) ?? [];
    const meta = metaById.get(pid) ?? { endDate: null, projectedEndDate: null };
    const stats = computeProjectStats(nodes, meta, today);
    result[pid] = { ...stats, hindranceCount: hindranceById.get(pid) ?? 0 };
  }
  return result;
}
