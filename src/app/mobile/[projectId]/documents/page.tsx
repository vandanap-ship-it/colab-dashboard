import Link from "next/link";
import {
  ArrowRight,
  BookUser,
  ClipboardList,
  Download,
  FileBarChart,
  FileText,
  HardHat,
  Package,
  ShieldCheck,
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

// Static templates the site team downloads to fill in for a specific job.
// Stored under public/templates/ so they ship with the deploy — updating a
// template = a code change + redeploy. That's fine for launch; if templates
// start changing weekly, move them to Vercel Blob and read the list from DB.
type Template = { label: string; sub: string; href: string };
const PERMIT_TEMPLATES: Template[] = [
  { label: "Permit — General Work", sub: "XLSX", href: "/templates/permits/permit-general-work.xlsx" },
  { label: "Permit — Work at Height", sub: "XLSX", href: "/templates/permits/permit-work-at-height.xlsx" },
  { label: "Permit — Hot Work", sub: "XLSX", href: "/templates/permits/permit-hot-work.xlsx" },
  { label: "Permit — De-shuttering", sub: "XLSX", href: "/templates/permits/permit-de-shuttering.xlsx" },
  { label: "Permit — De-shuttering", sub: "PDF", href: "/templates/permits/permit-de-shuttering.pdf" },
  { label: "Permit — Night / Holiday", sub: "XLSX", href: "/templates/permits/permit-night-holiday.xlsx" },
];
const CHECKLIST_TEMPLATES: Template[] = [
  { label: "Checklist — Concrete", sub: "PDF", href: "/templates/checklists/checklist-concrete.pdf" },
  { label: "Checklist — PPE", sub: "PDF", href: "/templates/checklists/checklist-ppe.pdf" },
  { label: "Checklist — Power Tools", sub: "PDF", href: "/templates/checklists/checklist-power-tools.pdf" },
  { label: "Checklist — Scaffolding", sub: "PDF", href: "/templates/checklists/checklist-scaffolding.pdf" },
];
const RECORD_TEMPLATES: Template[] = [
  { label: "EHS Tool Box Talk (TBT)", sub: "XLSX", href: "/templates/records/ehs-tool-box-talk.xlsx" },
  { label: "Meeting Attendance Sheet", sub: "PDF", href: "/templates/records/meeting-attendance-sheet.pdf" },
  { label: "P&M Vehicular Checklist", sub: "PDF", href: "/templates/records/pm-vehicular-checklist.pdf" },
];

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
    <div className="px-4 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-stone-900 tracking-tight">Documents</h1>
        <p className="text-xs text-stone-500 mt-1">
          Reports and reference data for this project.
        </p>
      </div>

      {/* Templates — permit forms, safety checklists, records. Tap to download. */}
      <TemplateSection title="Permits" icon={ShieldCheck} items={PERMIT_TEMPLATES} />
      <TemplateSection title="Checklists" icon={ClipboardList} items={CHECKLIST_TEMPLATES} />
      <TemplateSection title="Records" icon={FileText} items={RECORD_TEMPLATES} />

      <div className="space-y-2.5">
        <div className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold px-1">
          Reports
        </div>
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

/**
 * Group of downloadable templates. Rendered as a labelled list of anchor tags
 * with the download attribute so mobile browsers save the file directly
 * instead of trying to open it in-tab (Safari on iOS otherwise renders .xlsx
 * as garbled text). Static list — see the const arrays at the top of this
 * file for the source of truth.
 */
function TemplateSection({
  title,
  icon: Icon,
  items,
}: {
  title: string;
  icon: LucideIcon;
  items: Template[];
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center gap-2 px-1">
        <Icon className="w-3.5 h-3.5 text-stone-500" />
        <div className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">
          {title}
        </div>
      </div>
      <div className="space-y-2">
        {items.map((t) => (
          <a
            key={t.href}
            href={t.href}
            download
            className="rounded-xl border border-stone-200 bg-white p-4 flex items-center gap-3 hover:border-stone-300 hover:shadow-soft active:scale-[0.99] transition-all"
          >
            <span className="w-10 h-10 rounded-lg bg-stone-100 flex items-center justify-center text-stone-600 shrink-0">
              <Download className="w-5 h-5" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-stone-900">{t.label}</div>
              <div className="text-xs text-stone-500 mt-0.5">{t.sub}</div>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
