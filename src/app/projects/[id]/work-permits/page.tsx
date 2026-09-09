import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PlusCircle } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, hasFullAccess, MODULES } from "@/lib/modules";
import Navbar from "@/components/Navbar";
import WorkPermitList from "@/components/WorkPermitList";

export const dynamic = "force-dynamic";

/**
 * Desktop Work Permits page. Same list + tabs the mobile page shows, wrapped
 * in the standard desktop chrome (Navbar, breadcrumb, max-w container). Lets
 * planners approve permits from a laptop — the mobile-only surface was a
 * launch blocker since planners are the primary approvers.
 *
 * Raising a new permit still routes to the mobile form (`/mobile/[id]/permit/
 * new`) — no reason to duplicate that UI when the same URL renders fine in a
 * desktop browser.
 */
export default async function DesktopWorkPermitsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canAccessModule(session.user.modules, MODULES.PERMIT)) {
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
      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div>
          <Link
            href={`/projects/${projectId}/snapshot`}
            className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-900"
          >
            ← Back to {project.name}
          </Link>
          <div className="mt-2 flex items-baseline justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Work Permits</h1>
              <p className="text-sm text-stone-500 mt-1">
                Daily site work permits — Hot Work, Night Work, De-shuttering, General. Raise, approve, close.
              </p>
            </div>
            <Link
              href={`/mobile/${projectId}/permit/new`}
              className="inline-flex items-center gap-1.5 rounded-full bg-stone-900 hover:bg-stone-800 text-white text-sm font-medium px-4 py-2"
            >
              <PlusCircle className="w-4 h-4" />
              Raise Work Permit
            </Link>
          </div>
        </div>

        <WorkPermitList
          projectId={projectId}
          currentUserId={session.user.id}
          isFullAccess={hasFullAccess(session.user.modules)}
        />
      </main>
    </div>
  );
}
