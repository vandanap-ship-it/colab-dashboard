import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canSeeDesktop } from "@/lib/roles";
import { isScopedUser } from "@/lib/modules";
import Navbar from "@/components/Navbar";
import WeeklyLookAhead from "@/components/schedule/WeeklyLookAhead";
import { getWeeklyLookAhead } from "@/lib/scheduleServer";

export const dynamic = "force-dynamic";

export default async function LookAheadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");
  if (isScopedUser(session.user.modules)) redirect("/mobile");

  const { id: projectId } = await params;
  const { days } = await searchParams;
  const daysAhead = Math.max(3, Math.min(60, parseInt(days ?? "14", 10) || 14));

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const data = await getWeeklyLookAhead(projectId, daysAhead).catch(() => ({
    overdue: [], inProgress: [], days: [],
  }));

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      <Navbar />
      <main className="flex-1 w-full max-w-5xl mx-auto px-6 py-8 space-y-5">
        <div>
          <Link
            href={`/projects/${projectId}/snapshot`}
            className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-900"
          >
            <ChevronLeft className="w-3 h-3" />
            Back to {project.name}
          </Link>
          <div className="flex items-baseline justify-between flex-wrap gap-2 mt-2">
            <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Weekly Look-Ahead</h1>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-stone-500">Window:</span>
              {[7, 14, 30].map((n) => {
                const active = daysAhead === n;
                return (
                  <Link
                    key={n}
                    href={`/projects/${projectId}/look-ahead?days=${n}`}
                    className={
                      "px-2.5 py-1 rounded-full font-medium " +
                      (active
                        ? "bg-stone-900 text-white"
                        : "bg-white border border-stone-200 text-stone-600 hover:bg-stone-50")
                    }
                  >
                    {n === 30 ? "1 month" : `${n} days`}
                  </Link>
                );
              })}
            </div>
          </div>
          <p className="text-xs text-stone-400 mt-1">
            Overdue first, then in-progress, then upcoming — grouped by day. Star (★) = concrete pour checkpoint.
          </p>
        </div>
        <WeeklyLookAhead data={data} />
      </main>
    </div>
  );
}
