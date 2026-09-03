import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Bug } from "lucide-react";
import { auth } from "@/lib/auth";
import { canSeeDesktop, isAdmin, ROLES } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import Navbar from "@/components/Navbar";
import SnagMasterTable, { type SnagRow } from "@/components/SnagMasterTable";

export default async function SnagMasterPage({
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
    select: { id: true, name: true, code: true },
  });
  if (!project) notFound();

  const role = session.user.role;
  const canManage =
    role === ROLES.PLANNER || role === ROLES.PRODUCT_TEAM || isAdmin(role);

  // Pull snags + WBS path map + contractor list + assignable users.
  const [issues, allNodes, contractors, users] = await Promise.all([
    prisma.issue.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        createdBy: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
        photos: { select: { id: true, url: true } },
        wbsNode: {
          select: {
            id: true,
            name: true,
            parentId: true,
            contractor: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.wBSNode.findMany({
      where: { projectId },
      select: { id: true, name: true, parentId: true, level: true },
    }),
    prisma.contractor.findMany({
      where: { projectId, active: true },
      select: { name: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const nameById = new Map(allNodes.map((n) => [n.id, n.name]));
  const levelById = new Map(allNodes.map((n) => [n.id, n.level]));
  const parentById = new Map(allNodes.map((n) => [n.id, n.parentId]));

  function locationFor(nodeId: string | null | undefined): string {
    if (!nodeId) return "—";
    const parts: string[] = [];
    let cur: string | null = parentById.get(nodeId) ?? null;
    let depth = 0;
    while (cur && depth < 6) {
      const lvl = levelById.get(cur);
      const nm = nameById.get(cur);
      if (lvl != null && lvl >= 1 && nm) parts.push(nm);
      cur = parentById.get(cur) ?? null;
      depth += 1;
    }
    return parts.reverse().join(" / ") || "—";
  }

  const rows: SnagRow[] = issues.map((i) => ({
    id: i.id,
    description: i.description,
    category: i.category,
    severity: i.severity,
    status: i.status,
    contractorName: i.wbsNode?.contractor?.name ?? null,
    activityName: i.wbsNode?.name ?? null,
    location: locationFor(i.wbsNode?.id ?? null),
    createdByName: i.createdBy?.name ?? null,
    assignedToName: i.assignedTo?.name ?? null,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    photos: i.photos.map((p) => ({ id: p.id, url: p.url })),
  }));

  const contractorNames = Array.from(new Set(contractors.map((c) => c.name)));

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
              <Bug className="w-5 h-5 text-stone-500" />
              Snag Master
            </h1>
            {project.code && (
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
                {project.code}
              </span>
            )}
          </div>
          <p className="text-sm text-stone-500 mt-1">
            All snags across the project. Filter, search and download as CSV.
          </p>
        </div>

        <SnagMasterTable
          rows={rows}
          contractors={contractorNames}
          canManage={canManage}
          assignableUsers={users}
        />
      </main>
    </div>
  );
}
