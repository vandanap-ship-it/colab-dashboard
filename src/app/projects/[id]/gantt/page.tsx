import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, GanttChartSquare } from "lucide-react";
import { auth } from "@/lib/auth";
import { canSeeDesktop } from "@/lib/roles";
import { isScopedUser } from "@/lib/modules";
import { prisma } from "@/lib/prisma";
import Navbar from "@/components/Navbar";
import GanttChart, { type GanttNode } from "@/components/GanttChart";

export default async function ProjectGanttPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");
  if (isScopedUser(session.user.modules)) redirect("/mobile");

  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true, code: true },
  });
  if (!project) notFound();

  const wbs = await prisma.wBSNode.findMany({
    where: { projectId: id },
    orderBy: [{ level: "asc" }, { orderIndex: "asc" }],
    select: {
      id: true,
      name: true,
      level: true,
      parentId: true,
      baselineStart: true,
      baselineFinish: true,
      actualStart: true,
      actualFinish: true,
      projectedFinish: true,
      percentComplete: true,
      contractor: { select: { name: true } },
    },
  });

  const childIds = new Set<string>();
  for (const n of wbs) if (n.parentId) childIds.add(n.parentId);

  const nodes: GanttNode[] = wbs.map((n) => ({
    id: n.id,
    name: n.name,
    level: n.level,
    parentId: n.parentId,
    baselineStart: n.baselineStart?.toISOString() ?? null,
    baselineFinish: n.baselineFinish?.toISOString() ?? null,
    actualStart: n.actualStart?.toISOString() ?? null,
    actualFinish: n.actualFinish?.toISOString() ?? null,
    projectedFinish: n.projectedFinish?.toISOString() ?? null,
    percentComplete: n.percentComplete,
    isLeaf: !childIds.has(n.id),
    contractorName: n.contractor?.name ?? null,
  }));

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      <Navbar />
      <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-8 space-y-6">
        <div>
          <Link
            href={`/projects/${id}/snapshot`}
            className="inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-900 transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to {project.name}
          </Link>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <GanttChartSquare className="w-5 h-5 text-stone-700" />
            <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">
              Gantt Master Chart
            </h1>
            {project.code && (
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
                {project.code}
              </span>
            )}
          </div>
          <p className="text-sm text-stone-500 mt-1">
            Read-only timeline of imported activities. Toggle leaf-only or zoom to fit.
          </p>
        </div>

        <GanttChart nodes={nodes} />
      </main>
    </div>
  );
}
