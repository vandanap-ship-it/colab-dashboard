import { prisma } from "@/lib/prisma";

export type ProjectStats = {
  totalActivities: number;
  plannedPercent: number;
  achievedPercent: number;
  totalDelayDays: number;
  hindranceCount: number;
};

/**
 * Compute project-wide planned and achieved % across all leaf activities.
 * planned = how much SHOULD be done by today (linear ramp between baselineStart and baselineFinish)
 * achieved = average percentComplete of leaves
 */
export async function getProjectStats(projectId: string, today = new Date()): Promise<ProjectStats> {
  const all = await prisma.wBSNode.findMany({
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
  });

  const hasChildren = new Set<string>();
  for (const n of all) if (n.parentId) hasChildren.add(n.parentId);
  const leaves = all.filter((n) => !hasChildren.has(n.id));

  if (leaves.length === 0) {
    return { totalActivities: 0, plannedPercent: 0, achievedPercent: 0, totalDelayDays: 0, hindranceCount: 0 };
  }

  // Match Colab Tools' rollup: only average across leaves with a progress
  // value entered. Unstarted activities (progressEntered=false) are skipped
  // from both numerator and denominator.
  const tracked = leaves.filter((l) => l.progressEntered);
  const denom = tracked.length || leaves.length;

  let plannedSum = 0;
  let achievedSum = 0;

  for (const a of tracked) {
    achievedSum += a.percentComplete ?? 0;
    if (a.baselineStart && a.baselineFinish) {
      const start = a.baselineStart.getTime();
      const end = a.baselineFinish.getTime();
      const now = today.getTime();
      if (now <= start) plannedSum += 0;
      else if (now >= end) plannedSum += 100;
      else plannedSum += ((now - start) / (end - start)) * 100;
    }
  }

  const plannedPercent = denom > 0 ? plannedSum / denom : 0;
  const achievedPercent = denom > 0 ? achievedSum / denom : 0;

  // Total delay: project-level override (projectedEndDate vs endDate) wins.
  // Falls back to per-leaf rollup when no override is set.
  const projectOverride = await prisma.project.findUnique({
    where: { id: projectId },
    select: { endDate: true, projectedEndDate: true },
  });
  let totalDelayDays = 0;
  if (projectOverride?.endDate && projectOverride?.projectedEndDate) {
    totalDelayDays = Math.max(
      0,
      Math.round(
        (projectOverride.projectedEndDate.getTime() - projectOverride.endDate.getTime()) / 86400000,
      ),
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

  const hindranceCount = await prisma.hindrance.count({ where: { projectId, status: "OPEN" } });

  return {
    totalActivities: leaves.length,
    plannedPercent: Math.round(plannedPercent * 100) / 100,
    achievedPercent: Math.round(achievedPercent * 100) / 100,
    totalDelayDays,
    hindranceCount,
  };
}
