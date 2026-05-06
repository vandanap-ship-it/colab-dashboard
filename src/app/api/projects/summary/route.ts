import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getProjectStats } from "@/lib/projectStats";

export type ProjectSummary = {
  id: string;
  name: string;
  code: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  progressPercent: number;
  totalActivities: number;
  openConcerns: number;
  openIssues: number;
  openHindrances: number;
};

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

  const summaries: ProjectSummary[] = await Promise.all(
    projects.map(async (p) => {
      const [stats, openConcerns, openIssues, openHindrances] = await Promise.all([
        getProjectStats(p.id),
        prisma.concern.count({
          where: { projectId: p.id, status: { in: ["PENDING", "TASK_ASSIGNED", "READ"] } },
        }),
        prisma.issue.count({ where: { projectId: p.id, status: "OPEN" } }),
        prisma.hindrance.count({ where: { projectId: p.id, status: "OPEN" } }),
      ]);
      return {
        id: p.id,
        name: p.name,
        code: p.code,
        status: p.status,
        startDate: p.startDate?.toISOString() ?? null,
        endDate: p.endDate?.toISOString() ?? null,
        progressPercent: stats.achievedPercent,
        totalActivities: stats.totalActivities,
        openConcerns,
        openIssues,
        openHindrances,
      };
    }),
  );

  return NextResponse.json({ projects: summaries });
}
