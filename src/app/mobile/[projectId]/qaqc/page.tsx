import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ClipboardCheck, Plus, AlertTriangle, CalendarClock, CheckCircle2, FileEdit, X, Clock } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";
import { canReview } from "@/lib/roles";
import { wirAgeFor } from "@/lib/queueAge";

export const dynamic = "force-dynamic";

/**
 * Mobile QA/QC list — replaces the "tap goes to desktop /qaqc" fallback
 * with a phone-native list of inspections. Six tabs:
 *
 *   - My Pending    — inspections still IN_REVIEW that this user filled OR
 *                     is eligible to review. Landing tab, so the reviewer
 *                     sees their queue on first open.
 *   - All           — every inspection in the project (respects module
 *                     scoping). Drafts are excluded here — a draft is a
 *                     private in-progress checklist, not project state.
 *   - Rescheduled   — status RESCHEDULED, sorted by rescheduledFor asc so
 *                     the soonest reopen is first.
 *   - Passed        — status PASSED, most recent first.
 *   - Rejected      — status REJECTED, most recent first.
 *   - My Drafts     — status DRAFT, filtered to the current user's own
 *                     drafts. Reviewers see only their own drafts here
 *                     too; no one ever sees anyone else's draft.
 *
 * Rows tap into /mobile/[projectId]/qaqc/[id] which does review-in-place.
 */

type Tab = "pending" | "all" | "rescheduled" | "passed" | "rejected" | "drafts";

const VALID_TABS: readonly Tab[] = ["pending", "all", "rescheduled", "passed", "rejected", "drafts"] as const;
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

  // Scoped contractor filter: when a user is scoped AND isn't a
  // reviewer (i.e., SITE_ENGINEER / SITE_MANAGER outside canReview),
  // narrow every tab query to WIRs they filled. A contractor like
  // Nagarjuna doesn't need to see peer contractors' passed / rejected
  // WIRs — this page is their "status of what I raised" board.
  // Scoped reviewers (like Thangamani, scoped QAQC + PLANNER) still
  // see every WIR in scope so they can review peers' rows.
  const isScopedRaiser = !!session.user.modules && !iCanReview;
  const raiserFilter = isScopedRaiser ? { filledById: userId } : {};

  // Base filter. All tabs share it, plus the optional module filter so
  // counts and rows both match the requested view.
  const baseWhere = {
    projectId,
    deletedAt: null,
    ...(moduleFilter ? { module: moduleFilter } : {}),
    ...raiserFilter,
  } as const;

  // Base filter for "everything but drafts" — used on every tab except
  // Drafts. A draft is a private, in-progress checklist; it isn't
  // project state and doesn't belong in the All or Pending views.
  const nonDraftWhere = { ...baseWhere, status: { not: "DRAFT" } } as const;

  // Tab → status filter. `pending` shows IN_REVIEW inspections the current
  // user should care about (they filled it OR they can review it), which is
  // the queue people actually want to walk on their phone. `drafts` is
  // always scoped to the caller's own filledById — draft leakage between
  // fillers is a data-privacy footgun, not a feature.
  const tabWhere = (() => {
    if (tab === "passed") return { ...baseWhere, status: "PASSED" };
    if (tab === "rejected") return { ...baseWhere, status: "REJECTED" };
    if (tab === "rescheduled") return { ...baseWhere, status: "RESCHEDULED" };
    if (tab === "drafts") return { ...baseWhere, status: "DRAFT", filledById: userId };
    if (tab === "pending") {
      return iCanReview
        ? { ...baseWhere, status: "IN_REVIEW" }
        : { ...baseWhere, status: "IN_REVIEW", filledById: userId };
    }
    // "All" tab · exclude drafts so a reviewer doesn't see their
    // teammates' in-progress checklists.
    return nonDraftWhere;
  })();

  // Rescheduled sorts by rescheduledFor ASC so the soonest-to-reopen is on
  // top — that's the row a reviewer actually needs to plan around today.
  // Every other tab keeps createdAt DESC so the freshest work is first.
  const tabOrderBy = tab === "rescheduled"
    ? ({ rescheduledFor: "asc" } as const)
    : ({ createdAt: "desc" } as const);

  // Counts for the tab badges. The status groupBy uses nonDraftWhere so
  // drafts don't inflate the PASSED / REJECTED / RESCHEDULED tallies
  // that reviewers actually walk. The draft count runs as its own
  // scoped-to-filler query so the "My Drafts" badge is always exactly
  // the caller's own count.
  const [inspections, statusCounts, myDraftCount] = await Promise.all([
    prisma.inspection.findMany({
      where: tabWhere,
      orderBy: tabOrderBy,
      take: 100, // Cap for perf. Amanvana has ~110 total; realistic tabs stay well under.
      select: {
        id: true,
        title: true,
        status: true,
        module: true,
        createdAt: true,
        rescheduledFor: true,
        filledBy: { select: { name: true } },
        wbsNode: { select: { name: true } },
        _count: { select: { photos: true, items: true } },
      },
    }),
    prisma.inspection.groupBy({
      by: ["status"],
      where: nonDraftWhere,
      _count: { _all: true },
    }),
    prisma.inspection.count({
      where: { ...baseWhere, status: "DRAFT", filledById: userId },
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
      {/* Hero band + title tracks the module filter so a QA/QC-only view
          reads "QA / QC" and an EHS-only view reads "EHS". Matches the
          sandstone gradient the mobile home uses. */}
      <div
        className="px-5 pt-5 pb-4 border-b border-sandstone-100"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="font-serif text-[28px] leading-tight text-ink tracking-tight">
            {moduleTitle(moduleFilter)}
          </h1>
          <Link
            // New WIR carries the module filter forward so a New button
            // pressed from EHS creates a SAFETY-scoped inspection.
            href={`/mobile/${projectId}/inspection/new${moduleFilter ? `?module=${moduleFilter}` : ""}`}
            className="inline-flex items-center gap-1 rounded-full bg-ink text-cream text-[12px] font-semibold px-3 py-1.5"
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
          <TabLink projectId={projectId} tab="rescheduled" current={tab} moduleFilter={moduleFilter} label="Rescheduled" count={countByStatus.get("RESCHEDULED") ?? 0} icon={CalendarClock} />
          <TabLink projectId={projectId} tab="passed" current={tab} moduleFilter={moduleFilter} label="Passed" count={countByStatus.get("PASSED") ?? 0} icon={CheckCircle2} />
          <TabLink projectId={projectId} tab="rejected" current={tab} moduleFilter={moduleFilter} label="Rejected" count={countByStatus.get("REJECTED") ?? 0} icon={AlertTriangle} />
          {/* My Drafts is only meaningful when the caller has at least
              one — the tab still shows when they don't, so they can
              hop in and confirm nothing's parked, but the badge stays
              silent instead of showing "0". */}
          <TabLink projectId={projectId} tab="drafts" current={tab} moduleFilter={moduleFilter} label="My Drafts" count={myDraftCount} icon={FileEdit} />
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
                  className="rounded-2xl border border-sandstone-100 bg-cream shadow-soft p-4 block active:bg-sandstone-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-semibold text-ink leading-snug line-clamp-2">
                        {i.title}
                      </div>
                      <div className="text-[12px] text-ink-3 mt-1">
                        {i.filledBy?.name ?? "—"}
                        {i.wbsNode?.name ? ` · ${i.wbsNode.name}` : ""}
                      </div>
                      <div className="text-[11px] text-ink-3 mt-0.5 flex items-center gap-2">
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
                      {/* Reopen date · what a reviewer opens the tab to
                          see. Only rendered for RESCHEDULED rows; the
                          field is null on every other status. */}
                      {i.status === "RESCHEDULED" && i.rescheduledFor && (
                        <div className="text-[11px] mt-1 inline-flex items-center gap-1 rounded-full bg-sandstone-100 text-ink-2 px-2 py-0.5 font-semibold">
                          <CalendarClock className="w-3 h-3" />
                          Reopens {fmtDate(i.rescheduledFor)}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <StatusPill status={i.status} />
                      {/* Aging cue for reviewers. Fresh WIRs (0-1d) get
                          no chip; the signal only fires once a WIR has
                          been waiting long enough that queue position
                          matters. */}
                      {i.status === "IN_REVIEW" && <AgingChip createdAt={i.createdAt} />}
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
    // Sandstone rather than a cold blue — this state means "waiting", not
    // "cancelled", and the warm palette carries the "still ours to
    // finish" reading. Same neutral family as the module chip so the
    // eye reads them as related metadata.
    RESCHEDULED: { bg: "bg-sandstone-100 ring-sandstone-200", fg: "text-ink-2", label: "Rescheduled", Icon: CalendarClock },
    // Draft reads as "not yet sent" — stone family (colder than
    // sandstone, no shipping-culture claim to make). Icon is a
    // pencil-on-page so the intent (still editing) is unmistakable.
    DRAFT: { bg: "bg-stone-100 ring-stone-300", fg: "text-stone-700", label: "Draft", Icon: FileEdit },
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
    rescheduled: "No inspections parked for later.",
    passed: "No passed inspections yet.",
    rejected: "No rejected inspections. Good.",
    drafts: "You have no unfinished drafts. Start a new WIR from the button above.",
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

/**
 * Age pill for IN_REVIEW WIRs. Deliberately silent for 0-1d rows so the
 * card of a WIR filed today doesn't wear a chip that says nothing new.
 * Tier colors match the SLA cliff: aging is sandstone (gentle nudge),
 * stale flips to ferrous (missed the internal review window).
 */
function AgingChip({ createdAt }: { createdAt: Date }) {
  const age = wirAgeFor(createdAt);
  if (age.tier === "fresh") return null;
  const cls =
    age.tier === "stale"
      ? "bg-ferrous-50 ring-ferrous-200 text-ferrous-700"
      : "bg-sandstone-100 ring-sandstone-200 text-ink-2";
  return (
    <span
      className={`inline-flex items-center rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold tabular-nums ${cls}`}
      title={`Filed ${fmtDate(createdAt)} · ${age.days} day${age.days === 1 ? "" : "s"} ago`}
    >
      {age.label}
    </span>
  );
}
