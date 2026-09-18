import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ClipboardCheck, ArrowLeft, Plus, AlertTriangle, CheckCircle2, X, Clock } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";
import { canReview } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * Mobile QA/QC list — replaces the "tap goes to desktop /qaqc" fallback
 * with a phone-native list of inspections. Four tabs:
 *
 *   - My Pending — inspections still IN_REVIEW that this user filled OR is
 *     eligible to review. Landing tab, so the reviewer sees their queue on
 *     first open.
 *   - All       — every inspection in the project (respects module scoping).
 *   - Passed    — status PASSED, most recent first.
 *   - Rejected  — status REJECTED, most recent first.
 *
 * Rows tap into /mobile/[projectId]/qaqc/[id] which does review-in-place.
 */

type Tab = "pending" | "all" | "passed" | "rejected";

const VALID_TABS: readonly Tab[] = ["pending", "all", "passed", "rejected"] as const;
function normaliseTab(v: string | undefined): Tab {
  return (VALID_TABS as readonly string[]).includes(v ?? "") ? (v as Tab) : "pending";
}

// Module filter · when the home splits QA / QC and EHS into separate
// tiles, we route each to /mobile/[projectId]/qaqc?module=QAQC|SAFETY so
// the same list component filters and titles itself for the right team.
// Falls through to the combined view when no module is given, which is
// how internal staff can still see everything in one place if they
// deep-link without the param.
type ModuleFilter = "QAQC" | "SAFETY" | null;
function normaliseModule(v: string | undefined): ModuleFilter {
  if (v === "QAQC" || v === "SAFETY") return v;
  return null;
}
function moduleTitle(m: ModuleFilter): string {
  if (m === "SAFETY") return "EHS";
  if (m === "QAQC") return "QA / QC";
  return "QA / QC · EHS";
}
function moduleTilePath(projectId: string, m: ModuleFilter, tab: Tab): string {
  const qs = new URLSearchParams({ tab });
  if (m) qs.set("module", m);
  return `/mobile/${projectId}/qaqc?${qs.toString()}`;
}

export default async function MobileQaqcPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ tab?: string; module?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { projectId } = await params;
  const { tab: tabParam, module: moduleParam } = await searchParams;
  const tab = normaliseTab(tabParam);
  let moduleFilter = normaliseModule(moduleParam);

  if (
    !canAccessModule(session.user.modules, MODULES.QAQC) &&
    !canAccessModule(session.user.modules, MODULES.SAFETY)
  ) {
    redirect(`/mobile/${projectId}`);
  }

  // Scoped-user safety: a QAQC-only contractor requesting ?module=SAFETY
  // (or vice-versa) gets silently narrowed to what they can see, so a
  // hand-crafted URL can't bypass isolation. Internal staff keep the full
  // combined view when no module param is given.
  const canSeeQAQC = canAccessModule(session.user.modules, MODULES.QAQC);
  const canSeeSafety = canAccessModule(session.user.modules, MODULES.SAFETY);
  if (moduleFilter === "QAQC" && !canSeeQAQC) moduleFilter = "SAFETY";
  if (moduleFilter === "SAFETY" && !canSeeSafety) moduleFilter = "QAQC";

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const userId = session.user.id;
  const iCanReview = canReview(session.user.role);

  // Base filter. All tabs share it, plus the optional module filter so
  // counts and rows both match the requested view.
  const baseWhere = {
    projectId,
    deletedAt: null,
    ...(moduleFilter ? { module: moduleFilter } : {}),
  } as const;

  // Tab → status filter. `pending` shows IN_REVIEW inspections the current
  // user should care about (they filled it OR they can review it), which is
  // the queue people actually want to walk on their phone.
  const tabWhere = (() => {
    if (tab === "passed") return { ...baseWhere, status: "PASSED" };
    if (tab === "rejected") return { ...baseWhere, status: "REJECTED" };
    if (tab === "pending") {
      return iCanReview
        ? { ...baseWhere, status: "IN_REVIEW" }
        : { ...baseWhere, status: "IN_REVIEW", filledById: userId };
    }
    return baseWhere;
  })();

  // Counts for the tab badges. Cheap groupBy — same three status values the
  // list surfaces, so the pills stay accurate as inspections move.
  const [inspections, statusCounts] = await Promise.all([
    prisma.inspection.findMany({
      where: tabWhere,
      orderBy: { createdAt: "desc" },
      take: 100, // Cap for perf. Amanvana has ~110 total; realistic tabs stay well under.
      select: {
        id: true,
        title: true,
        status: true,
        module: true,
        createdAt: true,
        filledBy: { select: { name: true } },
        wbsNode: { select: { name: true } },
        _count: { select: { photos: true, items: true } },
      },
    }),
    prisma.inspection.groupBy({
      by: ["status"],
      where: baseWhere,
      _count: { _all: true },
    }),
  ]);

  const countByStatus = new Map<string, number>();
  for (const g of statusCounts) countByStatus.set(g.status, g._count._all);
  const pendingCount = iCanReview
    ? (countByStatus.get("IN_REVIEW") ?? 0)
    : await prisma.inspection.count({
        where: { ...baseWhere, status: "IN_REVIEW", filledById: userId },
      });

  return (
    <div className="flex-1 flex flex-col bg-ivory min-h-0">
      {/* Header — title tracks the module filter so a QA/QC-only view
          reads "QA / QC" and an EHS-only view reads "EHS". */}
      <div className="px-4 pt-4 pb-3">
        <Link
          href={`/mobile/${projectId}`}
          className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-900"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </Link>
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-bold text-stone-900 tracking-tight">
            {moduleTitle(moduleFilter)}
          </h1>
          <Link
            // New WIR carries the module filter forward so a New button
            // pressed from EHS creates a SAFETY-scoped inspection.
            href={`/mobile/${projectId}/inspection/new${moduleFilter ? `?module=${moduleFilter}` : ""}`}
            className="inline-flex items-center gap-1 rounded-full bg-stone-900 text-white text-xs font-semibold px-3 py-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            New WIR
          </Link>
        </div>
      </div>

      {/* Tab bar — sticky so it stays reachable as the list scrolls.
          Each TabLink now carries moduleFilter forward so tabbing keeps
          the same view instead of dropping back to the combined feed. */}
      <nav className="sticky top-12 z-10 bg-ivory/95 backdrop-blur-md border-b border-stone-200 px-4">
        <div className="flex items-center gap-1 -mb-px overflow-x-auto">
          <TabLink projectId={projectId} tab="pending" current={tab} moduleFilter={moduleFilter} label="My Pending" count={pendingCount} icon={Clock} />
          <TabLink projectId={projectId} tab="all" current={tab} moduleFilter={moduleFilter} label="All" icon={ClipboardCheck} />
          <TabLink projectId={projectId} tab="passed" current={tab} moduleFilter={moduleFilter} label="Passed" count={countByStatus.get("PASSED") ?? 0} icon={CheckCircle2} />
          <TabLink projectId={projectId} tab="rejected" current={tab} moduleFilter={moduleFilter} label="Rejected" count={countByStatus.get("REJECTED") ?? 0} icon={AlertTriangle} />
        </div>
      </nav>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {inspections.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <ul className="space-y-2">
            {inspections.map((i) => (
              <li key={i.id}>
                <Link
                  // Detail link carries tab AND module so pressing Back
                  // from the detail returns to the same filtered view
                  // (EHS Passed stays EHS Passed, not QAQC Pending).
                  href={`/mobile/${projectId}/qaqc/${i.id}?tab=${tab}${moduleFilter ? `&module=${moduleFilter}` : ""}`}
                  className="rounded-xl border border-stone-200 bg-white p-4 block active:bg-stone-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-stone-900 leading-snug line-clamp-2">
                        {i.title}
                      </div>
                      <div className="text-[11px] text-stone-500 mt-1">
                        {i.filledBy?.name ?? "—"}
                        {i.wbsNode?.name ? ` · ${i.wbsNode.name}` : ""}
                      </div>
                      <div className="text-[11px] text-stone-400 mt-0.5 flex items-center gap-2">
                        <span>{fmtDate(i.createdAt)}</span>
                        <span>·</span>
                        <span>{i._count.items} item{i._count.items === 1 ? "" : "s"}</span>
                        {i._count.photos > 0 && (
                          <>
                            <span>·</span>
                            <span>{i._count.photos} photo{i._count.photos === 1 ? "" : "s"}</span>
                          </>
                        )}
                        {i.module && (
                          <>
                            <span>·</span>
                            <span>{i.module === "SAFETY" ? "EHS" : "QA/QC"}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <StatusPill status={i.status} />
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

// ---------------------------------------------------------------------------
// Presentational bits
// ---------------------------------------------------------------------------

function TabLink({
  projectId,
  tab,
  current,
  moduleFilter,
  label,
  count,
  icon: Icon,
}: {
  projectId: string;
  tab: Tab;
  current: Tab;
  moduleFilter: ModuleFilter;
  label: string;
  count?: number;
  icon: typeof ClipboardCheck;
}) {
  const active = tab === current;
  return (
    <Link
      href={moduleTilePath(projectId, moduleFilter, tab)}
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

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string; Icon: typeof CheckCircle2 }> = {
    IN_REVIEW: { bg: "bg-amber-50 ring-amber-200", fg: "text-amber-800", label: "In review", Icon: Clock },
    PASSED: { bg: "bg-emerald-50 ring-emerald-200", fg: "text-emerald-800", label: "Passed", Icon: CheckCircle2 },
    REJECTED: { bg: "bg-red-50 ring-red-200", fg: "text-red-800", label: "Rejected", Icon: X },
  };
  const cfg = map[status] ?? map.IN_REVIEW;
  const Icon = cfg.Icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold shrink-0 ${cfg.bg} ${cfg.fg}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  const copy = {
    pending: "Nothing waiting for your review.",
    all: "No inspections logged on this project yet.",
    passed: "No passed inspections yet.",
    rejected: "No rejected inspections. Good.",
  }[tab];
  return (
    <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-8 text-center">
      <ClipboardCheck className="w-6 h-6 text-stone-300 mx-auto" />
      <p className="text-sm text-stone-500 mt-2">{copy}</p>
    </div>
  );
}

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
