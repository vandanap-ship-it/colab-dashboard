"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  ClipboardCheck,
  LayoutDashboard,
  Lightbulb,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Tab = {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
  tone?: "default" | "accent";
};

export default function ProjectTabs({
  projectId,
  myActionsCount,
}: {
  projectId: string;
  myActionsCount?: number;
}) {
  const pathname = usePathname();

  const tabs: Tab[] = [
    {
      key: "snapshot",
      label: "Snapshot",
      href: `/projects/${projectId}/snapshot`,
      icon: LayoutDashboard,
    },
    {
      key: "progress",
      label: "Progress",
      href: `/projects/${projectId}/progress`,
      icon: BarChart3,
    },
    {
      key: "qaqc",
      label: "QAQC",
      href: `/projects/${projectId}/qaqc`,
      icon: ClipboardCheck,
    },
    {
      key: "my-actions",
      label: "My Actions",
      href: `/projects/${projectId}/my-actions`,
      icon: Sparkles,
      badge: myActionsCount,
    },
    {
      key: "insights",
      label: "Insights",
      href: `/projects/${projectId}/insights`,
      icon: Lightbulb,
      tone: "accent",
    },
  ];

  // Match by leading segment so nested URLs (e.g. /qaqc/123) still highlight QAQC.
  const isActive = (tab: Tab) => {
    const seg = `/projects/${projectId}/${tab.key}`;
    return pathname === seg || pathname.startsWith(seg + "/");
  };

  return (
    <nav
      role="tablist"
      className="w-full border border-stone-200 rounded-xl bg-white p-1 flex items-center gap-0.5 shadow-soft overflow-x-auto"
    >
      {tabs.map((tab) => {
        const active = isActive(tab);
        const accent = tab.tone === "accent";
        const Icon = tab.icon;

        const base =
          "flex-1 min-w-fit text-center text-sm font-medium px-3 py-2 rounded-lg transition-all duration-150 inline-flex items-center justify-center gap-2";

        let cls: string;
        if (active && accent) {
          cls = `${base} bg-brand-400 text-stone-900 shadow-soft`;
        } else if (active) {
          cls = `${base} bg-stone-900 text-white shadow-soft`;
        } else if (accent) {
          cls = `${base} text-stone-700 hover:bg-brand-50 hover:text-brand-700`;
        } else {
          cls = `${base} text-stone-600 hover:text-stone-900 hover:bg-stone-50`;
        }

        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={cls}
            role="tab"
            aria-selected={active}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span>{tab.label}</span>
            {tab.badge != null && tab.badge > 0 && (
              <span
                className={
                  "text-[10px] font-bold rounded-full min-w-4 h-4 px-1 flex items-center justify-center " +
                  (active
                    ? "bg-white/20 text-white"
                    : "bg-stone-900 text-white")
                }
              >
                {tab.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
