import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import Navbar from "@/components/Navbar";
import MspImportForm from "@/components/executive/MspImportForm";

export const dynamic = "force-dynamic";

export default async function ImportMspPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!isAdmin(session.user.role)) {
    // Non-admins get bounced to the project snapshot.
    redirect(`/projects/${(await params).id}/snapshot`);
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
      <main className="flex-1 w-full max-w-2xl mx-auto px-6 py-8 space-y-4">
        <Link
          href={`/projects/${projectId}/overview`}
          className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-900"
        >
          <ChevronLeft className="w-3 h-3" />
          Back to {project.name}
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Import MSP schedule</h1>
          <p className="text-sm text-stone-500 mt-1">
            Upload the CSV produced by <code className="font-mono text-xs bg-stone-100 px-1.5 py-0.5 rounded">scripts/convert-mpp.py</code>{" "}
            (or exported directly from MS Project as CSV). Populates the
            Block / Villa / MilestoneSection / VillaMilestone / WBSNode tables that feed the
            Overview, Layout, Timeline, Look-ahead, and Milestone Matrix views.
          </p>
          <p className="text-xs text-stone-400 mt-2">
            Idempotent — safe to re-run on every MSP update. Existing records are updated in place.
          </p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-6">
          <MspImportForm defaultProjectName={project.name} />
        </div>
      </main>
    </div>
  );
}
