import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  Bug,
  ClipboardCheck,
  ClipboardList,
  FileEdit,
  HardHat,
  ListChecks,
  MessageSquare,
  PlusCircle,
  Search as SearchIcon,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  TOOL_MODULES,
  canAccessModule,
  canAccessTool,
  isScopedUser,
  primaryModuleFor,
  MODULES,
} from "@/lib/modules";
import { getDashboardManpowerStrip } from "@/lib/manpowerServer";
import { istDayStart } from "@/lib/istDay";
import { WIR_TIERS, PERMIT_TIERS, HINDRANCE_TIERS, CONCERN_TIERS, ISSUE_TIERS } from "@/lib/queueAge";
import { getWaitingByVilla, type VillaWaitingCount } from "@/lib/waitingByVilla";

// Amanvana-native mobile home. Editorial serif hero + warm sandstone cards
// + ferrous accent — reads like the villa brochure a site engineer already
// knows, not a generic dashboard. Content order sequenced by the actual
// question site engineers open the app to answer:
//   1. What date is it and which project am I in? (dated eyebrow + name)
//   2. What's the site pulse right now? (workers on site vs plan)
//   3. What do I need to log today? (four big primary CTAs)
//   4. What else can I go look at? (secondary tools, calmer grid)

export default async function MobileProjectHome({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const session = await auth();
  const { projectId } = await params;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  // "Today" anchored to IST so a phone opened at 23:30 IST still lands on
  // the same date the site engineer just worked, not a UTC-rollover next
  // day.
  const todayIst = istDayStart();
  const userModules = session?.user?.modules ?? null;
  const scoped = isScopedUser(userModules);

  // Quality strip counts — Work Inspection Requests currently IN_REVIEW and
  // Issues/Defects currently OPEN. Colab surfaces these as the two things
  // every site engineer wants to see on open, so the site's health is one
  // glance not a menu dive. Scoped contractors only see their module's
  // slice; users without any QA/QC or SAFETY access don't see the strip.
  const canSeeQualityStrip =
    canAccessModule(userModules, MODULES.QAQC) ||
    canAccessModule(userModules, MODULES.SAFETY);
  const scopedModule = scoped ? primaryModuleFor(userModules) : null;
  const qualityBaseWhere = {
    projectId,
    deletedAt: null,
    ...(scopedModule ? { module: scopedModule } : {}),
  } as const;

  // "Waiting on you" strip · counts rows that have already crossed each
  // domain's stale cliff. Same tier boundaries the per-domain aging chips
  // use (queueAge.ts), so a row that reads ferrous on its list card is
  // exactly the row counted here. Every count is gated on module access
  // — a HINDRANCE-scoped contractor sees only the hindrance pill;
  // scoped users don't see cross-module rollups they can't act on.
  //
  // Server components run once per request, not on every re-render, so
  // Date.now() is legit here — the react-hooks/purity rule doesn't know
  // the difference and would rather see this in a lib helper. Overriding
  // for the reason above.
  // eslint-disable-next-line react-hooks/purity -- Server component; per-request execution, not client render
  const nowMs = Date.now();
  const staleWirCutoff = new Date(nowMs - WIR_TIERS.staleAt * 86_400_000);
  const stalePermitCutoff = new Date(nowMs - PERMIT_TIERS.staleAt * 86_400_000);
  const staleHindranceCutoff = new Date(nowMs - HINDRANCE_TIERS.staleAt * 86_400_000);
  const staleConcernCutoff = new Date(nowMs - CONCERN_TIERS.staleAt * 86_400_000);
  const staleIssueCutoff = new Date(nowMs - ISSUE_TIERS.staleAt * 86_400_000);

  const canSeeHindrance = canAccessModule(userModules, MODULES.HINDRANCE);
  const canSeePermit = canAccessModule(userModules, MODULES.PERMIT);
  const canSeeConcern = canAccessModule(userModules, MODULES.CONCERN);

  // For scoped contractors, "Waiting on you" pills should count only
  // items THIS user or their contractor is responsible for — not every
  // stale row on the project (which is what the pills should mean for
  // internal planners doing project oversight). We fetch the caller's
  // contractorId here so the per-queue filters below can OR-in the
  // "or my contractor's" clause when applicable.
  //
  // Full-access users (modules=null) skip this scoping entirely so
  // planners still see the project-wide roll-up they expect.
  const userContractorId = scoped && session?.user
    ? (await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { contractorId: true },
      }))?.contractorId ?? null
    : null;
  const userId = session?.user?.id ?? null;

  // Hindrance "waiting on me" filter for scoped contractors:
  //   raised BY me OR my contractor is the responsible party.
  // The two ORs never double-count (the count() dedups on id) even
  // if a user raises a hindrance against their own contractor.
  const hindranceWaitingWhere = scoped && userId
    ? {
        projectId,
        deletedAt: null,
        status: "OPEN",
        startDate: { lt: staleHindranceCutoff },
        OR: [
          { createdById: userId },
          ...(userContractorId ? [{ responsibleContractorId: userContractorId }] : []),
        ],
      }
    : {
        projectId,
        deletedAt: null,
        status: "OPEN",
        startDate: { lt: staleHindranceCutoff },
      };

  const [
    myProgressToday,
    manpower,
    wirPendingCount,
    issuesOpenCount,
    staleWirCount,
    stalePermitCount,
    staleHindranceCount,
    staleConcernCount,
    staleIssueCount,
    myDraftCount,
  ] = await Promise.all([
    session?.user
      ? prisma.progressEntry.count({
          where: {
            projectId,
            createdById: session.user.id,
            date: { gte: todayIst },
          },
        })
      : Promise.resolve(0),
    getDashboardManpowerStrip(projectId, todayIst),
    canSeeQualityStrip
      ? prisma.inspection.count({ where: { ...qualityBaseWhere, status: "IN_REVIEW" } })
      : Promise.resolve(0),
    canSeeQualityStrip
      ? prisma.issue.count({ where: { ...qualityBaseWhere, status: "OPEN" } })
      : Promise.resolve(0),
    canSeeQualityStrip
      ? prisma.inspection.count({
          where: { ...qualityBaseWhere, status: "IN_REVIEW", createdAt: { lt: staleWirCutoff } },
        })
      : Promise.resolve(0),
    canSeePermit
      ? prisma.workPermit.count({
          where: { projectId, deletedAt: null, status: "PENDING", createdAt: { lt: stalePermitCutoff } },
        })
      : Promise.resolve(0),
    canSeeHindrance
      ? prisma.hindrance.count({ where: hindranceWaitingWhere })
      : Promise.resolve(0),
    canSeeConcern
      ? prisma.concern.count({
          where: { projectId, deletedAt: null, status: "PENDING", createdAt: { lt: staleConcernCutoff } },
        })
      : Promise.resolve(0),
    // Issue = snag/defect. OPEN + IN_REINSPECTION both count as "live";
    // resolved snags don't. Gated on QA/QC or Safety module access via
    // canSeeQualityStrip, matching the wirPendingCount / issuesOpenCount
    // gates above.
    canSeeQualityStrip
      ? prisma.issue.count({
          where: {
            ...qualityBaseWhere,
            status: { in: ["OPEN", "IN_REINSPECTION"] },
            createdAt: { lt: staleIssueCutoff },
          },
        })
      : Promise.resolve(0),
    // Own drafts count — only meaningful when the caller can raise WIRs.
    // Scoped strictly to filledById so nothing leaks between authors.
    canSeeQualityStrip && session?.user
      ? prisma.inspection.count({
          where: { ...qualityBaseWhere, status: "DRAFT", filledById: session.user.id },
        })
      : Promise.resolve(0),
  ]);

  const totalWaitingOnYou =
    staleWirCount + stalePermitCount + staleHindranceCount + staleConcernCount + staleIssueCount + myDraftCount;

  // "Focus your walk" — top villas with the most waiting rows across all
  // queues. Only queried when the engineer has ≥ 3 waiting items total, so
  // engineers with a light load don't get a section that says "cluster by
  // villa" over a list of 1 chip. Empty array falls through to hiding the
  // section entirely.
  const villaFocus: VillaWaitingCount[] =
    totalWaitingOnYou >= 3 ? await getWaitingByVilla(projectId, session).catch(() => []) : [];

  // The full date in a real editorial format — Fraunces will read it well
  // even at eyebrow scale. Rendered on the server so the FCP has the real
  // date, not "Loading…". Timezone-locked to IST so a night-shift entry
  // doesn't render as "Thursday" at 23:59 IST.
  const dateLine = todayIst.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Kolkata",
  });

  type Tool = {
    key: string;
    href: string;
    label: string;
    hint: string; // sub-line under the label — gives each tile a job, not just a name
    icon: LucideIcon;
    tier: "primary" | "secondary";
  };

  const allTools: Tool[] = [
    {
      key: "new-progress",
      href: `/mobile/${projectId}/progress/new`,
      label: "Log progress",
      hint: "Percent complete + labour on an activity",
      icon: PlusCircle,
      tier: "primary",
    },
    {
      key: "manpower",
      href: `/mobile/${projectId}/manpower/new`,
      label: "Log manpower",
      hint: "Trades and headcount on site today",
      icon: Users,
      tier: "primary",
    },
    {
      key: "hindrance",
      href: `/mobile/${projectId}/hindrance/new`,
      label: "Add hindrance",
      hint: "Blocker holding an activity up",
      icon: AlertTriangle,
      tier: "primary",
    },
    {
      key: "permit",
      href: `/mobile/${projectId}/permit/new`,
      label: "Raise work permit",
      hint: "Hot work · night work · deshuttering",
      icon: ShieldCheck,
      tier: "primary",
    },
    {
      key: "permit-list",
      href: `/mobile/${projectId}/permit`,
      label: "Work permits",
      hint: "Approve or view raised permits",
      icon: ShieldCheck,
      tier: "secondary",
    },
    {
      key: "site-progress",
      href: `/mobile/${projectId}/site-progress`,
      label: "Site progress",
      hint: "Villa-by-villa completion",
      icon: ListChecks,
      tier: "secondary",
    },
    // QA/QC and EHS live on the SAME mobile screen (/qaqc) filtered by
    // `?module=…`; the home surfaces two distinct tiles so the teams
    // land where they expect, and so a SAFETY-scoped contractor doesn't
    // see the QA/QC tile at all (see TOOL_MODULES).
    {
      key: "qaqc-tile",
      href: `/mobile/${projectId}/qaqc?tab=pending&module=QAQC`,
      label: "QA / QC",
      hint: "Quality inspections + snags",
      icon: ClipboardCheck,
      tier: "secondary",
    },
    {
      key: "ehs-tile",
      href: `/mobile/${projectId}/qaqc?tab=pending&module=SAFETY`,
      label: "EHS",
      hint: "Safety inspections + snags",
      icon: HardHat,
      tier: "secondary",
    },
    {
      key: "concern",
      href: `/mobile/${projectId}/concern?tab=pending`,
      label: "Concerns",
      hint: "Heads-ups from the site",
      icon: MessageSquare,
      tier: "secondary",
    },
    {
      key: "hindrance-list",
      href: `/mobile/${projectId}/hindrance?tab=open`,
      label: "Hindrances",
      hint: "Open blockers · days impact",
      icon: AlertTriangle,
      tier: "secondary",
    },
    {
      key: "manpower-list",
      href: `/mobile/${projectId}/manpower`,
      label: "Manpower history",
      hint: "Today + last 7 days on site",
      icon: Users,
      tier: "secondary",
    },
    {
      key: "search",
      href: `/mobile/${projectId}/search`,
      label: "Search",
      hint: "Villa, snag, activity — one query",
      icon: SearchIcon,
      tier: "secondary",
    },
    {
      key: "dlr",
      href: `/mobile/${projectId}/dlr`,
      label: "DLR updates",
      hint: "Daily log report",
      icon: ClipboardCheck,
      tier: "secondary",
    },
  ];

  const tools = allTools.filter((t) =>
    canAccessTool(userModules, TOOL_MODULES[t.key] ?? []),
  );
  const primaryTools = tools.filter((t) => t.tier === "primary");
  const secondaryTools = tools.filter((t) => t.tier === "secondary");

  return (
    <div className="pb-8">
      {/* Hero band — warm sandstone, editorial layout. Not a gigantic
          landing page splash, but enough presence that the app feels like
          a real product on open rather than a form. */}
      {/* Hero band — the layout header already carries the project name and
          user name so we don't repeat them here. Lead with the date + a
          question that actually orients the engineer ("What's on today?"),
          which is the useful content this band adds over the header. */}
      <section
        className="px-5 pt-6 pb-8 border-b border-sandstone-100"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        <p className="font-serif italic text-[13px] text-ferrous-600 tracking-wide">
          {dateLine}
        </p>
        <h1 className="font-serif text-[32px] leading-[1.1] text-ink mt-1 tracking-tight">
          What&apos;s on today?
        </h1>
      </section>

      <div className="px-5 pt-6 space-y-7">
        {/* Site pulse — one editorial statistic card. Answers "is the
            site staffed today?" in one glance. Only rendered for internal
            staff — contractor-scoped users don't own that question. */}
        {!scoped && <SitePulse manpower={manpower} myProgressToday={myProgressToday} />}

        {/* Quality strip — two dashboard cards side-by-side that mirror
            the Colab home. Only rendered for users with QA/QC or SAFETY
            access; a hindrance-only or progress-only contractor doesn't
            need to see either count. */}
        {/* "Waiting on you" strip · sits above the calmer QualityStrip
            because it's an escalation, not a summary. Every pill counts
            rows that have crossed the domain's stale cliff — so a chip
            only fires when something is genuinely overdue for
            attention. Hidden entirely when everything is fresh. */}
        {totalWaitingOnYou > 0 && (
          <WaitingOnYouStrip
            projectId={projectId}
            moduleFilter={scopedModule}
            staleWirCount={staleWirCount}
            stalePermitCount={stalePermitCount}
            staleHindranceCount={staleHindranceCount}
            staleConcernCount={staleConcernCount}
            staleIssueCount={staleIssueCount}
            myDraftCount={myDraftCount}
          />
        )}

        {/* "Focus your walk" · villa-first rollup that sits under the
            per-queue strip. Only rendered when the engineer has at
            least 2 villas carrying waiting rows — a single-villa
            focus strip would just duplicate what the queue counts
            already say. */}
        {villaFocus.length >= 2 && (
          <VillaFocusStrip projectId={projectId} villas={villaFocus} />
        )}

        {canSeeQualityStrip && (
          <QualityStrip
            projectId={projectId}
            wirPendingCount={wirPendingCount}
            issuesOpenCount={issuesOpenCount}
            moduleFilter={scopedModule}
          />
        )}

        {/* Log today — four primary CTAs. Warm cream card, ferrous icon
            in a soft-tone circle, hint under label. Feels considered
            rather than "stack of buttons". */}
        <section>
          <SectionEyebrow>Log today</SectionEyebrow>
          <div className="grid grid-cols-1 gap-2.5">
            {primaryTools.map((t) => (
              <PrimaryToolCard key={t.href} tool={t} />
            ))}
          </div>
        </section>

        {/* More — a quieter block. Two columns, thin sandstone borders,
            no shadow. The eye reads it as "the rest of the app" not "as
            important as logging". */}
        {secondaryTools.length > 0 && (
          <section>
            <SectionEyebrow>More</SectionEyebrow>
            <div className="grid grid-cols-2 gap-2.5">
              {secondaryTools.map((t) => (
                <SecondaryToolCard key={t.href} tool={t} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentational
// ---------------------------------------------------------------------------

/**
 * Two-up dashboard row surfacing the two lists the site engineer wants to
 * see at open — Work Inspection Requests waiting in review, and Issues &
 * Defects currently open. Colab parity for their home. Copy leans on the
 * count itself so the card reads as "there are X things to look at"
 * rather than "here is a menu entry".
 *
 * When the current viewer is scoped to one module (a QAQC-only or
 * SAFETY-only contractor), the WIR card deep-links into that same module
 * filter so their tap keeps the isolation the API already enforces.
 */
function QualityStrip({
  projectId,
  wirPendingCount,
  issuesOpenCount,
  moduleFilter,
}: {
  projectId: string;
  wirPendingCount: number;
  issuesOpenCount: number;
  moduleFilter: string | null;
}) {
  const wirHref = `/mobile/${projectId}/qaqc?tab=pending${moduleFilter ? `&module=${moduleFilter}` : ""}`;
  const issuesHref = `/mobile/${projectId}/issue?tab=open`;
  return (
    <section aria-label="Quality dashboard">
      <SectionEyebrow>On your desk</SectionEyebrow>
      <div className="grid grid-cols-2 gap-2.5">
        <QualityCard
          href={wirHref}
          icon={ClipboardList}
          count={wirPendingCount}
          label="Work Inspection"
          hint={wirPendingCount === 1 ? "request in review" : "requests in review"}
          emptyHint="Nothing in review"
        />
        <QualityCard
          href={issuesHref}
          icon={Bug}
          count={issuesOpenCount}
          label={<>Issues &amp; Defects</>}
          hint={issuesOpenCount === 1 ? "snag open" : "snags open"}
          emptyHint="No open snags"
        />
      </div>
    </section>
  );
}

function QualityCard({
  href,
  icon: Icon,
  count,
  label,
  hint,
  emptyHint,
}: {
  href: string;
  icon: LucideIcon;
  count: number;
  label: React.ReactNode;
  hint: string;
  emptyHint: string;
}) {
  const isEmpty = count === 0;
  return (
    <Link
      href={href}
      className="rounded-2xl border border-sandstone-100 bg-cream shadow-soft px-4 py-4 flex flex-col gap-1.5 active:scale-[0.99] hover:border-sandstone-200 transition-all"
    >
      <Icon className={`w-4 h-4 ${isEmpty ? "text-ink-3" : "text-ferrous-600"}`} />
      <div className="flex items-baseline gap-1.5">
        <span
          className={`font-serif ${isEmpty ? "text-ink-3" : "text-ferrous-600"}`}
          style={{
            fontSize: "34px",
            lineHeight: "1",
            letterSpacing: "-0.015em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}
        </span>
      </div>
      <div>
        <div className="text-[13px] font-semibold text-ink leading-tight">{label}</div>
        <div className="text-[11px] text-ink-3 mt-0.5">
          {isEmpty ? emptyHint : hint}
        </div>
      </div>
    </Link>
  );
}

/**
 * Compact escalation strip — one pill per domain that has stale rows.
 * "Stale" here means "past the domain's own SLA cliff" (WIR 7d+,
 * Permit 2d+, Hindrance 3d+, Concern 5d+, all from queueAge tiers).
 * Only pills with a non-zero count render, and the whole strip is
 * hidden by the caller when the total is 0 — so on a clean day the
 * home has no visual noise saying "you're up to date".
 *
 * Each pill deep-links into the filtered queue: WIR → Pending tab
 * (module-preserving for scoped users), Permit → default list,
 * Hindrance → Open tab, Concern → Pending tab, Drafts → own drafts
 * tab. Every tap lands on the exact rows the count is measuring.
 */
function WaitingOnYouStrip({
  projectId,
  moduleFilter,
  staleWirCount,
  stalePermitCount,
  staleHindranceCount,
  staleConcernCount,
  staleIssueCount,
  myDraftCount,
}: {
  projectId: string;
  moduleFilter: string | null;
  staleWirCount: number;
  stalePermitCount: number;
  staleHindranceCount: number;
  staleConcernCount: number;
  staleIssueCount: number;
  myDraftCount: number;
}) {
  const wirHref = `/mobile/${projectId}/qaqc?tab=pending${moduleFilter ? `&module=${moduleFilter}` : ""}`;
  const draftsHref = `/mobile/${projectId}/qaqc?tab=drafts${moduleFilter ? `&module=${moduleFilter}` : ""}`;

  // Ordered by escalation strength: WIRs and permits (SLA-shipped) lead;
  // hindrances and concerns follow; own drafts sit last since a draft is
  // an internal to-do rather than an external clock ticking.
  type Pill = {
    key: string;
    href: string;
    count: number;
    label: string;
    Icon: LucideIcon;
    tone: "stale" | "draft";
  };
  const pills: Pill[] = [
    { key: "wir", href: wirHref, count: staleWirCount, label: staleWirCount === 1 ? "stale WIR" : "stale WIRs", Icon: ClipboardList, tone: "stale" as const },
    { key: "permit", href: `/mobile/${projectId}/permit`, count: stalePermitCount, label: stalePermitCount === 1 ? "stale permit" : "stale permits", Icon: ShieldCheck, tone: "stale" as const },
    { key: "hindrance", href: `/mobile/${projectId}/hindrance?tab=open`, count: staleHindranceCount, label: staleHindranceCount === 1 ? "stale blocker" : "stale blockers", Icon: AlertTriangle, tone: "stale" as const },
    { key: "issue", href: `/mobile/${projectId}/issue?tab=open`, count: staleIssueCount, label: staleIssueCount === 1 ? "stale snag" : "stale snags", Icon: Bug, tone: "stale" as const },
    { key: "concern", href: `/mobile/${projectId}/concern?tab=pending`, count: staleConcernCount, label: staleConcernCount === 1 ? "stale concern" : "stale concerns", Icon: MessageSquare, tone: "stale" as const },
    { key: "drafts", href: draftsHref, count: myDraftCount, label: myDraftCount === 1 ? "draft to finish" : "drafts to finish", Icon: FileEdit, tone: "draft" as const },
  ].filter((p) => p.count > 0);

  return (
    <section aria-label="Rows past their SLA">
      <SectionEyebrow>Waiting on you</SectionEyebrow>
      <div className="flex flex-wrap gap-2">
        {pills.map((p) => (
          <Link
            key={p.key}
            href={p.href}
            className={
              // Stale rows read as an escalating warning (ferrous outline
              // + ferrous count), drafts read as a to-do (sandstone).
              // Two-tone so the eye can separate "external clock" from
              // "your own work in progress" at a glance.
              "inline-flex items-center gap-1.5 rounded-full ring-1 px-3 py-1.5 text-[13px] font-semibold tabular-nums active:scale-[0.99] " +
              (p.tone === "stale"
                ? "bg-ferrous-50 ring-ferrous-200 text-ferrous-700"
                : "bg-sandstone-100 ring-sandstone-200 text-ink-2")
            }
          >
            <p.Icon className="w-3.5 h-3.5" />
            <span>{p.count}</span>
            <span className="font-medium">{p.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/**
 * "Focus your walk" · villa-first rollup that sits under the per-queue
 * strip. Same source rows the WaitingOnYou strip counts (WIR + Permit
 * + Hindrance + Concern + Issue, all past their SLA cliff), but
 * grouped by villa instead of by queue so the engineer can plan a site
 * walk villa-by-villa instead of jumping between five inboxes.
 *
 * Each row: villa label + total count. Tap goes to My Actions today —
 * a proper per-villa filter is a follow-up. Kept intentionally small
 * (one row per villa, no per-queue breakdown line) so the section
 * stays quiet under the queue strip.
 */
function VillaFocusStrip({
  projectId,
  villas,
}: {
  projectId: string;
  villas: VillaWaitingCount[];
}) {
  return (
    <section>
      <SectionEyebrow>Focus your walk</SectionEyebrow>
      <ul className="space-y-1.5">
        {villas.map((v) => (
          <li key={v.villaLabel}>
            <Link
              href={`/mobile/${projectId}/my-actions?villa=${encodeURIComponent(v.villaLabel)}`}
              className="flex items-center justify-between gap-2 rounded-xl bg-white border border-sandstone-100 px-3.5 py-2.5 active:scale-[0.99]"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium text-ink truncate">
                  {v.villaLabel}
                </span>
                <span className="block text-[11px] text-ink-3 mt-0.5">
                  Block {v.blockCode}
                </span>
              </span>
              <span className="flex-shrink-0 text-right">
                <span className="block text-[16px] font-serif text-ink tabular-nums leading-none">
                  {v.total}
                </span>
                <span className="block text-[10px] text-ink-3 uppercase tracking-[0.12em] mt-1">
                  {v.total === 1 ? "item" : "items"}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10.5px] font-semibold text-ink-3 uppercase tracking-[0.16em] mb-3">
      {children}
    </p>
  );
}

/**
 * Editorial site-pulse card. Two big statistics on a warm cream ground —
 * a clear headline about whether the site is on-plan today, plus a small
 * "logged by you" tile so the engineer sees credit for what they've
 * personally entered.
 *
 *  - "workers on site" and "planned" as tabular Fraunces numerals so they
 *    look like a printed report, not a live counter.
 *  - Ferrous stripe on the left → visual anchor + brand tie-in.
 *  - Copy sentences instead of chart legends: reads like the executive
 *    summary Shraddha writes weekly, not a debug pane.
 */
function SitePulse({
  manpower,
  myProgressToday,
}: {
  manpower: {
    planned: number;
    actual: number;
    pctOfPlan: number | null;
    status: "no-plan" | "above" | "on-plan" | "below" | "not-logged";
  };
  myProgressToday: number;
}) {
  const noPlan = manpower.status === "no-plan";
  const headline =
    noPlan
      ? "No manpower plan set for today."
      : manpower.status === "not-logged"
        ? "Manpower not logged yet today."
        : manpower.status === "below"
          ? "Below plan today."
          : manpower.status === "above"
            ? "Above plan today."
            : "On plan today.";
  const toneClass =
    manpower.status === "on-plan" || manpower.status === "above"
      ? "text-emerald-700"
      : manpower.status === "below" || manpower.status === "not-logged"
        ? "text-ferrous-600"
        : "text-ink-3";
  return (
    <section className="relative rounded-2xl bg-cream border border-sandstone-100 overflow-hidden">
      <span
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-[3px] bg-ferrous-500"
      />
      <div className="px-5 py-5">
        <div className="flex items-baseline justify-between">
          <p className={`font-serif text-[15px] italic ${toneClass}`}>{headline}</p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
          <PulseStat
            label="On site"
            value={noPlan ? "—" : manpower.actual}
            note={
              noPlan
                ? "no plan"
                : `of ${manpower.planned} planned`
            }
            tone="warm"
          />
          <PulseStat
            label="Your entries"
            value={myProgressToday}
            note={myProgressToday === 1 ? "activity logged" : "activities logged"}
          />
        </div>

        {!noPlan && manpower.planned > 0 && (
          <div className="mt-4 space-y-1.5">
            <div className="flex items-baseline justify-between text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
              <span>Plan {manpower.planned}</span>
              <span>Actual {manpower.actual}</span>
            </div>
            <div className="relative h-[6px] rounded-full bg-sandstone-100 overflow-hidden">
              <div
                className={
                  manpower.actual >= manpower.planned
                    ? "absolute inset-y-0 left-0 bg-emerald-500"
                    : "absolute inset-y-0 left-0 bg-ferrous-500"
                }
                style={{
                  width: `${Math.min(110, (manpower.actual / Math.max(manpower.planned, 1)) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function PulseStat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string | number;
  note?: string;
  tone?: "warm";
}) {
  const valueTone = tone === "warm" ? "text-ferrous-700" : "text-ink";
  return (
    <div>
      <p className="text-[10.5px] font-semibold text-ink-3 uppercase tracking-[0.14em]">
        {label}
      </p>
      <p
        className={`font-serif ${valueTone} mt-1`}
        style={{ fontSize: "40px", lineHeight: "1", letterSpacing: "-0.015em", fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </p>
      {note && <p className="text-[12px] text-ink-3 mt-1.5">{note}</p>}
    </div>
  );
}

function PrimaryToolCard({
  tool,
}: {
  tool: {
    href: string;
    label: string;
    hint: string;
    icon: LucideIcon;
  };
}) {
  const Icon = tool.icon;
  return (
    <Link
      href={tool.href}
      className="rounded-2xl border border-sandstone-100 bg-cream px-4 py-4 flex items-center gap-4 active:scale-[0.99] hover:border-sandstone-200 transition-all shadow-soft"
    >
      <span className="w-11 h-11 rounded-full bg-ferrous-50 text-ferrous-600 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[16px] font-semibold text-ink leading-tight">{tool.label}</div>
        <div className="text-[12.5px] text-ink-3 mt-0.5 truncate">{tool.hint}</div>
      </div>
    </Link>
  );
}

function SecondaryToolCard({
  tool,
}: {
  tool: {
    href: string;
    label: string;
    hint: string;
    icon: LucideIcon;
  };
}) {
  const Icon = tool.icon;
  return (
    <Link
      href={tool.href}
      className="rounded-xl border border-sandstone-100 bg-white p-4 hover:border-sandstone-200 active:scale-[0.99] transition-all"
    >
      <Icon className="w-4 h-4 text-ink-3" />
      <div className="mt-2 text-[14px] font-semibold text-ink leading-tight">{tool.label}</div>
      <div className="text-[11px] text-ink-3 mt-0.5 leading-snug line-clamp-2">{tool.hint}</div>
    </Link>
  );
}
