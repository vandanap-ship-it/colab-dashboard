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
  // Echoed on PATCH so the server rejects stale edits from a second admin.
  updatedAt: string;
  progressPercent: number;
  plannedPercent: number;
  totalActivities: number;
  totalDelayDays: number;
  openConcerns: number;
  openIssues: number;
  openHindrances: number;
  activePermits: number;
  actualLabourToday: number;
  plannedLabourToday: number | null;
  costTotal: number | null;
  financialProgressPct: number | null;
};

// Defensive wrappers around the queries that touch tables/columns added by
// migrations still pending on prod. Each returns a safe empty result on
// failure so the landing page loads even before an admin runs the migrations.
async function safeManpowerGroupBy(projectIds: string[], today: Date) {
  try {
    return await prisma.manpowerEntry.groupBy({
      by: ["projectId"],
      where: { projectId: { in: projectIds }, deletedAt: null, entryDate: today },
      _sum: { actualCount: true },
    });
  } catch (e) {
    console.info("[projects/summary] manpowerEntry.groupBy failed (migrations pending?):", e instanceof Error ? e.message : e);
    return [] as { projectId: string; _sum: { actualCount: number | null } }[];
  }
}

async function safeTradePlansFindMany(projectIds: string[], today: Date) {
  try {
    return await prisma.tradePlan.findMany({
      where: {
        projectId: { in: projectIds },
        deletedAt: null,
        startDate: { lte: today },
        OR: [{ endDate: null }, { endDate: { gt: today } }],
      },
      select: { projectId: true, plannedCount: true },
    });
  } catch (e) {
    console.info("[projects/summary] tradePlan.findMany failed (migrations pending?):", e instanceof Error ? e.message : e);
    return [] as { projectId: string; plannedCount: number }[];
  }
}

/**
 * Portfolio rollup that powers the multi-project landing page.
 *
 * Guarded against the four-pending-migrations state: if projectType /
 * manpower / trade-plan tables + columns aren't in the DB yet, this endpoint
 * still returns a valid response so the landing table renders. Once the
 * admin runs `/api/admin/migrate` the full data appears without a code
 * change.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Try to include the new columns; if the DB is pre-migration for
  // Project.projectType or Project.logoUrl, fall back to a minimal select
  // and null those fields.
  type MaybeExtendedProject = {
    id: string;
    name: string;
    code: string | null;
    status: string;
    startDate: Date | null;
    endDate: Date | null;
    projectedEndDate: Date | null;
    logoUrl: string | null;
    projectType: string | null;
    updatedAt: Date;
  };
  let projects: MaybeExtendedProject[];
  try {
    projects = await prisma.project.findMany({
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
        updatedAt: true,
      },
    });
  } catch (e) {
    console.info("[projects/summary] Extended project.findMany failed (migrations pending?):", e instanceof Error ? e.message : e);
    const bare = await prisma.project.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        code: true,
        status: true,
        startDate: true,
        endDate: true,
        projectedEndDate: true,
        logoUrl: true,
        updatedAt: true,
      },
    });
    projects = bare.map((p) => ({ ...p, projectType: null }));
  }

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
        status: { in: ["ACTIVE", "EXPIRING_SOON"] },
      },
      _count: { _all: true },
    }),
    safeManpowerGroupBy(projectIds, today),
    safeTradePlansFindMany(projectIds, today),
  ]);

  const concernByProject = new Map(concernCounts.map((c) => [c.projectId, c._count._all]));
  const issueByProject   = new Map(issueCounts.map((i)   => [i.projectId, i._count._all]));
  const permitByProject  = new Map(permitCounts.map((p)  => [p.projectId, p._count._all]));
  const actualByProject  = new Map(manpowerToday.map((m) => [m.projectId, m._sum.actualCount ?? 0]));

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
      updatedAt: p.updatedAt.toISOString(),
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
      costTotal: null,
      financialProgressPct: null,
    };
  });

  return NextResponse.json({ projects: summaries });
}
