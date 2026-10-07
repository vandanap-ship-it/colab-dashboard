import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronRight, Clock, FileCheck2, ListChecks } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, type ModuleKey } from "@/lib/modules";
import { istDayString } from "@/lib/istDay";
import { formatDayMonthYear } from "@/lib/dates";
import { getRegisterType, loadRegisterOverview } from "@/lib/registersServer";
import SubmissionStatusPill from "@/components/registers/SubmissionStatusPill";
import RegisterInventory, { type InventoryFilter } from "@/components/registers/RegisterInventory";

export const dynamic = "force-dynamic";

/**
 * One project register on the phone (e.g. Fire Extinguishers).
 *
 *   Inventory tab (default) — the live list: add / edit / retire items,
 *     due-date pills, and the Submit for sign-off entry point.
 *   Sign-offs tab — monthly sign-off history (INV-XXXXXXXX), newest first.
 *
 * Gate: the register type's module (SAFETY). Abhishek maintains + submits;
 * Girish approves from the sign-off detail or My Actions.
 */
type Tab = "inventory" | "signoffs";
const FILTERS: InventoryFilter[] = ["all", "due_soon", "overdue", "retired"];

export default async function MobileRegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; code: string }>;
  searchParams: Promise<{ tab?: string; filter?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId, code } = await params;
  const { tab: tabParam, filter: filterParam } = await searchParams;

  const type = await getRegisterType(code);
  if (!type) notFound();
  if (!canAccessModule(session.user.modules, type.module as ModuleKey)) redirect(`/mobile/${projectId}`);

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) notFound();

  const tab: Tab = tabParam === "signoffs" ? "signoffs" : "inventory";
  const overview = await loadRegisterOverview(projectId, type);

  const tabs = (
    <nav className="flex items-center gap-1 mt-3 -mb-4">
      <TabLink href={`/mobile/${projectId}/registers/${code}`} active={tab === "inventory"} icon={ListChecks} label="Inventory" />
      <TabLink
        href={`/mobile/${projectId}/registers/${code}?tab=signoffs`}
        active={tab === "signoffs"}
        icon={FileCheck2}
        label="Sign-offs"
        badge={overview.pending ? 1 : 0}
      />
    </nav>
  );

  if (tab === "inventory") {
    const initialFilter = (FILTERS as string[]).includes(filterParam ?? "") ? (filterParam as InventoryFilter) : "all";
    return (
      <div className="flex flex-col bg-ivory">
        <RegisterInventory
          title={type.shortName}
          tabs={tabs}
          config={{
            projectId,
            typeCode: type.code,
            shortName: type.shortName,
            columns: type.columns,
            identifierKey: type.identifierKey,
            dueDateKey: type.dueDateKey,
            lastInspectedKey: type.lastInspectedKey,
            defaultIntervalDays: type.defaultIntervalDays,
            villas: overview.villas,
            inspectionTemplateId: overview.inspectionTemplateId,
            todayIso: istDayString(),
          }}
          rows={overview.rows}
          initialFilter={initialFilter}
          pendingSubmission={overview.pending}
          lastApproved={
            overview.lastApproved
              ? {
                  displayId: overview.lastApproved.displayId,
                  approvedOn: formatDayMonthYear(overview.lastApproved.approvedAt),
                }
              : null
          }
          signOffDue={overview.signOffDue}
        />
      </div>
    );
  }

  const submissions = overview.register
    ? await prisma.registerSubmission.findMany({
        where: { registerId: overview.register.id },
        orderBy: { createdAt: "desc" },
        take: 60,
        select: {
          id: true,
          displayId: true,
          asOfDate: true,
          rowCount: true,
          status: true,
          createdAt: true,
          preparedBy: { select: { name: true } },
          approvedBy: { select: { name: true } },
          rejectedBy: { select: { name: true } },
        },
      })
    : [];

  return (
    <div className="flex flex-col bg-ivory">
      <div
        className="px-5 pt-5 pb-4 border-b border-sandstone-100"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        <h1 className="font-serif text-[28px] leading-tight text-ink tracking-tight">{type.shortName}</h1>
        {tabs}
      </div>
      <div className="px-4 py-4">
        {submissions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-8 text-center">
            <FileCheck2 className="w-6 h-6 text-stone-300 mx-auto" />
            <p className="text-sm text-stone-500 mt-2">No sign-offs yet. Submit the register from the Inventory tab.</p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {submissions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/mobile/${projectId}/registers/${code}/submissions/${s.id}`}
                  className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white shadow-sm p-3.5 active:bg-stone-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[15px] font-bold text-ink">{s.displayId}</span>
                      <SubmissionStatusPill status={s.status} />
                    </div>
                    <p className="text-[12px] text-ink-3 mt-0.5">
                      As of {formatDayMonthYear(s.asOfDate)} · {s.rowCount} item{s.rowCount === 1 ? "" : "s"}
                    </p>
                    <p className="text-[11px] text-stone-500 mt-0.5 truncate">
                      By {s.preparedBy.name}
                      {s.approvedBy ? ` · approved by ${s.approvedBy.name}` : ""}
                      {s.rejectedBy ? ` · rejected by ${s.rejectedBy.name}` : ""}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-stone-400 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TabLink({
  href,
  active,
  icon: Icon,
  label,
  badge,
}: {
  href: string;
  active: boolean;
  icon: typeof Clock;
  label: string;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className={
        "inline-flex items-center gap-1.5 py-2 px-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors " +
        (active ? "border-stone-900 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-900")
      }
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
      {!!badge && (
        <span className="rounded-full text-[10px] font-bold px-1.5 py-0.5 min-w-[18px] text-center tabular-nums bg-amber-100 text-amber-800">
          {badge}
        </span>
      )}
    </Link>
  );
}
