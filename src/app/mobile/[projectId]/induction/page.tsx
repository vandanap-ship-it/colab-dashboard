import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Plus,
  Clock,
  CheckCircle2,
  X,
  CalendarClock,
  ShieldCheck,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";
import { canReview } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * Mobile Safety Induction list — the safety team's parallel to the
 * Permits + QAQC lists. Colab 2026-10-01 parity (Girish's native app
 * home has three tiles: Inspection Checklist, Permits, Safety
 * Induction). Two tabs:
 *
 *   - Submitted To Me (default landing for reviewers) — Pending rows
 *     awaiting Girish's decision.
 *   - Submitted By Me — everything this user raised, filtered by the
 *     chip row (All / Pending / Approved / Rejected / Expired).
 *
 * A SAFETY-scoped maker (Abhishek, Harshit) typically lands on
 * "Submitted By Me" since they're not a reviewer; the reviewer
 * (Girish) lands on "Submitted To Me" where their queue lives.
 */

type Tab = "assigned" | "me";
const VALID_TABS: readonly Tab[] = ["assigned", "me"] as const;
function normaliseTab(v: string | undefined): Tab {
  return (VALID_TABS as readonly string[]).includes(v ?? "") ? (v as Tab) : "assigned";
}

type Chip = "all" | "pending" | "approved" | "rejected" | "expired";
const VALID_CHIPS: readonly Chip[] = ["all", "pending", "approved", "rejected", "expired"] as const;
function normaliseChip(v: string | undefined): Chip {
  return (VALID_CHIPS as readonly string[]).includes(v ?? "") ? (v as Chip) : "all";
}
const CHIP_TO_STATUS: Record<Chip, string | null> = {
  all: null,
  pending: "PENDING",
  approved: "APPROVED",
  rejected: "REJECTED",
  expired: "EXPIRED",
};

export default async function MobileInductionListPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ tab?: string; chip?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { projectId } = await params;
  const { tab: tabParam, chip: chipParam } = await searchParams;
  const tab = normaliseTab(tabParam);
  const chip = normaliseChip(chipParam);

  // Gate — Safety Induction is the SAFETY team's module. Everyone else
  // gets bounced to home. canReview is NOT required here (makers like
  // Abhishek + Harshit need to see their own submissions), only module
  // access.
  if (!canAccessModule(session.user.modules, MODULES.SAFETY)) {
    redirect(`/mobile/${projectId}`);
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const userId = session.user.id;
  const iCanReview = canReview(session.user.role);
  const nowMs = new Date().getTime();

  // Submitted To Me = Pending rows (regardless of maker). Reviewers see
  // this; makers see an empty tab (they're the ones submitting, not
  // reviewing). The chip row applies to Submitted By Me only — on the
  // reviewer tab the only sensible chip is Pending anyway.
  const baseWhere = { projectId, deletedAt: null } as const;
  const whereForTab = (() => {
    if (tab === "assigned") {
      return { ...baseWhere, status: "PENDING" };
    }
    const extraStatus = CHIP_TO_STATUS[chip];
    return {
      ...baseWhere,
      createdById: userId,
      ...(extraStatus ? { status: extraStatus } : {}),
    };
  })();

  const [rows, grouped] = await Promise.all([
    prisma.safetyInduction.findMany({
      where: whereForTab,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        contractor: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
    }),
    prisma.safetyInduction.groupBy({
      by: ["status"],
      where: tab === "assigned"
        ? { ...baseWhere, status: "PENDING" }
        : { ...baseWhere, createdById: userId },
      _count: { _all: true },
    }),
  ]);

  const countByStatus = new Map<string, number>();
  for (const g of grouped) countByStatus.set(g.status, g._count._all);

  // Reviewer badge on the "Submitted To Me" tab = pending count for
  // everyone (the queue the reviewer walks).
  const assignedCount = iCanReview
    ? await prisma.safetyInduction.count({
        where: { ...baseWhere, status: "PENDING" },
      })
    : 0;

  return (
    <div className="flex-1 flex flex-col bg-ivory min-h-0">
      <div
        className="px-5 pt-5 pb-4 border-b border-sandstone-100"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="font-serif text-[28px] leading-tight text-ink tracking-tight">
            Safety Induction
          </h1>
          <Link
            href={`/mobile/${projectId}/induction/new`}
            className="inline-flex items-center gap-1 rounded-full bg-ink text-cream text-[12px] font-semibold px-3 py-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            New
          </Link>
        </div>
      </div>

      <nav className="sticky top-12 z-10 bg-ivory/95 backdrop-blur-md border-b border-stone-200 px-4">
        <div className="flex items-center gap-1 -mb-px">
          {iCanReview && (
            <TabLink
              projectId={projectId}
              tab="assigned"
              current={tab}
              label="Submitted To Me"
              count={assignedCount}
              icon={Clock}
            />
          )}
          <TabLink
            projectId={projectId}
            tab="me"
            current={tab}
            label="Submitted By Me"
            count={countByStatus.get("PENDING") ?? 0}
            icon={ShieldCheck}
          />
        </div>
      </nav>

      {/* Chip row — only on the "Submitted By Me" tab. The reviewer tab's
          chip row would be pending-only (the queue) so it's redundant. */}
      {tab === "me" && (
        <div className="sticky top-[calc(3rem+2.5rem)] z-[9] bg-ivory/95 backdrop-blur-md border-b border-stone-200 px-4 py-2">
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {VALID_CHIPS.map((c) => (
              <ChipLink
                key={c}
                projectId={projectId}
                chip={c}
                currentTab={tab}
                currentChip={chip}
                label={CHIP_LABELS[c]}
                count={c === "all" ? undefined : countByStatus.get(CHIP_TO_STATUS[c] as string) ?? 0}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {rows.length === 0 ? (
          <EmptyState tab={tab} chip={chip} />
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/mobile/${projectId}/induction/${r.id}?tab=${tab}&chip=${chip}`}
                  className="block rounded-xl border border-stone-200 bg-white shadow-sm p-4 active:bg-stone-50"
                >
                  <div className="flex items-center gap-3">
                    <WorkerPhoto url={r.workerPhotoUrl} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <h3 className="text-[16px] font-bold text-ink truncate">{r.workerName}</h3>
                        <StatusPill status={r.status} expiryDate={r.expiryDate} nowMs={nowMs} />
                      </div>
                      <p className="text-[12px] text-ink-3 mt-0.5 truncate">
                        {r.displayId} · {r.trade}
                      </p>
                      <p className="text-[11px] text-stone-500 mt-0.5 truncate">
                        {r.contractor?.name ?? "—"} · {fmtDate(r.inductionDate)}
                      </p>
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

const CHIP_LABELS: Record<Chip, string> = {
  all: "All",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
};

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
      href={`/mobile/${projectId}/induction?tab=${tab}`}
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

function ChipLink({
  projectId,
  chip,
  currentTab,
  currentChip,
  label,
  count,
}: {
  projectId: string;
  chip: Chip;
  currentTab: Tab;
  currentChip: Chip;
  label: string;
  count?: number;
}) {
  const active = chip === currentChip;
  return (
    <Link
      href={`/mobile/${projectId}/induction?tab=${currentTab}&chip=${chip}`}
      className={
        "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] font-semibold whitespace-nowrap transition-colors " +
        (active
          ? "bg-ink text-white"
          : "bg-sandstone-50 text-ink-3 hover:bg-sandstone-100")
      }
    >
      {label}
      {count != null && count > 0 && (
        <span
          className={
            "ml-0.5 rounded-full text-[10px] font-bold px-1 min-w-[18px] text-center tabular-nums " +
            (active ? "bg-white/20 text-white" : "bg-ink/10 text-ink")
          }
        >
          {count}
        </span>
      )}
    </Link>
  );
}

function StatusPill({ status, expiryDate, nowMs }: { status: string; expiryDate: Date; nowMs: number }) {
  // Expiring-soon callout — approved rows within 30 days of expiry get
  // an amber chip to help the safety officer plan the re-induction
  // visit. Doesn't replace the status, sits beside it on the card.
  // nowMs is pinned by the server component so re-renders agree.
  const expiresSoon =
    status === "APPROVED" && new Date(expiryDate).getTime() - nowMs < 30 * 24 * 60 * 60 * 1000;

  const map: Record<string, { bg: string; fg: string; label: string; Icon: typeof CheckCircle2 }> = {
    PENDING: { bg: "bg-amber-50 ring-amber-200", fg: "text-amber-800", label: "Pending", Icon: Clock },
    APPROVED: { bg: "bg-emerald-50 ring-emerald-200", fg: "text-emerald-800", label: "Approved", Icon: CheckCircle2 },
    REJECTED: { bg: "bg-red-50 ring-red-200", fg: "text-red-800", label: "Rejected", Icon: X },
    EXPIRED: { bg: "bg-stone-100 ring-stone-300", fg: "text-stone-700", label: "Expired", Icon: CalendarClock },
  };
  const cfg = map[status] ?? map.PENDING;
  const Icon = cfg.Icon;
  return (
    <div className="flex items-center gap-1 shrink-0">
      <span className={`inline-flex items-center gap-1 rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold ${cfg.bg} ${cfg.fg}`}>
        <Icon className="w-3 h-3" />
        {cfg.label}
      </span>
      {expiresSoon && (
        <span className="inline-flex items-center gap-1 rounded-full ring-1 ring-sandstone-300 bg-sandstone-50 text-ferrous-700 px-2 py-0.5 text-[10px] font-semibold">
          Expires soon
        </span>
      )}
    </div>
  );
}

function WorkerPhoto({ url }: { url: string | null }) {
  if (!url) {
    return (
      <div className="w-14 h-14 rounded-full bg-sandstone-100 flex items-center justify-center shrink-0">
        <ShieldCheck className="w-6 h-6 text-ferrous-600" />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="w-14 h-14 rounded-full object-cover shrink-0 bg-stone-100" loading="lazy" />;
}

function EmptyState({ tab, chip }: { tab: Tab; chip: Chip }) {
  const text =
    tab === "assigned"
      ? "No inductions waiting on you. Good."
      : chip === "all"
        ? "You haven't raised any inductions yet. Tap New above."
        : chip === "pending"
          ? "Nothing of yours is pending — all previous raises have been decided."
          : chip === "approved"
            ? "No approved inductions yet."
            : chip === "rejected"
              ? "No rejected inductions. Good."
              : "No expired inductions.";
  return (
    <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-8 text-center">
      <ShieldCheck className="w-6 h-6 text-stone-300 mx-auto" />
      <p className="text-sm text-stone-500 mt-2">{text}</p>
    </div>
  );
}

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}
