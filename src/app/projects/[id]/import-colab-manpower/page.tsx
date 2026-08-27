import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import Navbar from "@/components/Navbar";
import ColabManpowerImportForm from "@/components/ColabManpowerImportForm";

export const dynamic = "force-dynamic";

export default async function ImportColabManpowerPage({
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
            Import CollabTools daily manpower
          </h1>
          <p className="text-sm text-stone-500 mt-1">
            Upload the daily-manpower CSV from CollabTools. Populates the
            TradePlan (planned headcount runs) + ManpowerEntry (actual headcount
            per day) tables so the Daily Scorecard §4 and Weekly Report §3
            reflect real historical numbers.
          </p>
          <p className="text-xs text-stone-400 mt-2">
            Idempotent — safe to re-run every time a fresh Colab export lands.
            Colab-sourced TradePlan rows are tagged with <code>notes=&quot;imported-from-colab&quot;</code>
            and get rewritten on re-import; anything set by hand in the admin
            console stays untouched.
          </p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-6">
          <ColabManpowerImportForm projectId={projectId} />
        </div>
      </main>
    </div>
  );
}
