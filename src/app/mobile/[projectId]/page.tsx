import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ClipboardCheck,
  ListChecks,
  PlusCircle,
  ShieldCheck,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TOOL_MODULES, canAccessTool, isScopedUser } from "@/lib/modules";
import { getDashboardManpowerStrip } from "@/lib/manpowerServer";
import { istDayStart } from "@/lib/istDay";

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

  // Anchor "today" to IST so a phone opened at 23:30 IST still lands on the
  // same date the site engineer just worked, not a UTC-rollover next day.
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

  type Tool = {
    key: string;
    href: string;
    label: string;
    icon: LucideIcon;
    primary?: boolean;
    tier: "primary" | "secondary";
  };
  // V1 mobile home — three primary CTAs (Progress, Manpower, Hindrance) that
  // the site team hits every day, plus a compact "More" section below for
  // less-frequent flows. QA/QC surfaces (Snag, Areas of Concern, Inspection)
  // are hidden entirely for V1 — those teams stay on their current tools
  // (WhatsApp / Colab wind-down) and come to Siddhi in V2. Expense/DLR live
  // in "More" only for staff (scoped contractors don't see them).
  const allTools: Tool[] = [
    {
      key: "new-progress",
      href: `/mobile/${projectId}/progress/new`,
      label: "New Progress",
      icon: PlusCircle,
      primary: true,
      tier: "primary",
    },
    {
      key: "manpower",
      href: `/mobile/${projectId}/manpower/new`,
      label: "Log Manpower",
      icon: Users,
      tier: "primary",
    },
    {
      key: "hindrance",
      href: `/mobile/${projectId}/hindrance/new`,
      label: "Log Hindrance",
      // AlertTriangle reads as "blocker / attention" — CheckSquare read as
      // "task done" which was semantically wrong for a hindrance.
      icon: AlertTriangle,
      tier: "primary",
    },
    {
      key: "permit",
      href: `/mobile/${projectId}/permit/new`,
      label: "Raise Work Permit",
      icon: ShieldCheck,
      tier: "primary",
    },
    {
      key: "permit-list",
      href: `/mobile/${projectId}/permit`,
      label: "Work Permits",
      icon: ShieldCheck,
      tier: "secondary",
    },
    {
      key: "site-progress",
      href: `/mobile/${projectId}/site-progress`,
      label: "Site Progress",
      icon: ListChecks,
      tier: "secondary",
    },
    {
      key: "expense",
      href: `/mobile/${projectId}/expense/new`,
      label: "Log Expense",
      icon: Wallet,
      tier: "secondary",
    },
    {
      key: "dlr",
      href: `/projects/${projectId}/dlr`,
      label: "DLR Updates",
      icon: ClipboardCheck,
      tier: "secondary",
    },
  ];

  // Filter tools by the user's module access. Internal staff see everything;
  // scoped contractors see only their module's tools. Promote the first
  // visible tool to "primary" if New Progress was filtered out.
  const tools = allTools.filter((t) =>
    canAccessTool(userModules, TOOL_MODULES[t.key] ?? []),
  );
  if (tools.length > 0 && !tools.some((t) => t.primary)) {
    tools[0] = { ...tools[0], primary: true };
  }
  const primaryTools = tools.filter((t) => t.tier === "primary");
  const secondaryTools = tools.filter((t) => t.tier === "secondary");

  const scoped = isScopedUser(userModules);

  return (
    <div className="px-4 py-6 space-y-6">
      {/* Compact identity line — engineer + project on one row. Removed the
          full "Welcome back, {name}" block and the "Loaded X" timestamp
          chip in the design pass: neither helped a site engineer opening
          the app to log work, and both pushed the primary CTA below the
          fold on smaller phones. */}
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold text-stone-900 tracking-tight truncate">
          {session?.user?.name}
        </h1>
        <p className="text-xs text-stone-500 truncate">{project.name}</p>
      </div>

      <section>
        <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">
          Log today
        </h2>
        <div className="grid grid-cols-1 gap-2.5">
          {primaryTools.map((t) => {
            const Icon = t.icon;
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`rounded-xl border p-5 active:scale-[0.99] transition-all flex items-center gap-4 ${
                  t.primary
                    ? "bg-stone-900 border-stone-900 text-white shadow-card hover:bg-stone-800"
                    : "bg-white border-stone-200 hover:border-stone-300 hover:shadow-soft"
                }`}
              >
                <Icon
                  className={`w-6 h-6 shrink-0 ${
                    t.primary ? "text-brand-400" : "text-stone-500"
                  }`}
                />
                <div
                  className={`text-base font-medium ${
                    t.primary ? "" : "text-stone-900"
                  }`}
                >
                  {t.label}
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {secondaryTools.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">
            More
          </h2>
          <div className="grid grid-cols-2 gap-2.5">
            {secondaryTools.map((t) => {
              const Icon = t.icon;
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  className="rounded-xl border p-4 active:scale-[0.99] transition-all bg-white border-stone-200 hover:border-stone-300 hover:shadow-soft"
                >
                  <Icon className="w-5 h-5 text-stone-500" />
                  <div className="mt-3 text-sm font-medium text-stone-900">
                    {t.label}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {!scoped && (
        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
              Today
            </h2>
            <TrendingUp className="w-4 h-4 text-stone-300" />
          </div>

          {/* Left: personal progress. Right: site plan-vs-actual manpower.
              The two together answer "what have I done today" and "is the
              site staffed to plan today" without leaving the home. */}
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-2xl font-semibold text-stone-900 tabular-nums">
                {myProgressToday}
              </div>
              <div className="text-xs text-stone-500 mt-0.5">
                {myProgressToday === 0
                  ? "No progress logged yet"
                  : `Progress ${myProgressToday === 1 ? "entry" : "entries"} logged`}
              </div>
            </div>
            <div>
              <PlanVsActualStat manpower={manpower} />
            </div>
          </div>

          {/* Plan-vs-actual bar (only when there IS a plan for today —
              rendering a bar against a "no plan" state would just be a
              flat gray line and clutter the card). */}
          {manpower.status !== "no-plan" && manpower.planned > 0 && (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-baseline justify-between text-[10px] uppercase tracking-wider text-stone-500">
                <span>Plan {manpower.planned}</span>
                <span>Actual {manpower.actual}</span>
              </div>
              <div className="relative h-2 rounded-full bg-stone-100 overflow-hidden">
                {/* Planned bar (light) — full width represents 100% of plan */}
                <div className="absolute inset-0 bg-amber-100" />
                {/* Actual bar (bold) — capped at 110% of plan so a wildly-
                    over-plan day doesn't visually blow out the card */}
                <div
                  className={
                    manpower.actual >= manpower.planned
                      ? "absolute inset-y-0 left-0 bg-emerald-500"
                      : "absolute inset-y-0 left-0 bg-amber-500"
                  }
                  style={{
                    width: `${Math.min(110, (manpower.actual / manpower.planned) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

/**
 * Compact right-side stat on the "Today" card. Shows planned vs actual
 * headcount as a single figure ("48 / 52" style) with a coloured tone
 * depending on delivery vs plan:
 *   - no plan yet  → "—" in muted grey
 *   - no manpower logged against a plan → "0" red, "Not logged yet" caption
 *   - actual < 90% of plan → amber "below"
 *   - 90% ≤ actual ≤ 110% of plan → emerald "on plan"
 *   - actual > 110% of plan → emerald "above plan"
 */
function PlanVsActualStat({
  manpower,
}: {
  manpower: {
    planned: number;
    actual: number;
    pctOfPlan: number | null;
    status: "no-plan" | "above" | "on-plan" | "below" | "not-logged";
  };
}) {
  if (manpower.status === "no-plan") {
    return (
      <div>
        <div className="text-2xl font-semibold text-stone-400 tabular-nums">—</div>
        <div className="text-xs text-stone-500 mt-0.5">No manpower plan set</div>
      </div>
    );
  }
  const toneClass =
    manpower.status === "below" || manpower.status === "not-logged"
      ? "text-amber-600"
      : "text-emerald-600";
  const caption =
    manpower.status === "not-logged"
      ? "Not logged yet"
      : manpower.status === "above"
        ? `Above plan (${manpower.planned} planned)`
        : manpower.status === "below"
          ? `Below plan (${manpower.planned} planned)`
          : `On plan (${manpower.planned} planned)`;
  return (
    <div>
      <div className={`text-2xl font-semibold tabular-nums ${toneClass}`}>
        {manpower.actual}
        <span className="text-sm text-stone-400 font-normal ml-1">workers</span>
      </div>
      <div className="text-xs text-stone-500 mt-0.5">{caption}</div>
    </div>
  );
}
