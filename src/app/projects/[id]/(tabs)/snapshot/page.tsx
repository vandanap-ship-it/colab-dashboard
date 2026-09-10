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
import MilestoneMatrix from "@/components/executive/MilestoneMatrix";
import QAQCList from "@/components/QAQCList";
import InteractiveDrawings from "@/components/InteractiveDrawings";
import { isAdmin, ROLES, canCreateProject } from "@/lib/roles";
import { getMilestoneMatrix, getSections } from "@/lib/rollupServer";
import { adaptMatrixRows } from "@/lib/executiveDataAdapter";
import { CONTRACTORS, milestonesForVilla } from "@/lib/executiveMockData";

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
          <p className="mt-3 text-[11px] leading-snug text-stone-400">
            Duration-weighted % across activities that have started. The Master Report
            uses the same tracked-only math, so its topline agrees with this gauge.
          </p>
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

      {/* id="concerns" so /my-actions rows can deep-link (#concerns) directly
          to the Areas of Concern section instead of landing at the top of
          the snapshot. */}
      <div id="concerns" className="scroll-mt-20">
        <ConcernRaised
          projectId={id}
          canManage={
            session.user.role === ROLES.PLANNER ||
            session.user.role === ROLES.PRODUCT_TEAM ||
            isAdmin(session.user.role)
          }
        />
      </div>

      <MilestoneSummary projectId={id} />

      {await renderMilestoneMatrix(id)}

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

async function renderMilestoneMatrix(projectId: string) {
  // Previous behaviour on any error / missing data silently rendered a
  // hand-authored Amanvana mock matrix (villa numbers, contractors, CRM
  // amounts) which looked indistinguishable from real data — the single
  // highest deception risk on Snapshot per the Sept-launch audit. Now:
  // when the live query fails or comes back empty, we surface an explicit
  // empty state so no one mistakes placeholder numbers for the project.
  let rows: Awaited<ReturnType<typeof getMilestoneMatrix>> = [];
  let sections: Awaited<ReturnType<typeof getSections>> = [];
  try {
    [rows, sections] = await Promise.all([
      getMilestoneMatrix(projectId),
      getSections(projectId),
    ]);
  } catch (err) {
    console.error("[snapshot] milestone matrix load failed", err);
  }

  if (rows.length > 0 && sections.length > 0) {
    const adapted = adaptMatrixRows(rows, sections);
    const villaLabelsObj: Record<number, string> = {};
    adapted.villaLabels.forEach((v, k) => (villaLabelsObj[k] = v));
    const cellsByVillaObj: Record<number, ReturnType<typeof milestonesForVilla>> = {};
    adapted.cellsByVilla.forEach((v, k) => (cellsByVillaObj[k] = v));
    return (
      <MilestoneMatrix
        villaOrder={adapted.villaOrder}
        villaLabels={villaLabelsObj}
        sections={adapted.sectionNames}
        sectionHeaders={adapted.sectionHeaders}
        cellsByVilla={cellsByVillaObj}
        contractors={CONTRACTORS}
      />
    );
  }

  return (
    <section className="rounded-xl border border-dashed border-stone-300 bg-white/40 p-8 text-center">
      <p className="text-[10px] uppercase tracking-widest text-stone-400 mb-2">
        Milestone Matrix
      </p>
      <h3 className="text-sm font-semibold text-stone-700">
        No schedule loaded yet
      </h3>
      <p className="text-xs text-stone-500 mt-1.5 max-w-md mx-auto">
        Import the project schedule (MSP or the Colab planner export) to see
        the villa-by-milestone matrix. Nothing here is placeholder data —
        this section is intentionally blank until real dates are in.
      </p>
    </section>
  );
}
