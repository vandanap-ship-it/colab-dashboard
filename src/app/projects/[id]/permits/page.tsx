import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";
import { canCreateProject } from "@/lib/roles";
import Navbar from "@/components/Navbar";
import PermitsManager, { type PermitRow } from "@/components/PermitsManager";

export const dynamic = "force-dynamic";

export default async function PermitsPage({ params }: { params: Promise<{ id: string }> }) {
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

  const [permits, users] = await Promise.all([
    prisma.permit.findMany({
      where: { projectId },
      orderBy: [{ expiryDate: "asc" }, { name: "asc" }],
      include: { responsible: { select: { id: true, name: true } } },
    }),
    prisma.user.findMany({
      where: {
        active: true,
        role: { in: ["PLANNER", "PRODUCT_TEAM", "ADMIN", "SITE_MANAGER"] },
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const rows: PermitRow[] = permits.map((p) => ({
    id: p.id,
    name: p.name,
    number: p.number,
    issuingAuthority: p.issuingAuthority,
    category: p.category,
    issuedDate: p.issuedDate.toISOString(),
    expiryDate: p.expiryDate?.toISOString() ?? null,
    storedStatus: p.status,
    renewalReminderDays: p.renewalReminderDays,
    responsibleName: p.responsible?.name ?? null,
    documentUrl: p.documentUrl,
    notes: p.notes,
  }));

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
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight mt-2">Permits</h1>
          <p className="text-sm text-stone-500 mt-1">
            Regulatory approvals with renewal alerts. Rows in red are expired; orange are within their renewal reminder window.
          </p>
        </div>
        <PermitsManager
          projectId={projectId}
          permits={rows}
          users={users}
          canManage={canCreateProject(session.user.role)}
        />
      </main>
    </div>
  );
}
