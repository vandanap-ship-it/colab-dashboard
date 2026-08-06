import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { canAccessBilling, canLogExpense, canSeeDesktop, isAdmin, ROLES } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import Navbar from "@/components/Navbar";
import ProjectTabs from "@/components/ProjectTabs";
import HighlightsButton from "@/components/HighlightsButton";
import Sidebar from "@/components/Sidebar";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");

  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true, code: true, address: true },
  });
  if (!project) notFound();

  // My Actions badge: matches /api/my-actions semantics — concerns assigned to me +
  // (for planner-ish roles) inspections IN_REVIEW for this project.
  const userId = session.user.id;
  const role = session.user.role;
  const canReviewInspections =
    role === ROLES.PLANNER || role === ROLES.PRODUCT_TEAM || role === ROLES.ADMIN;
  const [concernsAssigned, issuesAssigned, inspectionsInReview] = await Promise.all([
    prisma.concern.count({
      where: { projectId: id, status: { in: ["TASK_ASSIGNED", "PENDING"] }, assignedToId: userId },
    }),
    prisma.issue.count({
      where: { projectId: id, status: "OPEN", assignedToId: userId },
    }),
    canReviewInspections
      ? prisma.inspection.count({ where: { projectId: id, status: "IN_REVIEW" } })
      : Promise.resolve(0),
  ]);
  const myActionsCount = concernsAssigned + issuesAssigned + inspectionsInReview;

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      <Navbar />
      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-900 transition-colors"
            >
              <ArrowLeft className="w-3 h-3" />
              All projects
            </Link>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">
                {project.name}
              </h1>
              {project.code && (
                <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
                  {project.code}
                </span>
              )}
            </div>
            {project.address && (
              <p className="text-sm text-stone-500 mt-1">{project.address}</p>
            )}
          </div>
          {/* Collapsed action row: sidebar has everything else. Only the
              highest-frequency "Project Highlights" stays inline (it's a modal,
              opens without page nav — belongs with the header not the sidebar). */}
          <div className="flex gap-2 shrink-0 items-center">
            <HighlightsButton projectId={project.id} />
            <Sidebar
              projectId={project.id}
              canAccessBilling={canAccessBilling(role)}
              canLogExpense={canLogExpense(role)}
              canImport={isAdmin(role)}
              canManageUsers={isAdmin(role)}
            />
          </div>
        </div>

        <ProjectTabs projectId={project.id} myActionsCount={myActionsCount} />

        {children}
      </main>
    </div>
  );
}
