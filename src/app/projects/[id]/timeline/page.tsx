import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canSeeDesktop } from "@/lib/roles";
import Navbar from "@/components/Navbar";
import MilestoneTimeline from "@/components/schedule/MilestoneTimeline";
import { getMilestoneTimeline } from "@/lib/scheduleServer";

export const dynamic = "force-dynamic";

export default async function TimelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");

  const { id: projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, startDate: true, endDate: true },
  });
  if (!project) notFound();

  const data = await getMilestoneTimeline(projectId).catch(() => null);

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      <Navbar />
      <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-8 space-y-4">
        <div>
          <Link
            href={`/projects/${projectId}/snapshot`}
            className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-900"
          >
            <ChevronLeft className="w-3 h-3" />
            Back to {project.name}
          </Link>
          <div className="flex items-baseline justify-between flex-wrap gap-2 mt-2">
            <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Milestone Timeline</h1>
            <p className="text-xs text-stone-400">Rolled up per villa · 21 milestone sections · click for details</p>
          </div>
        </div>
        {data ? (
          <MilestoneTimeline data={data} />
        ) : (
          <div className="rounded-xl border border-dashed border-stone-300 p-10 text-center text-stone-500">
            <p>No milestone data yet.</p>
            <p className="text-xs mt-2 text-stone-400">
              Import the MSP schedule to populate the timeline. Once imported, this view
              rolls up every villa's 21 milestone sections into one Gantt.
            </p>
            <Link href={`/projects/${projectId}/import`} className="text-sm text-stone-900 underline mt-3 inline-block">
              Import schedule →
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
