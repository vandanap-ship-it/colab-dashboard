import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPortfolioStats } from "@/lib/projectStats";

export type ProjectSummary = {
  id: string;
  name: string;
  code: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  progressPercent: number;
  plannedPercent: number;
  totalActivities: number;
  totalDelayDays: number;
  openConcerns: number;
  openIssues: number;
  openHindrances: number;
};

/**
 * Portfolio rollup that powers the home page. Previously the per-project loop
 * ran 5 queries per project (1 WBS findMany + 1 project findUnique + 3
 * count()) for a total of 5N+1. This rewrite batches everything into 5
 * queries total regardless of project count:
 *
 *   1. project.findMany           (the project list)
 *   2. wBSNode.findMany           (every WBS row across all projects)
 *   3. project.findMany           (delay-override columns per project)
 *   4. hindrance.groupBy          (open count per project)
 *   5. concern.groupBy            (pending-bucket count per project)
 *   6. issue.groupBy              (open count per project)
 *
 * Queries 2-6 run in parallel via getPortfolioStats + Promise.all. With 10
 * projects this drops summary latency from ~50 queries to ~5 sequential
 * round-trips' worth of Postgres time.
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
      startDate: true,
      endDate: true,
    },
  });

  if (projects.length === 0) return NextResponse.json({ projects: [] });

  const projectIds = projects.map((p) => p.id);

  const [stats, concernCounts, issueCounts] = await Promise.all([
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
  ]);

  const concernByProject = new Map(concernCounts.map((c) => [c.projectId, c._count._all]));
  const issueByProject = new Map(issueCounts.map((i) => [i.projectId, i._count._all]));

  const summaries: ProjectSummary[] = projects.map((p) => {
    const s = stats[p.id];
    return {
      id: p.id,
      name: p.name,
      code: p.code,
      status: p.status,
      startDate: p.startDate?.toISOString() ?? null,
      endDate: p.endDate?.toISOString() ?? null,
      progressPercent: s.achievedPercent,
      plannedPercent: s.plannedPercent,
      totalActivities: s.totalActivities,
      totalDelayDays: s.totalDelayDays,
      openConcerns: concernByProject.get(p.id) ?? 0,
      openIssues: issueByProject.get(p.id) ?? 0,
      openHindrances: s.hindranceCount,
    };
  });

  return NextResponse.json({ projects: summaries });
}
