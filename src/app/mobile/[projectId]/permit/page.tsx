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
    <div>
      {/* Sandstone hero band matching every other mobile screen — Fraunces
          title, ferrous eyebrow. New Permit button lives in the same
          top-right slot the QA/QC + EHS list uses so muscle memory carries. */}
      <div
        className="px-5 pt-5 pb-4 border-b border-sandstone-100"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        <p className="font-serif italic text-[13px] text-ferrous-600 tracking-wide">
          Hot work · night work · deshuttering
        </p>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <h1 className="font-serif text-[28px] leading-tight text-ink tracking-tight">
            Work permits
          </h1>
          <Link
            href={`/mobile/${projectId}/permit/new`}
            className="inline-flex items-center gap-1.5 rounded-full bg-ink text-cream text-[12px] font-semibold px-3 py-1.5 shrink-0"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            New
          </Link>
        </div>
      </div>

      <div className="px-5 py-4">
        <WorkPermitList
          projectId={projectId}
          currentUserId={session.user.id}
          isFullAccess={hasFullAccess(session.user.modules)}
        />
      </div>
    </div>
  );
}
