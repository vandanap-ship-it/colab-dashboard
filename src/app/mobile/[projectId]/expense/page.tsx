import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckCircle2, X, Clock, IndianRupee, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canLogExpense, canApproveExpense } from "@/lib/roles";
import { isScopedUser } from "@/lib/modules";

export const dynamic = "force-dynamic";

/**
 * Mobile Expense list. Site engineers, site managers, planners and admins
 * can log expenses; a Planner / Site Manager / Admin approves. Scoped
 * external contractors are blocked entirely — expenses are internal-only
 * money records that the app tracks (not moves).
 *
 * Three tabs — Submitted (awaiting approval) / Approved / Rejected — with
 * counts on each. Cards show category, description, amount (formatted
 * with the Indian rupee grouping — 1,25,000 not 125,000), date, logger,
 * paid-to when set, photo count.
 */

type Tab = "submitted" | "approved" | "rejected";
const VALID_TABS: readonly Tab[] = ["submitted", "approved", "rejected"] as const;
function normaliseTab(v: string | undefined): Tab {
  return (VALID_TABS as readonly string[]).includes(v ?? "") ? (v as Tab) : "submitted";
}
const STATUS_FOR_TAB: Record<Tab, string> = {
  submitted: "SUBMITTED",
  approved: "APPROVED",
  rejected: "REJECTED",
};

export default async function MobileExpenseListPage({
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

  // Scoped contractors and everyone without either the log OR approve
  // right can't see expenses. Bounce them home rather than showing an
  // empty page.
  if (isScopedUser(session.user.modules)) redirect(`/mobile/${projectId}`);
  if (!(canLogExpense(session.user.role) || canApproveExpense(session.user.role))) {
    redirect(`/mobile/${projectId}`);
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const baseWhere = { projectId, deletedAt: null };
  const [rows, statusCounts] = await Promise.all([
    prisma.expense.findMany({
      where: { ...baseWhere, status: STATUS_FOR_TAB[tab] },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        category: true,
        description: true,
        amount: true,
        date: true,
        paidTo: true,
        status: true,
        loggedBy: { select: { name: true } },
        _count: { select: { photos: true } },
      },
    }),
    prisma.expense.groupBy({
      by: ["status"],
      where: baseWhere,
      _count: { _all: true },
    }),
  ]);

  const countByStatus = new Map<string, number>();
  for (const g of statusCounts) countByStatus.set(g.status, g._count._all);

  const submittedTotal = rows
    .filter((r) => r.status === "SUBMITTED")
    .reduce((sum, r) => sum + r.amount, 0);
  const showTabTotal = tab === "submitted" && submittedTotal > 0;

  return (
    <div className="flex-1 flex flex-col bg-ivory min-h-0">
      <div
        className="px-5 pt-5 pb-4 border-b border-sandstone-100"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="font-serif text-[28px] leading-tight text-ink tracking-tight">
            Expenses
          </h1>
          {canLogExpense(session.user.role) && (
            <Link
              href={`/mobile/${projectId}/expense/new`}
              className="inline-flex items-center gap-1 rounded-full bg-ink text-cream text-[12px] font-semibold px-3 py-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              New
            </Link>
          )}
        </div>
        {showTabTotal && (
          <p className="text-[12px] text-ink-3 mt-1.5">
            <span className="font-semibold text-ferrous-700 tabular-nums">
              {fmtInr(submittedTotal)}
            </span>{" "}
            in review across {rows.length} expense{rows.length === 1 ? "" : "s"}.
          </p>
        )}
      </div>

      <nav className="sticky top-12 z-10 bg-ivory/95 backdrop-blur-md border-b border-stone-200 px-4">
        <div className="flex items-center gap-1 -mb-px overflow-x-auto">
          <TabLink projectId={projectId} tab="submitted" current={tab} label="Submitted" count={countByStatus.get("SUBMITTED") ?? 0} icon={Clock} />
          <TabLink projectId={projectId} tab="approved" current={tab} label="Approved" count={countByStatus.get("APPROVED") ?? 0} icon={CheckCircle2} />
          <TabLink projectId={projectId} tab="rejected" current={tab} label="Rejected" count={countByStatus.get("REJECTED") ?? 0} icon={X} />
        </div>
      </nav>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {rows.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <ul className="space-y-2">
            {rows.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/mobile/${projectId}/expense/${e.id}?tab=${tab}`}
                  className="rounded-2xl border border-sandstone-100 bg-cream shadow-soft p-4 block active:bg-sandstone-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ferrous-600 mb-0.5">
                        {e.category}
                      </div>
                      <div className="text-[14px] text-ink leading-snug line-clamp-2">
                        {e.description}
                      </div>
                      <div className="text-[11.5px] text-ink-3 mt-1 flex items-center gap-2 flex-wrap">
                        <span>{fmtDate(e.date)}</span>
                        <span>·</span>
                        <span>{e.loggedBy?.name ?? "—"}</span>
                        {e.paidTo && (
                          <>
                            <span>·</span>
                            <span>to {e.paidTo}</span>
                          </>
                        )}
                        {e._count.photos > 0 && (
                          <>
                            <span>·</span>
                            <span>{e._count.photos} photo{e._count.photos === 1 ? "" : "s"}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="inline-flex items-center gap-0.5 text-ferrous-700 font-semibold tabular-nums">
                        <IndianRupee className="w-3.5 h-3.5" />
                        <span className="text-[15px]">{fmtInr(e.amount)}</span>
                      </div>
                    </div>
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
      href={`/mobile/${projectId}/expense?tab=${tab}`}
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
    submitted: "No expenses awaiting approval.",
    approved: "No expenses approved yet.",
    rejected: "No rejected expenses. Good.",
  }[tab];
  return (
    <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-8 text-center">
      <IndianRupee className="w-6 h-6 text-stone-300 mx-auto" />
      <p className="text-sm text-stone-500 mt-2">{copy}</p>
    </div>
  );
}

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
/** Indian rupee grouping — 1,25,000 not 125,000. Format as an integer for
 *  ≥ 100 and one decimal below to save horizontal space. */
function fmtInr(n: number): string {
  if (n >= 100) return Math.round(n).toLocaleString("en-IN");
  return n.toFixed(2);
}
