import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin, ROLES } from "@/lib/roles";
import Navbar from "@/components/Navbar";
import ManpowerConsole, { type ContractorOption, type PlanRow, type EntryRow } from "@/components/ManpowerConsole";
import { TRADES } from "@/lib/manpower";

export const dynamic = "force-dynamic";

/**
 * Admin console for planned + actual daily headcount. Layout:
 *   - Top: date-picker + planned/actual summary strip
 *   - Middle: TradePlan editor (per contractor × trade planned count)
 *   - Bottom: today's actual entries table (read-only view; site engineer
 *     logs from mobile)
 */
export default async function ManpowerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const canEdit =
    isAdmin(session.user.role) ||
    session.user.role === ROLES.PLANNER ||
    session.user.role === ROLES.PRODUCT_TEAM;

  const { id: projectId } = await params;
  const { date: dateParam } = await searchParams;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  // Determine the day we're viewing (default today, UTC midnight).
  const day = (() => {
    if (dateParam) {
      const d = new Date(dateParam + "T00:00:00Z");
      if (!isNaN(d.getTime())) return d;
    }
    const t = new Date();
    t.setUTCHours(0, 0, 0, 0);
    return t;
  })();

  const [contractors, plans, entries] = await Promise.all([
    prisma.contractor.findMany({
      where: { projectId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, category: true },
    }),
    prisma.tradePlan.findMany({
      where: { projectId, deletedAt: null },
      orderBy: [{ contractorId: "asc" }, { trade: "asc" }, { startDate: "desc" }],
      include: { contractor: { select: { id: true, name: true } } },
    }),
    prisma.manpowerEntry.findMany({
      where: {
        projectId,
        entryDate: day,
        deletedAt: null,
      },
      orderBy: [{ contractorId: "asc" }, { trade: "asc" }],
      include: {
        contractor: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    }),
  ]);

  const contractorOptions: ContractorOption[] = contractors.map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category,
  }));

  const planRows: PlanRow[] = plans.map((p) => ({
    id: p.id,
    contractorId: p.contractorId,
    contractorName: p.contractor.name,
    trade: p.trade,
    plannedCount: p.plannedCount,
    startDate: p.startDate.toISOString(),
    endDate: p.endDate?.toISOString() ?? null,
    notes: p.notes,
  }));

  const entryRows: EntryRow[] = entries.map((e) => ({
    id: e.id,
    contractorId: e.contractorId,
    contractorName: e.contractor.name,
    trade: e.trade,
    entryDate: e.entryDate.toISOString(),
    actualCount: e.actualCount,
    notes: e.notes,
    loggedByName: e.createdBy.name,
    loggedAt: e.createdAt.toISOString(),
  }));

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      <Navbar />
      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div>
          <Link
            href={`/projects/${projectId}/overview`}
            className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-900"
          >
            ← Back to {project.name}
          </Link>
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight mt-2">Manpower</h1>
          <p className="text-sm text-stone-500 mt-1">
            Planned daily headcount per trade + today&apos;s actual logged from site.
          </p>
        </div>

        <ManpowerConsole
          projectId={projectId}
          day={day.toISOString().slice(0, 10)}
          contractors={contractorOptions}
          trades={[...TRADES]}
          plans={planRows}
          entries={entryRows}
          canEdit={canEdit}
        />
      </main>
    </div>
  );
}
