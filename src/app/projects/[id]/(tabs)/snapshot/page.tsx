import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getProjectStats } from "@/lib/projectStats";
import PhysicalProgressGauge from "@/components/PhysicalProgressGauge";
import ScheduleSummary from "@/components/ScheduleSummary";
import TimelineBar from "@/components/TimelineBar";
import HindranceSummary from "@/components/HindranceSummary";
import ConcernRaised from "@/components/ConcernRaised";
import IssuesCard from "@/components/IssuesCard";
import MilestoneSummary from "@/components/MilestoneSummary";
import QAQCList from "@/components/QAQCList";
import InteractiveDrawings from "@/components/InteractiveDrawings";
import { isAdmin, ROLES, canCreateProject } from "@/lib/roles";

export default async function SnapshotPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return null;

  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      reraEndDate: true,
      actualStartDate: true,
      projectedEndDate: true,
    },
  });
  if (!project) notFound();

  const stats = await getProjectStats(id);

  // Projected end: project-level override wins, otherwise roll up from leaves.
  const leafFinishes = await prisma.wBSNode.findMany({
    where: { projectId: id, projectedFinish: { not: null } },
    select: { projectedFinish: true },
  });
  const projectedEndFromLeaves = leafFinishes.reduce<Date | null>((acc, n) => {
    if (!n.projectedFinish) return acc;
    return acc && acc > n.projectedFinish ? acc : n.projectedFinish;
  }, null);
  const projectedEnd = project.projectedEndDate ?? projectedEndFromLeaves;

  // Actual start: project-level override wins, otherwise earliest leaf actual.
  const leafActualStart = await prisma.wBSNode.findFirst({
    where: { projectId: id, actualStart: { not: null } },
    orderBy: { actualStart: "asc" },
    select: { actualStart: true },
  });
  const actualStart = project.actualStartDate ?? leafActualStart?.actualStart ?? null;

  if (stats.totalActivities === 0) {
    return (
      <div className="rounded-xl border border-dashed border-stone-300 p-10 text-center">
        <p className="text-stone-500">No schedule imported yet.</p>
        <Link
          href={`/projects/${id}/import`}
          className="text-sm text-stone-900 underline mt-2 inline-block"
        >
          Import a CSV →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="rounded-xl border border-stone-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-stone-700 uppercase tracking-wider mb-4">
            Physical Progress
          </h2>
          <PhysicalProgressGauge achieved={stats.achievedPercent} planned={stats.plannedPercent} />
        </section>
        <section className="lg:col-span-2 rounded-xl border border-stone-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-stone-700 uppercase tracking-wider mb-4">
            Schedule Summary
          </h2>
          <ScheduleSummary
            startDate={project.startDate}
            endDate={project.endDate}
            reraEndDate={project.reraEndDate}
            projectedEndDate={projectedEnd}
            totalDelayDays={stats.totalDelayDays}
            hindranceCount={stats.hindranceCount}
          />
        </section>
      </div>

      <section className="rounded-xl border border-stone-200 bg-white p-6">
        <TimelineBar
          plannedStart={project.startDate}
          plannedEnd={project.endDate}
          actualStart={actualStart}
          projectedEnd={projectedEnd}
        />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <HindranceSummary
          projectId={id}
          canResolve={
            session.user.role === ROLES.PLANNER ||
            session.user.role === ROLES.PRODUCT_TEAM ||
            isAdmin(session.user.role)
          }
        />
        <IssuesCard
          projectId={id}
          canResolve={
            session.user.role === ROLES.PLANNER ||
            session.user.role === ROLES.PRODUCT_TEAM ||
            isAdmin(session.user.role)
          }
        />
      </div>

      <ConcernRaised
        projectId={id}
        canManage={
          session.user.role === ROLES.PLANNER ||
          session.user.role === ROLES.PRODUCT_TEAM ||
          isAdmin(session.user.role)
        }
      />

      <MilestoneSummary projectId={id} />

      <InteractiveDrawings
        projectId={id}
        canManage={canCreateProject(session.user.role)}
      />

      <div id="qaqc">
        <QAQCList
          projectId={id}
          canReview={
            session.user.role === ROLES.PLANNER ||
            session.user.role === ROLES.PRODUCT_TEAM ||
            isAdmin(session.user.role)
          }
        />
      </div>
    </div>
  );
}
