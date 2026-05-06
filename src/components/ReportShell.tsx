import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import PrintButton from "./PrintButton";
import DateRangePicker from "./DateRangePicker";

/**
 * Print-friendly White Lotus branded shell for any /projects/[id]/reports/*
 * page. Renders:
 *
 *   [Toolbar — print:hidden] back · breadcrumb · [date range picker] · Print
 *   [Brand band — dark navy] WL wordmark, project tagline, report title, period
 *   [body via children]
 *   [Footer — print only]
 */
export default function ReportShell({
  projectId,
  projectName,
  projectTagline,
  reportTitle,
  periodLabel,
  basePath,
  startDate,
  endDate,
  children,
  backHref,
  isMobileViewer = false,
  hideDatePicker = false,
  toolbarExtras,
}: {
  projectId: string;
  projectName: string;
  projectTagline?: string | null;
  reportTitle: string;
  periodLabel: string;
  /** Path of the current report page (used for date-picker query updates). */
  basePath: string;
  startDate?: string;
  endDate?: string;
  children: React.ReactNode;
  backHref?: string;
  isMobileViewer?: boolean;
  hideDatePicker?: boolean;
  /** Extra controls to render in the toolbar (e.g. a single-date picker for DPR). */
  toolbarExtras?: React.ReactNode;
}) {
  const fallbackBack = isMobileViewer
    ? `/mobile/${projectId}/documents`
    : `/projects/${projectId}/reports`;

  return (
    <div className="flex-1 flex flex-col bg-white">
      {/* Toolbar — hidden in print */}
      <div className="print:hidden border-b border-stone-200 bg-white sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href={backHref ?? fallbackBack}
              className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-900 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </Link>
            <span className="hidden sm:inline-block w-px h-5 bg-stone-200" aria-hidden />
            <span className="text-sm text-stone-700 truncate">
              <span className="text-stone-400">Reports</span>
              <span className="text-stone-300 mx-2">/</span>
              <span className="font-medium text-stone-900">{reportTitle}</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            {toolbarExtras}
            {!hideDatePicker && startDate && endDate && (
              <DateRangePicker
                basePath={basePath}
                startDate={startDate}
                endDate={endDate}
              />
            )}
            <PrintButton />
          </div>
        </div>
      </div>

      {/* Branded header */}
      <div className="bg-stone-900 text-white">
        <div className="max-w-5xl mx-auto px-8 py-10 print:py-7 print:px-10">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-[0.3em] text-amber-400 uppercase">
                White Lotus
              </p>
              {projectTagline && (
                <p className="text-[10px] tracking-[0.3em] text-stone-400 uppercase mt-1">
                  {projectTagline}
                </p>
              )}
              <span className="inline-block w-8 h-0.5 bg-amber-400 mt-4" aria-hidden />
              <h1 className="text-3xl print:text-2xl font-semibold tracking-tight mt-3">
                {reportTitle}
              </h1>
            </div>
            <div className="text-right text-stone-300 shrink-0">
              <p className="text-[10px] uppercase tracking-[0.25em] text-stone-400">
                Report period
              </p>
              <p className="text-base font-medium text-white mt-1">{periodLabel}</p>
              {projectName && (
                <p className="text-xs text-stone-400 mt-2">{projectName}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-8 py-10 print:px-10 print:py-6">
        {children}
      </main>

      {/* Print footer */}
      <footer className="hidden print:block max-w-5xl w-full mx-auto px-10 py-4 border-t border-stone-200 text-center text-[10px] text-stone-400">
        {projectName} · {reportTitle} · {periodLabel}
      </footer>
    </div>
  );
}

export function ReportSection({
  index,
  title,
  description,
  children,
}: {
  index: number | string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10 last:mb-0">
      <div className="flex items-baseline gap-3 mb-4">
        <span className="text-[10px] tracking-[0.3em] text-amber-600 uppercase">
          {String(index).padStart(2, "0")} ·
        </span>
        <h2 className="text-sm font-semibold text-stone-700 uppercase tracking-[0.2em]">
          {title}
        </h2>
      </div>
      {description && <p className="text-xs text-stone-500 mb-4">{description}</p>}
      {children}
    </section>
  );
}
