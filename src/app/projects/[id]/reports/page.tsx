import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ClipboardCheck,
  FileBarChart,
  FileText,
  HardHat,
  Search,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { auth } from "@/lib/auth";
import { canSeeDesktop } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import Navbar from "@/components/Navbar";

type Report = {
  key: string;
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  cadence: "Daily" | "Weekly" | "On demand";
};

export default async function ReportsLandingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");

  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true, code: true, tagline: true },
  });
  if (!project) notFound();

  const reports: Report[] = [
    {
      key: "scorecard",
      title: "Site Progress Scorecard",
      description:
        "The daily master report — snapshot, contractor movement, block coverage, manpower, activity highlights with photos, milestone progress, block-wise progress + project health footer. Matches the Amanvana Phase 1 Scorecard PDF layout.",
      href: `/projects/${id}/reports/scorecard`,
      icon: FileBarChart,
      cadence: "Daily",
    },
    {
      key: "weekly",
      title: "Weekly Progress Report",
      description:
        "The weekly summary — overall progress, per-contractor milestone plan (to complete / to start / in progress / stalled), manpower chart + trade breakdown, delay reasons with mitigation plans. Matches the Amanvana weekly PDF layout.",
      href: `/projects/${id}/reports/weekly`,
      icon: FileBarChart,
      cadence: "Weekly",
    },
    {
      key: "dpr",
      title: "Daily Progress Report",
      description:
        "End-of-day site summary — labour, photos, hindrances, and snags raised today.",
      href: `/projects/${id}/dpr`,
      icon: FileText,
      cadence: "Daily",
    },
    {
      key: "master",
      title: "Master Report",
      description:
        "Weekly progress: project health, per-zone breakdown, all activities + reasons for delay.",
      href: `/projects/${id}/reports/master`,
      icon: FileBarChart,
      cadence: "Weekly",
    },
    {
      key: "labour-supply",
      title: "Labour Supply Report",
      description:
        "Daily labour count by contractor and category over a chosen window.",
      href: `/projects/${id}/reports/labour-supply`,
      icon: HardHat,
      cadence: "Weekly",
    },
    {
      key: "checklist",
      title: "Checklist Report",
      description:
        "All inspections by status with locations, contractors, pass / fail notes.",
      href: `/projects/${id}/reports/checklist`,
      icon: ClipboardCheck,
      cadence: "On demand",
    },
    {
      key: "contractor-summary",
      title: "Contractor Work Summary",
      description:
        "Per-contractor: activities touched, labour days, inspections, open snags.",
      href: `/projects/${id}/reports/contractor-summary`,
      icon: Users,
      cadence: "On demand",
    },
    {
      key: "observations",
      title: "Master Observation Report",
      description:
        "All defects / snags with category, severity, status, contractor, and timestamps.",
      href: `/projects/${id}/reports/observations`,
      icon: Search,
      cadence: "On demand",
    },
  ];

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      <Navbar />
      <main className="flex-1 w-full max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div>
          <Link
            href={`/projects/${project.id}/snapshot`}
            className="inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-900 transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to {project.name}
          </Link>
          <p className="text-[10px] uppercase tracking-[0.3em] text-amber-600 mt-3">
            Reports
          </p>
          <div className="flex items-baseline gap-3 mt-1 flex-wrap">
            <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">
              {project.name}
            </h1>
            {project.code && (
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
                {project.code}
              </span>
            )}
          </div>
          {project.tagline && (
            <p className="text-xs uppercase tracking-[0.2em] text-stone-400 mt-1">
              {project.tagline}
            </p>
          )}
          <p className="text-sm text-stone-500 mt-3 max-w-xl">
            Each report opens in a printer-friendly view. Use the Print button or{" "}
            <kbd className="px-1.5 py-0.5 text-[11px] bg-stone-100 rounded border border-stone-200">
              Cmd+P
            </kbd>{" "}
            to save as PDF.
          </p>
        </div>

        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {reports.map((r) => {
            const Icon = r.icon;
            return (
              <li key={r.key}>
                <Link
                  href={r.href}
                  className="group block h-full rounded-xl border border-stone-200 bg-white p-5 hover:border-stone-300 hover:shadow-card transition-all"
                >
                  <div className="flex items-start gap-4">
                    <span className="w-11 h-11 rounded-lg bg-stone-100 flex items-center justify-center text-stone-600 shrink-0 group-hover:bg-brand-50 group-hover:text-brand-700 transition-colors">
                      <Icon className="w-5 h-5" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold text-stone-900">
                          {r.title}
                        </h3>
                        <span className="text-[10px] uppercase tracking-wider text-stone-400 shrink-0">
                          {r.cadence}
                        </span>
                      </div>
                      <p className="text-xs text-stone-500 mt-1.5 leading-relaxed">
                        {r.description}
                      </p>
                      <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-stone-700 group-hover:text-stone-900">
                        Open report
                        <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>

        <section className="rounded-xl border-2 border-dashed border-stone-300 bg-white/40 p-6 text-center">
          <CalendarDays className="w-8 h-8 text-stone-300 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-stone-700">More reports coming</h3>
          <p className="text-sm text-stone-500 mt-1 max-w-md mx-auto">
            Earned Value, Material Quantity, Cash Flow, Equipment, Permit and Debit reports
            are scheduled once the underlying data is in place.
          </p>
        </section>
      </main>
    </div>
  );
}
