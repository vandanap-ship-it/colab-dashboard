import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";
import Navbar from "@/components/Navbar";
import RfiForm from "@/components/RfiForm";

export const dynamic = "force-dynamic";

export default async function NewRfiPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canAccessModule(session.user.modules, MODULES.RFI)) {
    redirect(`/projects/${(await params).id}/snapshot`);
  }

  const { id: projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  // Assignable users = internal staff (planners, product, admin, site managers).
  // Externals scoped to other modules aren't likely RFI recipients.
  const users = await prisma.user.findMany({
    where: {
      active: true,
      role: { in: ["PLANNER", "PRODUCT_TEAM", "ADMIN", "SITE_MANAGER"] },
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      <Navbar />
      <main className="flex-1 w-full max-w-3xl mx-auto px-6 py-8 space-y-4">
        <Link
          href={`/projects/${projectId}/rfi`}
          className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-900"
        >
          <ChevronLeft className="w-3 h-3" />
          Back to RFIs
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Raise an RFI</h1>
          <p className="text-sm text-stone-500 mt-1">
            {project.name} · The assignee will receive an email if one is set.
          </p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-6">
          <RfiForm projectId={projectId} users={users} redirectTo={`/projects/${projectId}/rfi`} />
        </div>
      </main>
    </div>
  );
}
