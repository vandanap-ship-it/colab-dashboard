import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { canCreateProject, canSeeDesktop } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import Navbar from "@/components/Navbar";
import ContractorAssignConsole from "@/components/ContractorAssignConsole";

export const dynamic = "force-dynamic";

export default async function ContractorAssignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");
  if (!canCreateProject(session.user.role)) {
    // Admin + Planner only — same gate as project creation.
    redirect(`/projects/${(await params).id}/overview`);
  }

  const { id: projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      <Navbar />
      <main className="flex-1 w-full max-w-3xl mx-auto px-6 py-8 space-y-6">
        <div>
          <Link
            href={`/projects/${projectId}/overview`}
            className="inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-900"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to {project.name}
          </Link>
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight mt-2">
            Bulk Contractor Assignment
          </h1>
          <p className="text-sm text-stone-500 mt-1 max-w-xl">
            Assign a contractor to every WBS activity currently untagged, or
            scope by block / villa. Reports that group by contractor read
            <code className="mx-1 font-mono text-xs bg-stone-100 px-1 py-0.5 rounded">WBSNode.contractorId</code>
            — activities without a tag fall out of those groupings.
          </p>
        </div>

        <ContractorAssignConsole projectId={projectId} />
      </main>
    </div>
  );
}
