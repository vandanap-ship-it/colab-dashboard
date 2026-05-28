import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  Eye,
  ListChecks,
  PlusCircle,
  RefreshCw,
  TrendingUp,
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
  };
  const allTools: Tool[] = [
    {
      key: "new-progress",
      href: `/mobile/${projectId}/progress/new`,
      label: "New Progress",
      icon: PlusCircle,
      primary: true,
    },
    { key: "site-progress", href: `/mobile/${projectId}/site-progress`, label: "Site Progress", icon: ListChecks },
    { key: "snag", href: `/mobile/${projectId}/issue/new`, label: "Snag", icon: AlertTriangle },
    { key: "hindrance", href: `/mobile/${projectId}/hindrance/new`, label: "Hindrance", icon: CheckSquare },
    { key: "concern", href: `/mobile/${projectId}/concern/new`, label: "Areas of Concern", icon: Eye },
    {
      key: "inspection",
      href: `/mobile/${projectId}/inspection/new`,
      label: "Inspection",
      icon: ClipboardList,
    },
    {
      key: "dlr",
      href: `/projects/${projectId}/dlr`,
      label: "DLR Updates",
      icon: ClipboardCheck,
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

  const scoped = isScopedUser(userModules);

  return (
    <div className="px-4 py-6 space-y-6">
      <div>
        <p className="text-sm text-stone-500">Welcome back,</p>
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">
          {session?.user?.name}
        </h1>
        <p className="text-xs text-stone-400 mt-1">{project.name}</p>
        <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-stone-500 bg-white border border-stone-200 rounded-full px-2.5 py-1">
          <RefreshCw className="w-3 h-3 text-stone-400" />
          Last sync —{" "}
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
          My Tools
        </h2>
        <div className="grid grid-cols-2 gap-2.5">
          {tools.map((t) => {
            const Icon = t.icon;
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`rounded-xl border p-4 active:scale-[0.99] transition-all ${
                  t.primary
                    ? "bg-stone-900 border-stone-900 text-white shadow-card hover:bg-stone-800"
                    : "bg-white border-stone-200 hover:border-stone-300 hover:shadow-soft"
                }`}
              >
                <Icon
                  className={`w-5 h-5 ${
                    t.primary ? "text-brand-400" : "text-stone-500"
                  }`}
                />
                <div
                  className={`mt-3 text-sm font-medium ${
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
