import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPortfolioStats } from "@/lib/projectStats";

export type ProjectSummary = {
  id: string;
  name: string;
  code: string | null;
  status: string;
  logoUrl: string | null;
  projectType: string | null;
  startDate: string | null;
  endDate: string | null;
  projectedEndDate: string | null;
  progressPercent: number;   // physical progress (achieved %)
  plannedPercent: number;
  totalActivities: number;
  totalDelayDays: number;
  openConcerns: number;
  openIssues: number;
  openHindrances: number;
  activePermits: number;
  actualLabourToday: number;      // sum of ManpowerEntry.actualCount for today
  plannedLabourToday: number | null; // sum of currently-effective TradePlan.plannedCount; null if none set
  // Stub columns — schema/UI ready, waiting on data sources.
  costTotal: number | null;
  financialProgressPct: number | null;
};

/**
 * Portfolio rollup that powers the multi-project landing page.
 *
 * Batches everything into a fixed number of queries regardless of project
 * count (5N+1 problem eliminated):
 *   1. project.findMany           (the project list)
 *   2. getPortfolioStats(ids)     (WBS + delay + hindrance in parallel)
 *   3. concern.groupBy            (pending count per project)
 *   4. issue.groupBy              (open count per project)
 *   5. permit.groupBy             (ACTIVE + EXPIRING_SOON — anything non-EXPIRED)
 *   6. manpowerEntry.groupBy      (today's actual labour per project)
 *   7. tradePlan.findMany         (currently-effective plans, summed per project)
 *
 * All I/O runs in Promise.all — same wall-clock as before, more data.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      logoUrl: true,
      projectType: true,
      startDate: true,
      endDate: true,
      projectedEndDate: true,
    },
  });

  if (projects.length === 0) return NextResponse.json({ projects: [] });

  const projectIds = projects.map((p) => p.id);

  // Today at UTC midnight — the canonical "today" for the manpower rollup.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const [stats, concernCounts, issueCounts, permitCounts, manpowerToday, plansToday] = await Promise.all([
    getPortfolioStats(projectIds),
    prisma.concern.groupBy({
      by: ["projectId"],
      where: {
        projectId: { in: projectIds },
        status: { in: ["PENDING", "TASK_ASSIGNED", "READ"] },
      },
      _count: { _all: true },
    }),
    prisma.issue.groupBy({
      by: ["projectId"],
      where: { projectId: { in: projectIds }, status: "OPEN" },
      _count: { _all: true },
    }),
    prisma.permit.groupBy({
      by: ["projectId"],
      where: {
        projectId: { in: projectIds },
        deletedAt: null,
        // ACTIVE + EXPIRING_SOON only — RENEWED is a superseded state, EXPIRED
        // is a red flag rather than a live permit.
        status: { in: ["ACTIVE", "EXPIRING_SOON"] },
      },
      _count: { _all: true },
    }),
    prisma.manpowerEntry.groupBy({
      by: ["projectId"],
      where: {
        projectId: { in: projectIds },
        deletedAt: null,
        entryDate: today,
      },
      _sum: { actualCount: true },
    }),
    prisma.tradePlan.findMany({
      where: {
        projectId: { in: projectIds },
        deletedAt: null,
        startDate: { lte: today },
        OR: [{ endDate: null }, { endDate: { gt: today } }],
      },
      select: { projectId: true, plannedCount: true },
    }),
  ]);

  const concernByProject = new Map(concernCounts.map((c) => [c.projectId, c._count._all]));
  const issueByProject   = new Map(issueCounts.map((i)   => [i.projectId, i._count._all]));
  const permitByProject  = new Map(permitCounts.map((p)  => [p.projectId, p._count._all]));
  const actualByProject  = new Map(manpowerToday.map((m) => [m.projectId, m._sum.actualCount ?? 0]));

  // Sum planned trades per project — 0 rows = null (no plan set).
  const plannedByProject = new Map<string, number>();
  const hasPlanByProject = new Set<string>();
  for (const p of plansToday) {
    plannedByProject.set(p.projectId, (plannedByProject.get(p.projectId) ?? 0) + p.plannedCount);
    hasPlanByProject.add(p.projectId);
  }

  const summaries: ProjectSummary[] = projects.map((p) => {
    const s = stats[p.id];
    return {
      id: p.id,
      name: p.name,
      code: p.code,
      status: p.status,
      logoUrl: p.logoUrl,
      projectType: p.projectType,
      startDate: p.startDate?.toISOString() ?? null,
      endDate: p.endDate?.toISOString() ?? null,
      projectedEndDate: p.projectedEndDate?.toISOString() ?? null,
      progressPercent: s.achievedPercent,
      plannedPercent: s.plannedPercent,
      totalActivities: s.totalActivities,
      totalDelayDays: s.totalDelayDays,
      openConcerns: concernByProject.get(p.id) ?? 0,
      openIssues: issueByProject.get(p.id) ?? 0,
      openHindrances: s.hindranceCount,
      activePermits: permitByProject.get(p.id) ?? 0,
      actualLabourToday: actualByProject.get(p.id) ?? 0,
      plannedLabourToday: hasPlanByProject.has(p.id) ? (plannedByProject.get(p.id) ?? 0) : null,
      // Stubs — will populate as bills / cost data flows in.
      costTotal: null,
      financialProgressPct: null,
    };
  });

  return NextResponse.json({ projects: summaries });
}
