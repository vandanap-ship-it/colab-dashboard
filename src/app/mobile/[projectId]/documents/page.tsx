import Link from "next/link";
import {
  ArrowRight,
  BookUser,
  ClipboardList,
  FileBarChart,
  FileText,
  HardHat,
  Package,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Item = {
  key: string;
  label: string;
  sub: string;
  icon: LucideIcon;
  href?: string;
  stub?: boolean;
};

export default async function MobileDocumentsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const items: Item[] = [
    {
      key: "reports",
      label: "All Reports",
      sub: "DPR, labour, observations & more",
      icon: FileText,
      href: `/projects/${projectId}/reports`,
    },
    {
      key: "dpr",
      label: "View DPR",
      sub: "Daily Progress Report",
      icon: FileText,
      href: `/projects/${projectId}/dpr`,
    },
    {
      key: "site-progress",
      label: "View Site Progress",
      sub: "All activities",
      icon: ClipboardList,
      href: `/mobile/${projectId}/site-progress`,
    },
    {
      key: "stock",
      label: "View Stock Consumption",
      sub: "Coming v1.1",
      icon: Package,
      stub: true,
    },
    {
      key: "labour-trend",
      label: "View Labour Trend",
      sub: "Coming v1.1",
      icon: HardHat,
      stub: true,
    },
    {
      key: "resource-requests",
      label: "View Resource Requests",
      sub: "Coming v1.1",
      icon: FileBarChart,
      stub: true,
    },
    {
      key: "directory",
      label: "View Directory",
      sub: "Coming v1.1",
      icon: BookUser,
      stub: true,
    },
  ];

  return (
    <div className="px-4 py-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-stone-900 tracking-tight">Documents</h1>
        <p className="text-xs text-stone-500 mt-1">
          Reports and reference data for this project.
        </p>
      </div>

      <div className="space-y-2.5">
        {items.map((it) => {
          const Icon = it.icon;
          const inner = (
            <div
              className={`rounded-xl border bg-white p-4 flex items-center gap-3 transition-all ${
                it.stub
                  ? "border-stone-200 opacity-60"
                  : "border-stone-200 hover:border-stone-300 hover:shadow-soft active:scale-[0.99]"
              }`}
            >
              <span className="w-10 h-10 rounded-lg bg-stone-100 flex items-center justify-center text-stone-600 shrink-0">
                <Icon className="w-5 h-5" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-stone-900">{it.label}</div>
                <div className="text-xs text-stone-500 mt-0.5">{it.sub}</div>
              </div>
              {!it.stub && <ArrowRight className="w-4 h-4 text-stone-300" />}
            </div>
          );
          if (it.stub) {
            return (
              <div key={it.key} className="cursor-not-allowed">
                {inner}
              </div>
            );
          }
          return (
            <Link key={it.key} href={it.href!}>
              {inner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
