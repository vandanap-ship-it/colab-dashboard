import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ClipboardCheck,
  HardHat,
  ListChecks,
  PlusCircle,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TOOL_MODULES, canAccessTool, isScopedUser } from "@/lib/modules";
import { getDashboardManpowerStrip } from "@/lib/manpowerServer";
import { istDayStart } from "@/lib/istDay";

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
  const [myProgressToday, manpower] = await Promise.all([
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
  ]);

  const userModules = session?.user?.modules ?? null;
  const scoped = isScopedUser(userModules);

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
      key: "dlr",
      href: `/projects/${projectId}/dlr`,
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
      <section
        className="px-5 pt-6 pb-8 border-b border-sandstone-100"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        <p className="font-serif italic text-[13px] text-ferrous-600 tracking-wide">
          {dateLine}
        </p>
        <h1 className="font-serif text-[36px] leading-[1.05] text-ink mt-1 tracking-tight">
          {project.name}
        </h1>
        {session?.user?.name && (
          <p className="text-[13px] text-ink-2 mt-3">
            <span className="text-ink-3">Good morning,</span>{" "}
            <span className="font-medium text-ink">{session.user.name.split(" ")[0]}</span>
          </p>
        )}
      </section>

      <div className="px-5 pt-6 space-y-7">
        {/* Site pulse — one editorial statistic card. Answers "is the
            site staffed today?" in one glance. Only rendered for internal
            staff — contractor-scoped users don't own that question. */}
        {!scoped && <SitePulse manpower={manpower} myProgressToday={myProgressToday} />}

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
