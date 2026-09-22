import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, CheckCircle2, Plus, Clock } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";
import { reasonLabel } from "@/lib/hindranceReasons";
import { hindranceAgeFor } from "@/lib/queueAge";

export const dynamic = "force-dynamic";

/**
 * Mobile Hindrance list — sibling of Issues and Concerns. Two tabs, Open /
 * Resolved, because that's all the schema exposes (no reinspection loop).
 * Row shows description, dates, days impact, cost impact and responsible
 * contractor so leadership can scan without opening each row.
 */

type Tab = "open" | "resolved";
const VALID_TABS: readonly Tab[] = ["open", "resolved"] as const;
function normaliseTab(v: string | undefined): Tab {
  return (VALID_TABS as readonly string[]).includes(v ?? "") ? (v as Tab) : "open";
}
const STATUS_FOR_TAB: Record<Tab, string> = { open: "OPEN", resolved: "RESOLVED" };

export default async function MobileHindranceListPage({
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

  if (!canAccessModule(session.user.modules, MODULES.HINDRANCE)) {
    redirect(`/mobile/${projectId}`);
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const baseWhere = { projectId, deletedAt: null };
  const [rows, statusCounts] = await Promise.all([
    prisma.hindrance.findMany({
      where: { ...baseWhere, status: STATUS_FOR_TAB[tab] },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        description: true,
        status: true,
        startDate: true,
        endDate: true,
        resolvedDate: true,
        daysImpact: true,
        costImpact: true,
        reasonCode: true,
        responsibleContractor: { select: { name: true } },
        wbsNode: { select: { name: true } },
        _count: { select: { photos: true } },
      },
    }),
    prisma.hindrance.groupBy({
      by: ["status"],
      where: baseWhere,
      _count: { _all: true },
    }),
  ]);

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
            Hindrances
          </h1>
          <Link
            href={`/mobile/${projectId}/hindrance/new`}
            className="inline-flex items-center gap-1 rounded-full bg-ink text-cream text-[12px] font-semibold px-3 py-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            New
          </Link>
        </div>
      </div>

      <nav className="sticky top-12 z-10 bg-ivory/95 backdrop-blur-md border-b border-stone-200 px-4">
        <div className="flex items-center gap-1 -mb-px overflow-x-auto">
          <TabLink projectId={projectId} tab="open" current={tab} label="Open" count={countByStatus.get("OPEN") ?? 0} icon={Clock} />
          <TabLink projectId={projectId} tab="resolved" current={tab} label="Resolved" count={countByStatus.get("RESOLVED") ?? 0} icon={CheckCircle2} />
        </div>
      </nav>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {rows.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <ul className="space-y-2">
            {rows.map((h) => (
              <li key={h.id}>
                <Link
                  href={`/mobile/${projectId}/hindrance/${h.id}?tab=${tab}`}
                  className="rounded-2xl border border-sandstone-100 bg-cream shadow-soft p-4 block active:bg-sandstone-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-[14px] text-ink leading-snug line-clamp-3 min-w-0 flex-1">
                      {h.description}
                    </div>
                    {/* Aging cue for open blockers. Every day an open
                        hindrance sits, someone on site is either idle
                        or reworking around it — so the chip fires at
                        2d and flips ferrous at 3d, tighter than the
                        WIR SLA. Skipped for RESOLVED rows where
                        aging says nothing new. */}
                    {h.status === "OPEN" && <HindranceAgingChip startDate={h.startDate} />}
                  </div>
                  <div className="text-[12px] text-ink-3 mt-1.5">
                    {h.responsibleContractor?.name ?? "—"}
                    {h.wbsNode?.name ? ` · ${h.wbsNode.name}` : ""}
                  </div>
                  <div className="text-[11px] text-ink-3 mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>{fmtDate(h.startDate)}{h.endDate ? ` → ${fmtDate(h.endDate)}` : ""}</span>
                    {h.daysImpact != null && (
                      <>
                        <span>·</span>
                        <span>{h.daysImpact}d impact</span>
                      </>
                    )}
                    {h.costImpact != null && h.costImpact > 0 && (
                      <>
                        <span>·</span>
                        <span>{fmtInr(h.costImpact)}</span>
                      </>
                    )}
                    {h.reasonCode && (
                      <>
                        <span>·</span>
                        <span>{reasonLabel(h.reasonCode)}</span>
                      </>
                    )}
                    {h._count.photos > 0 && (
                      <>
                        <span>·</span>
                        <span>{h._count.photos} photo{h._count.photos === 1 ? "" : "s"}</span>
                      </>
                    )}
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
  icon: typeof Clock;
}) {
  const active = tab === current;
  return (
    <Link
      href={`/mobile/${projectId}/hindrance?tab=${tab}`}
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

function EmptyState({ tab }: { tab: Tab }) {
  const copy = {
    open: "No open hindrances. If something's blocking work, raise one so leadership can move the blocker.",
    resolved: "No resolved hindrances on record yet.",
  }[tab];
  return (
    <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-8 text-center">
      <AlertTriangle className="w-6 h-6 text-stone-300 mx-auto" />
      <p className="text-sm text-stone-500 mt-2">{copy}</p>
    </div>
  );
}

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Age pill for OPEN hindrances. Anchored on startDate — that's when the
 * blocker began, which is what "how long has this been holding us up"
 * measures. Silent for 0-1d (a blocker filed today is being handled
 * right now); sandstone at 2d; ferrous at 3d, where the SLA sits.
 */
function HindranceAgingChip({ startDate }: { startDate: Date }) {
  const age = hindranceAgeFor(startDate);
  if (age.tier === "fresh") return null;
  const cls =
    age.tier === "stale"
      ? "bg-ferrous-50 ring-ferrous-200 text-ferrous-700"
      : "bg-sandstone-100 ring-sandstone-200 text-ink-2";
  return (
    <span
      className={`inline-flex items-center rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold shrink-0 tabular-nums ${cls}`}
      title={`Started ${fmtDate(startDate)} · ${age.days} day${age.days === 1 ? "" : "s"} ago`}
    >
      {age.label}
    </span>
  );
}
function fmtInr(n: number): string {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}k`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
