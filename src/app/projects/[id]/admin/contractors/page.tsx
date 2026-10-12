import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { canCreateProject, canSeeDesktop } from "@/lib/roles";
import { isScopedUser } from "@/lib/modules";
import { prisma } from "@/lib/prisma";
import Navbar from "@/components/Navbar";
import ContractorsVisibilityConsole from "@/components/ContractorsVisibilityConsole";

export const dynamic = "force-dynamic";

/**
 * Admin screen for Contractor.showInPickers.
 *
 * Lists every contractor on the project with a toggle to control
 * whether it shows up in the mobile pickers (New Progress, Inspection,
 * Permit contractor dropdowns). Hidden contractors are not deleted —
 * existing records stay valid, reports still roll them up. The toggle
 * only affects what the raiser sees when creating something new.
 *
 * Written 2026-10-12 (Vandana). The three labour-supply vendors
 * (Achyutananda Naik, Nilakar, Sanjay Das) that the Oct 1 safety
 * induction import auto-created are the current targets to hide.
 */
export default async function ContractorsAdminPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");
  if (isScopedUser(session.user.modules)) redirect("/mobile");
  if (!canCreateProject(session.user.role)) {
    redirect(`/projects/${(await params).id}/overview`);
  }

  const { id: projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const contractors = await prisma.contractor.findMany({
    where: { projectId, active: true },
    select: {
      id: true,
      name: true,
      category: true,
      showInPickers: true,
      _count: {
        select: {
          progressEntries: true,
          manpowerEntries: true,
          workPermits: true,
          safetyInductions: true,
          inspections: true,
          wbsNodes: true,
        },
      },
    },
    orderBy: [{ showInPickers: "desc" }, { name: "asc" }],
  });

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
            Contractors in Pickers
          </h1>
          <p className="text-sm text-stone-500 mt-1 max-w-xl">
            Choose which contractors appear in the mobile pickers (New
            Progress, Inspection, Permit, Safety Induction). Hiding a
            contractor here does NOT delete it, existing records stay
            attached and reports still include it. Only new entries will
            no longer see it as a pickable option.
          </p>
        </div>

        <ContractorsVisibilityConsole projectId={projectId} initial={contractors} />
      </main>
    </div>
  );
}
