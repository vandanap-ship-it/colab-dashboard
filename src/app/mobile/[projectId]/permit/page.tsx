import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { PlusCircle } from "lucide-react";
import { auth } from "@/lib/auth";
import { canAccessModule, hasFullAccess, MODULES } from "@/lib/modules";
import { prisma } from "@/lib/prisma";
import WorkPermitList from "@/components/WorkPermitList";

export const dynamic = "force-dynamic";

export default async function MobileWorkPermitListPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canAccessModule(session.user.modules, MODULES.PERMIT)) {
    redirect(`/mobile/${(await params).projectId}`);
  }

  const { projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900">Work Permits</h1>
          <p className="text-xs text-stone-500 mt-1">{project.name}</p>
        </div>
        <Link
          href={`/mobile/${projectId}/permit/new`}
          className="inline-flex items-center gap-1.5 rounded-full bg-stone-900 text-white text-xs font-medium px-3 py-1.5"
        >
          <PlusCircle className="w-3.5 h-3.5" />
          New
        </Link>
      </div>

      <WorkPermitList
        projectId={projectId}
        currentUserId={session.user.id}
        isFullAccess={hasFullAccess(session.user.modules)}
      />
    </div>
  );
}
