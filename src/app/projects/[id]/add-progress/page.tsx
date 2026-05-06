import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ListPlus } from "lucide-react";
import { auth } from "@/lib/auth";
import { canSeeDesktop, isAdmin, ROLES } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import Navbar from "@/components/Navbar";
import AddProgressClient, {
  type ActivityOption,
  type ContractorOption,
  type ProgressEntryRow,
} from "@/components/AddProgressClient";

export default async function AddProgressPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");

  const { id: projectId } = await params;

  // Planner / Product Team / Admin only — engineers stay on mobile.
  const role = session.user.role;
  if (!(role === ROLES.PLANNER || role === ROLES.PRODUCT_TEAM || isAdmin(role))) {
    redirect(`/projects/${projectId}/snapshot`);
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, code: true },
  });
  if (!project) notFound();

  const [entries, allNodes, contractors] = await Promise.all([
    prisma.progressEntry.findMany({
      where: { projectId },
      orderBy: { date: "desc" },
      take: 100,
      include: {
        createdBy: { select: { id: true, name: true } },
        contractor: { select: { id: true, name: true } },
        labour: { select: { category: true, count: true } },
        photos: { select: { id: true, url: true }, orderBy: { uploadedAt: "asc" } },
        wbsNode: {
          select: {
            id: true,
            name: true,
            taskCode: true,
            unit: true,
            totalQuantity: true,
          },
        },
      },
    }),
    prisma.wBSNode.findMany({
      where: { projectId },
      select: {
        id: true,
        name: true,
        taskCode: true,
        unit: true,
        totalQuantity: true,
        parentId: true,
      },
      orderBy: [{ taskCode: "asc" }],
    }),
    prisma.contractor.findMany({
      where: { projectId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Leaves only (= activities)
  const hasChildren = new Set<string>();
  for (const n of allNodes) if (n.parentId) hasChildren.add(n.parentId);
  const leaves = allNodes.filter((n) => !hasChildren.has(n.id));

  const activities: ActivityOption[] = leaves.map((n) => ({
    id: n.id,
    name: n.name,
    taskCode: n.taskCode,
    unit: n.unit,
    totalQuantity: n.totalQuantity,
  }));

  const contractorOptions: ContractorOption[] = contractors;

  const rows: ProgressEntryRow[] = entries.map((e) => ({
    id: e.id,
    date: e.date.toISOString(),
    type: e.type,
    achievedQuantity: e.achievedQuantity,
    cumulativeQuantity: e.cumulativeQuantity,
    notes: e.notes,
    activity: {
      id: e.wbsNode.id,
      name: e.wbsNode.name,
      taskCode: e.wbsNode.taskCode,
      unit: e.wbsNode.unit,
      totalQuantity: e.wbsNode.totalQuantity,
    },
    contractor: e.contractor ?? null,
    createdBy: e.createdBy,
    labour: e.labour.map((l) => ({ category: l.category, count: l.count })),
    photos: e.photos.map((p) => ({ id: p.id, url: p.url })),
  }));

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      <Navbar />
      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div>
          <Link
            href={`/projects/${project.id}/snapshot`}
            className="inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-900 transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to {project.name}
          </Link>
          <div className="flex items-baseline gap-3 mt-2 flex-wrap">
            <h1 className="text-2xl font-semibold text-stone-900 tracking-tight inline-flex items-center gap-2">
              <ListPlus className="w-5 h-5 text-stone-500" />
              Add Progress
            </h1>
            {project.code && (
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
                {project.code}
              </span>
            )}
          </div>
          <p className="text-sm text-stone-500 mt-1">
            Bulk catch-up entries, edits and corrections. Engineers continue using the
            mobile app for daily logs.
          </p>
        </div>

        <AddProgressClient
          projectId={project.id}
          entries={rows}
          activities={activities}
          contractors={contractorOptions}
        />
      </main>
    </div>
  );
}
