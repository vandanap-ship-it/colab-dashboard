import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MessageSquare, CheckCircle2, Clock, UserCheck, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";
import { concernAgeFor } from "@/lib/queueAge";

export const dynamic = "force-dynamic";

/**
 * Mobile "Areas of Concern" list — a quieter cousin of the Issues list. A
 * concern is a heads-up the site raises (leak forming, something off with a
 * finish, safety near-miss) that hasn't been formalised into a snag yet.
 * Statuses: PENDING (default) → READ → RESOLVED, or → TASK_ASSIGNED when a
 * planner delegates the follow-up to a specific person.
 */

type Tab = "pending" | "read" | "task_assigned" | "resolved";
const VALID_TABS: readonly Tab[] = ["pending", "read", "task_assigned", "resolved"] as const;
function normaliseTab(v: string | undefined): Tab {
  return (VALID_TABS as readonly string[]).includes(v ?? "") ? (v as Tab) : "pending";
}
const STATUS_FOR_TAB: Record<Tab, string> = {
  pending: "PENDING",
  read: "READ",
  task_assigned: "TASK_ASSIGNED",
  resolved: "RESOLVED",
};

export default async function MobileConcernListPage({
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

  if (!canAccessModule(session.user.modules, MODULES.CONCERN)) {
    redirect(`/mobile/${projectId}`);
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const baseWhere = { projectId, deletedAt: null };
  const [concerns, statusCounts] = await Promise.all([
    prisma.concern.findMany({
      where: { ...baseWhere, status: STATUS_FOR_TAB[tab] },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        description: true,
        status: true,
        createdAt: true,
        raisedBy: { select: { name: true } },
        assignedTo: { select: { name: true } },
        wbsNode: { select: { name: true } },
        _count: { select: { photos: true } },
      },
    }),
    prisma.concern.groupBy({
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
            Concerns
          </h1>
          <Link
            href={`/mobile/${projectId}/concern/new`}
            className="inline-flex items-center gap-1 rounded-full bg-ink text-cream text-[12px] font-semibold px-3 py-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            New
          </Link>
        </div>
      </div>

      <nav className="sticky top-12 z-10 bg-ivory/95 backdrop-blur-md border-b border-stone-200 px-4">
        <div className="flex items-center gap-1 -mb-px overflow-x-auto">
          <TabLink projectId={projectId} tab="pending" current={tab} label="Pending" count={countByStatus.get("PENDING") ?? 0} icon={Clock} />
          <TabLink projectId={projectId} tab="read" current={tab} label="Read" count={countByStatus.get("READ") ?? 0} icon={MessageSquare} />
          <TabLink projectId={projectId} tab="task_assigned" current={tab} label="Assigned" count={countByStatus.get("TASK_ASSIGNED") ?? 0} icon={UserCheck} />
          <TabLink projectId={projectId} tab="resolved" current={tab} label="Resolved" count={countByStatus.get("RESOLVED") ?? 0} icon={CheckCircle2} />
        </div>
      </nav>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {concerns.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <ul className="space-y-2">
            {concerns.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/mobile/${projectId}/concern/${c.id}?tab=${tab}`}
                  className="rounded-2xl border border-sandstone-100 bg-cream shadow-soft p-4 block active:bg-sandstone-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-[14px] text-ink leading-snug line-clamp-3 min-w-0 flex-1">
                      {c.description}
                    </div>
                    {/* Aging cue only on PENDING — once someone READs
                        or a task is assigned, the aging signal has
                        already been acknowledged. */}
                    {c.status === "PENDING" && <ConcernAgingChip createdAt={c.createdAt} />}
                  </div>
                  <div className="text-[12px] text-ink-3 mt-1.5">
                    {c.raisedBy?.name ?? "—"}
                    {c.wbsNode?.name ? ` · ${c.wbsNode.name}` : ""}
                  </div>
                  <div className="text-[11px] text-ink-3 mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>{fmtDate(c.createdAt)}</span>
                    {c.assignedTo?.name && (
                      <>
                        <span>·</span>
                        <span>to {c.assignedTo.name}</span>
                      </>
                    )}
                    {c._count.photos > 0 && (
                      <>
                        <span>·</span>
                        <span>{c._count.photos} photo{c._count.photos === 1 ? "" : "s"}</span>
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
      href={`/mobile/${projectId}/concern?tab=${tab}`}
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
    pending: "No pending concerns. Raise one from the home tile when something feels off.",
    read: "Nothing here — concerns move to Read once someone opens them.",
    task_assigned: "No concerns are actively assigned to someone.",
    resolved: "No resolved concerns on record yet.",
  }[tab];
  return (
    <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-8 text-center">
      <MessageSquare className="w-6 h-6 text-stone-300 mx-auto" />
      <p className="text-sm text-stone-500 mt-2">{copy}</p>
    </div>
  );
}

/**
 * Age pill for PENDING concerns. Silent for 0-1d (a heads-up filed
 * today is being triaged); sandstone at 2d; ferrous at 5d, where a
 * pending concern reads as a supervision gap.
 */
function ConcernAgingChip({ createdAt }: { createdAt: Date }) {
  const age = concernAgeFor(createdAt);
  if (age.tier === "fresh") return null;
  const cls =
    age.tier === "stale"
      ? "bg-ferrous-50 ring-ferrous-200 text-ferrous-700"
      : "bg-sandstone-100 ring-sandstone-200 text-ink-2";
  return (
    <span
      className={`inline-flex items-center rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold shrink-0 tabular-nums ${cls}`}
      title={`Raised ${fmtDate(createdAt)} · ${age.days} day${age.days === 1 ? "" : "s"} ago`}
    >
      {age.label}
    </span>
  );
}

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
