import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, FileStack } from "lucide-react";
import { auth } from "@/lib/auth";
import { canManageDrawings, canSeeDesktop } from "@/lib/roles";
import { isScopedUser } from "@/lib/modules";
import { prisma } from "@/lib/prisma";
import Navbar from "@/components/Navbar";
import DrawingsManager from "@/components/DrawingsManager";

export default async function DrawingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");
  const { id: projectId } = await params;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, code: true },
  });
  if (!project) notFound();

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      <Navbar />
      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div>
          <Link
            href={`/projects/${project.id}/snapshot`}
            className="inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-900 transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to {project.name}
          </Link>
          <div className="flex items-baseline gap-3 mt-2 flex-wrap">
            <h1 className="text-2xl font-semibold text-stone-900 tracking-tight inline-flex items-center gap-2">
              <FileStack className="w-5 h-5 text-stone-500" />
              Drawing Register
            </h1>
            {project.code && (
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
                {project.code}
              </span>
            )}
          </div>
          <p className="text-sm text-stone-500 mt-1">
            All design drawings with the current revision. Engineers reference; the planning team adds and revises.
          </p>
        </div>

        <DrawingsManager
          projectId={project.id}
          canManage={canManageDrawings(session.user.role) && !isScopedUser(session.user.modules)}
        />
      </main>
    </div>
  );
}
