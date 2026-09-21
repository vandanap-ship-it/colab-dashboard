import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { HelpCircle, CheckCircle2, Lock, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";
import { RFI_STATUSES, RFI_STATUS_LABELS, RFI_CATEGORY_LABELS, formatRfiNumber, type RfiStatus, type RfiCategory } from "@/lib/rfi";

export const dynamic = "force-dynamic";

/**
 * Mobile RFI list — matches the Issues list shape (open / answered / closed
 * tabs, sticky nav, cream cards) so the two workflows read as siblings.
 * Rows link into a mobile detail page with the answer / close / reopen bar.
 */

type Tab = "open" | "answered" | "closed";
const VALID_TABS: readonly Tab[] = ["open", "answered", "closed"] as const;
function normaliseTab(v: string | undefined): Tab {
  return (VALID_TABS as readonly string[]).includes(v ?? "") ? (v as Tab) : "open";
}
const STATUS_FOR_TAB: Record<Tab, RfiStatus> = {
  open: "OPEN",
  answered: "ANSWERED",
  closed: "CLOSED",
};

export default async function MobileRfiListPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { projectId } = await params;
  const { tab: tabParam } = await searchParams;
  const tab = normaliseTab(tabParam);

  if (!canAccessModule(session.user.modules, MODULES.RFI)) {
    redirect(`/mobile/${projectId}`);
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const baseWhere = { projectId, deletedAt: null };
  const [rfis, statusCounts] = await Promise.all([
    prisma.rfi.findMany({
      where: { ...baseWhere, status: STATUS_FOR_TAB[tab] },
      // OPEN sorted by priority + date; answered/closed by most-recent.
      orderBy:
        tab === "open"
          ? [{ priority: "desc" }, { createdAt: "desc" }]
          : [{ updatedAt: "desc" }],
      take: 100,
      select: {
        id: true,
        number: true,
        subject: true,
        category: true,
        priority: true,
        status: true,
        dueDate: true,
        createdAt: true,
        raisedBy: { select: { name: true } },
        assignedTo: { select: { name: true } },
        wbsNode: { select: { name: true } },
        _count: { select: { photos: true } },
      },
    }),
    prisma.rfi.groupBy({
      by: ["status"],
      where: baseWhere,
      _count: { _all: true },
    }),
  ]);
  void RFI_STATUSES;

  const countByStatus = new Map<string, number>();
  for (const g of statusCounts) countByStatus.set(g.status, g._count._all);

  return (
    <div className="flex-1 flex flex-col bg-ivory min-h-0">
      <div
        className="px-5 pt-5 pb-4 border-b border-sandstone-100"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="font-serif text-[28px] leading-tight text-ink tracking-tight">
            RFIs
          </h1>
          <Link
            href={`/mobile/${projectId}/rfi/new`}
            className="inline-flex items-center gap-1 rounded-full bg-ink text-cream text-[12px] font-semibold px-3 py-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            New
          </Link>
        </div>
      </div>

      <nav className="sticky top-12 z-10 bg-ivory/95 backdrop-blur-md border-b border-stone-200 px-4">
        <div className="flex items-center gap-1 -mb-px overflow-x-auto">
          <TabLink projectId={projectId} tab="open" current={tab} label="Open" count={countByStatus.get("OPEN") ?? 0} icon={HelpCircle} />
          <TabLink projectId={projectId} tab="answered" current={tab} label="Answered" count={countByStatus.get("ANSWERED") ?? 0} icon={CheckCircle2} />
          <TabLink projectId={projectId} tab="closed" current={tab} label="Closed" count={countByStatus.get("CLOSED") ?? 0} icon={Lock} />
        </div>
      </nav>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {rfis.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <ul className="space-y-2">
            {rfis.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/mobile/${projectId}/rfi/${r.id}?tab=${tab}`}
                  className="rounded-2xl border border-sandstone-100 bg-cream shadow-soft p-4 block active:bg-sandstone-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-mono font-semibold text-ferrous-600 tracking-wider">
                        {formatRfiNumber(r.number)}
                      </div>
                      <div className="text-[15px] font-semibold text-ink leading-snug line-clamp-2 mt-0.5">
                        {r.subject}
                      </div>
                      <div className="text-[12px] text-ink-3 mt-1">
                        {r.raisedBy?.name ?? "—"}
                        {r.wbsNode?.name ? ` · ${r.wbsNode.name}` : ""}
                      </div>
                      <div className="text-[11px] text-ink-3 mt-0.5 flex items-center gap-2 flex-wrap">
                        <span>{fmtDate(r.createdAt)}</span>
                        {r.assignedTo?.name && (
                          <>
                            <span>·</span>
                            <span>to {r.assignedTo.name}</span>
                          </>
                        )}
                        {r.dueDate && (
                          <>
                            <span>·</span>
                            <span>due {fmtDate(r.dueDate)}</span>
                          </>
                        )}
                        {r._count.photos > 0 && (
                          <>
                            <span>·</span>
                            <span>{r._count.photos} photo{r._count.photos === 1 ? "" : "s"}</span>
                          </>
                        )}
                        <span>·</span>
                        <span>{RFI_CATEGORY_LABELS[r.category as RfiCategory] ?? r.category}</span>
                      </div>
                    </div>
                    <PriorityPill priority={r.priority} />
                  </div>
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
  projectId,
  tab,
  current,
  label,
  count,
  icon: Icon,
}: {
  projectId: string;
  tab: Tab;
  current: Tab;
  label: string;
  count?: number;
  icon: typeof HelpCircle;
}) {
  const active = tab === current;
  return (
    <Link
      href={`/mobile/${projectId}/rfi?tab=${tab}`}
      className={
        "inline-flex items-center gap-1.5 py-2 px-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors " +
        (active
          ? "border-stone-900 text-stone-900"
          : "border-transparent text-stone-500 hover:text-stone-900")
      }
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
      {count != null && count > 0 && (
        <span
          className={
            "rounded-full text-[10px] font-bold px-1.5 py-0.5 min-w-[18px] text-center tabular-nums " +
            (active ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-700")
          }
        >
          {count}
        </span>
      )}
    </Link>
  );
}

function PriorityPill({ priority }: { priority: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    HIGH: { bg: "bg-red-50 ring-red-200", fg: "text-red-800", label: "High" },
    MEDIUM: { bg: "bg-amber-50 ring-amber-200", fg: "text-amber-800", label: "Med" },
    LOW: { bg: "bg-stone-50 ring-stone-200", fg: "text-stone-700", label: "Low" },
  };
  const cfg = map[priority];
  if (!cfg) return null;
  return (
    <span className={`inline-flex items-center rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold shrink-0 ${cfg.bg} ${cfg.fg}`}>
      {cfg.label}
    </span>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  const copy = {
    open: "No open RFIs. Raise one when you're stuck waiting on an answer.",
    answered: "No answered RFIs yet.",
    closed: "No closed RFIs on record.",
  }[tab];
  return (
    <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-8 text-center">
      <HelpCircle className="w-6 h-6 text-stone-300 mx-auto" />
      <p className="text-sm text-stone-500 mt-2">{copy}</p>
      <p className="text-[11px] text-stone-400 mt-1">Status: {RFI_STATUS_LABELS[STATUS_FOR_TAB[tab]]}</p>
    </div>
  );
}

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
