import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CheckSquare,
  ClipboardCheck,
  ListChecks,
  PlusCircle,
  RefreshCw,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TOOL_MODULES, canAccessTool, isScopedUser } from "@/lib/modules";

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

  const wbsCount = await prisma.wBSNode.count({ where: { projectId } });
  const myProgressToday = session?.user
    ? await prisma.progressEntry.count({
        where: {
          projectId,
          createdById: session.user.id,
          date: { gte: new Date(new Date().toDateString()) },
        },
      })
    : 0;

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
      icon: CheckSquare,
      tier: "primary",
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
      <div>
        <p className="text-sm text-stone-500">Welcome back,</p>
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">
          {session?.user?.name}
        </h1>
        <p className="text-xs text-stone-400 mt-1">{project.name}</p>
        {/* "Last sync" was misleading — this page is a Server Component, so
            the timestamp is the moment the server rendered the response, not
            when the offline queue last synced. "Loaded" is the honest label:
            the data on screen is as fresh as this render. */}
        <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-stone-500 bg-white border border-stone-200 rounded-full px-2.5 py-1">
          <RefreshCw className="w-3 h-3 text-stone-400" />
          Loaded{" "}
          {new Date().toLocaleString(undefined, {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
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
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-2xl font-semibold text-stone-900 tabular-nums">
                {myProgressToday}
              </div>
              <div className="text-xs text-stone-500 mt-0.5">Progress entries logged</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-stone-900 tabular-nums">{wbsCount}</div>
              <div className="text-xs text-stone-500 mt-0.5">Activities in scope</div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
