import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, Plus, CheckCircle2, Clock } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  canAccessModule,
  primaryModuleFor,
  isScopedUser,
  MODULES,
} from "@/lib/modules";
import { issueAgeFor } from "@/lib/queueAge";

export const dynamic = "force-dynamic";

/**
 * Mobile Issues & Defects list. Sits behind the home "Issues" card so the
 * site engineer can see everything OPEN on their patch without hopping to
 * desktop. Three tabs mirror the QA/QC list vocabulary:
 *
 *   - Open — status OPEN, the queue people actually walk on their phone.
 *   - Reinspection — snags marked IN_REINSPECTION (fixed, awaiting re-visit).
 *   - Resolved — closed / resolved snags for a recency check.
 *
 * Scoped contractors (QA/QC-only, SAFETY-only) only see snags tagged to
 * their module. Same rule the API enforces.
 */

type Tab = "open" | "reinspection" | "resolved";
const VALID_TABS: readonly Tab[] = ["open", "reinspection", "resolved"] as const;
function normaliseTab(v: string | undefined): Tab {
  return (VALID_TABS as readonly string[]).includes(v ?? "") ? (v as Tab) : "open";
}

const STATUS_FOR_TAB: Record<Tab, string> = {
  open: "OPEN",
  reinspection: "IN_REINSPECTION",
  resolved: "RESOLVED",
};

export default async function MobileIssuesListPage({
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

  // Same gate as the API — snags belong to QAQC or SAFETY. Contractor users
  // without either module have no legitimate reason to see this list.
  if (
    !canAccessModule(session.user.modules, MODULES.QAQC) &&
    !canAccessModule(session.user.modules, MODULES.SAFETY)
  ) {
    redirect(`/mobile/${projectId}`);
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  // Scoped contractors see only their module's snags — matches the API's
  // GET-scoping so a hand-crafted URL can't leak the other module's list.
  const scopedModule = isScopedUser(session.user.modules)
    ? primaryModuleFor(session.user.modules)
    : null;

  const baseWhere = {
    projectId,
    deletedAt: null,
    ...(scopedModule ? { module: scopedModule } : {}),
  } as const;

  const [issues, statusCounts] = await Promise.all([
    prisma.issue.findMany({
      where: { ...baseWhere, status: STATUS_FOR_TAB[tab] },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        description: true,
        severity: true,
        category: true,
        status: true,
        module: true,
        createdAt: true,
        createdBy: { select: { name: true } },
        assignedTo: { select: { name: true } },
        wbsNode: { select: { name: true } },
        _count: { select: { photos: true } },
      },
    }),
    prisma.issue.groupBy({
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
            Issues &amp; Defects
          </h1>
          <Link
            href={`/mobile/${projectId}/issue/new`}
            className="inline-flex items-center gap-1 rounded-full bg-ink text-cream text-[12px] font-semibold px-3 py-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            New
          </Link>
        </div>
      </div>

      <nav className="sticky top-12 z-10 bg-ivory/95 backdrop-blur-md border-b border-stone-200 px-4">
        <div className="flex items-center gap-1 -mb-px overflow-x-auto">
          <TabLink projectId={projectId} tab="open" current={tab} label="Open" count={countByStatus.get("OPEN") ?? 0} icon={AlertTriangle} />
          <TabLink projectId={projectId} tab="reinspection" current={tab} label="Reinspection" count={countByStatus.get("IN_REINSPECTION") ?? 0} icon={Clock} />
          <TabLink projectId={projectId} tab="resolved" current={tab} label="Resolved" count={countByStatus.get("RESOLVED") ?? 0} icon={CheckCircle2} />
        </div>
      </nav>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {issues.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <ul className="space-y-2">
            {issues.map((i) => (
              <li key={i.id}>
                <Link
                  href={`/mobile/${projectId}/issue/${i.id}?tab=${tab}`}
                  className="rounded-2xl border border-sandstone-100 bg-cream shadow-soft p-4 block active:bg-sandstone-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] text-ink leading-snug line-clamp-3">
                        {i.description}
                      </div>
                      <div className="text-[12px] text-ink-3 mt-1.5">
                        {i.createdBy?.name ?? "—"}
                        {i.wbsNode?.name ? ` · ${i.wbsNode.name}` : ""}
                      </div>
                      <div className="text-[11px] text-ink-3 mt-0.5 flex items-center gap-2 flex-wrap">
                        <span>{fmtDate(i.createdAt)}</span>
                        {i.assignedTo?.name && (
                          <>
                            <span>·</span>
                            <span>to {i.assignedTo.name}</span>
                          </>
                        )}
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
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <SeverityPill severity={i.severity} />
                      {/* Aging cue on live snags — OPEN + IN_REINSPECTION.
                          Once RESOLVED the aging signal has been closed
                          out; showing it there would be noise. */}
                      {(i.status === "OPEN" || i.status === "IN_REINSPECTION") && (
                        <IssueAgingChip createdAt={i.createdAt} />
                      )}
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
  icon: typeof AlertTriangle;
}) {
  const active = tab === current;
  return (
    <Link
      href={`/mobile/${projectId}/issue?tab=${tab}`}
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

function SeverityPill({ severity }: { severity: string | null }) {
  const sev = severity ?? "";
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    HIGH: { bg: "bg-red-50 ring-red-200", fg: "text-red-800", label: "High" },
    MEDIUM: { bg: "bg-amber-50 ring-amber-200", fg: "text-amber-800", label: "Med" },
    LOW: { bg: "bg-stone-50 ring-stone-200", fg: "text-stone-700", label: "Low" },
  };
  const cfg = map[sev];
  if (!cfg) return null;
  return (
    <span className={`inline-flex items-center rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold shrink-0 ${cfg.bg} ${cfg.fg}`}>
      {cfg.label}
    </span>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  const copy = {
    open: "No open snags. Nice.",
    reinspection: "Nothing awaiting reinspection.",
    resolved: "No resolved snags on record yet.",
  }[tab];
  return (
    <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-8 text-center">
      <AlertTriangle className="w-6 h-6 text-stone-300 mx-auto" />
      <p className="text-sm text-stone-500 mt-2">{copy}</p>
    </div>
  );
}

/**
 * Age pill for live snags. Silent for 0-1d, sandstone at 2d, ferrous
 * at 4d — an unfixed defect over four days without an assignee is a
 * supervision gap. Applied to OPEN + IN_REINSPECTION only (both mean
 * "the snag hasn't been closed"); silent on RESOLVED.
 */
function IssueAgingChip({ createdAt }: { createdAt: Date }) {
  const age = issueAgeFor(createdAt);
  if (age.tier === "fresh") return null;
  const cls =
    age.tier === "stale"
      ? "bg-ferrous-50 ring-ferrous-200 text-ferrous-700"
      : "bg-sandstone-100 ring-sandstone-200 text-ink-2";
  return (
    <span
      className={`inline-flex items-center rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold tabular-nums ${cls}`}
      title={`Raised ${fmtDate(createdAt)} · ${age.days} day${age.days === 1 ? "" : "s"} ago`}
    >
      {age.label}
    </span>
  );
}

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
