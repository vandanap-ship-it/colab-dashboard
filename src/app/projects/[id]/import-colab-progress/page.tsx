import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import Navbar from "@/components/Navbar";
import ColabProgressImportForm from "@/components/ColabProgressImportForm";

export const dynamic = "force-dynamic";

/**
 * One-time importer for the CollabTools progress-history CSV.
 * Admin-only. Dry-run by default so a user always previews the match report
 * before writing to the DB.
 */
export default async function ImportColabProgressPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!isAdmin(session.user.role)) redirect(`/projects/${(await params).id}/snapshot`);

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
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">
            Import CollabTools progress history
          </h1>
          <p className="text-sm text-stone-500 mt-1">
            Upload the master progress export CSV from CollabTools. Each row is
            mapped to a WBS activity in Siddhi, and the corresponding
            VillaMilestone rolls up automatically. <strong>Runs as a dry-run first</strong> — you review the
            match report, then re-run with &quot;write to DB&quot; enabled.
          </p>
          <p className="text-xs text-stone-400 mt-2">
            Idempotent — safe to re-run. Existing ProgressEntry rows keyed on <code>colab:&lt;Activity_ID&gt;:&lt;date&gt;</code> are updated in place instead of duplicated.
          </p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-6">
          <ColabProgressImportForm projectId={projectId} />
        </div>
      </main>
    </div>
  );
}
