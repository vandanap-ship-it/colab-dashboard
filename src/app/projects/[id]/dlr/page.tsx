import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { auth } from "@/lib/auth";
import { canSeeDesktop } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import Navbar from "@/components/Navbar";
import DateRangePicker from "@/components/DateRangePicker";
import DlrCsvButton, { type DlrCsvRow } from "@/components/DlrCsvButton";
import LabourBarChart, { type LabourBarPoint } from "@/components/LabourBarChart";
import { buildDayList, fmtDateLong, fmtDateShort, rangeFromSearchParams } from "@/lib/reports";

const LABOUR_CATEGORIES = ["Skilled", "Unskilled", "Mason", "Helper", "Supervisor"];

function fmtDay(d: Date) {
  return d.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default async function DlrUpdatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Both desktop and mobile can view DLR updates.

  const { id: projectId } = await params;
  const sp = await searchParams;
  const range = rangeFromSearchParams(sp);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, code: true },
  });
  if (!project) notFound();

  const start = new Date(range.from + "T00:00:00Z");
  const end = new Date(range.to + "T00:00:00Z");
  end.setUTCDate(end.getUTCDate() + 1);

  const entries = await prisma.progressEntry.findMany({
    where: { projectId, date: { gte: start, lt: end } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: {
      contractor: { select: { name: true } },
      labour: { select: { category: true, count: true } },
      wbsNode: {
        select: {
          id: true,
          name: true,
          parentId: true,
        },
      },
    },
  });

  const allNodes = await prisma.wBSNode.findMany({
    where: { projectId },
    select: { id: true, name: true, parentId: true, level: true },
  });
  const nameById = new Map(allNodes.map((n) => [n.id, n.name]));
  const parentById = new Map(allNodes.map((n) => [n.id, n.parentId]));
  const levelById = new Map(allNodes.map((n) => [n.id, n.level]));
  function locationFor(leafId: string): string {
    const parts: string[] = [];
    let cur: string | null = parentById.get(leafId) ?? null;
    let depth = 0;
    while (cur && depth < 6) {
      const lvl = levelById.get(cur);
      const nm = nameById.get(cur);
      if (lvl != null && lvl >= 1 && nm) parts.push(nm);
      cur = parentById.get(cur) ?? null;
      depth += 1;
    }
    return parts.reverse().join(" / ") || "—";
  }

  type Row = {
    id: string;
    date: Date;
    contractor: string;
    activity: string;
    location: string;
    perCategory: Record<string, number>;
    total: number;
    notes: string;
  };

  const rows: Row[] = entries
    .map((e) => {
      const perCategory: Record<string, number> = Object.fromEntries(
        LABOUR_CATEGORIES.map((c) => [c, 0]),
      );
      let total = 0;
      for (const l of e.labour) {
        if (perCategory[l.category] != null) {
          perCategory[l.category] += l.count;
        } else {
          // Tolerant of free-form categories — bucket into Helper
          perCategory.Helper = (perCategory.Helper ?? 0) + l.count;
        }
        total += l.count;
      }
      return {
        id: e.id,
        date: e.date,
        contractor: e.contractor?.name ?? "(unassigned)",
        activity: e.wbsNode.name,
        location: locationFor(e.wbsNode.id),
        perCategory,
        total,
        notes: e.notes ?? "",
      };
    })
    .filter((r) => r.total > 0); // Only entries that actually had labour logged

  // Day-level aggregation
  const totalLabour = rows.reduce((s, r) => s + r.total, 0);
  const uniqueDays = new Set(rows.map((r) => r.date.toISOString().slice(0, 10))).size;
  const uniqueContractors = new Set(rows.map((r) => r.contractor)).size;

  // Build chart data: planned vs actual per day across the date range.
  // Planned-labour input doesn't exist yet (V2) — planned series is 0 for now.
  const days = buildDayList(range.from, range.to);
  const actualByDay = new Map<string, number>(days.map((d) => [d, 0]));
  for (const r of rows) {
    const key = r.date.toISOString().slice(0, 10);
    if (actualByDay.has(key)) {
      actualByDay.set(key, (actualByDay.get(key) ?? 0) + r.total);
    }
  }
  const chartData: LabourBarPoint[] = days.map((d) => ({
    label: fmtDateShort(d),
    planned: 0,
    actual: actualByDay.get(d) ?? 0,
  }));

  const csvRows: DlrCsvRow[] = rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    contractor: r.contractor,
    location: r.location,
    activity: r.activity,
    totalLabour: r.total,
    skilled: r.perCategory.Skilled ?? 0,
    unskilled: r.perCategory.Unskilled ?? 0,
    mason: r.perCategory.Mason ?? 0,
    helper: r.perCategory.Helper ?? 0,
    supervisor: r.perCategory.Supervisor ?? 0,
    notes: r.notes,
  }));

  const isDesktop = canSeeDesktop(session.user.role);

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      {isDesktop && <Navbar />}
      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div>
          <Link
            href={isDesktop ? `/projects/${project.id}/snapshot` : `/mobile/${project.id}`}
            className="inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-900 transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            Back
          </Link>
          <div className="flex items-baseline gap-3 mt-2 flex-wrap">
            <h1 className="text-2xl font-semibold text-stone-900 tracking-tight inline-flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-stone-500" />
              DLR Updates
            </h1>
            {project.code && (
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
                {project.code}
              </span>
            )}
          </div>
          <p className="text-sm text-stone-500 mt-1">
            Daily Labour Report — every progress entry with its labour breakdown.
          </p>
        </div>

        {/* Toolbar */}
        <div className="rounded-xl border border-stone-200 bg-white p-4 flex items-center justify-between gap-3 flex-wrap">
          <DateRangePicker
            basePath={`/projects/${project.id}/dlr`}
            startDate={range.from}
            endDate={range.to}
          />
          <div className="text-xs text-stone-500">
            {fmtDateLong(range.from)} — {fmtDateLong(range.to)}
          </div>
          <DlrCsvButton
            rows={csvRows}
            filename={`dlr-${range.from}-to-${range.to}.csv`}
          />
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Entries" value={rows.length} />
          <Stat label="Days" value={uniqueDays} />
          <Stat label="Contractors" value={uniqueContractors} />
          <Stat label="Total labour" value={totalLabour} />
        </div>

        {/* Planned vs Actual chart */}
        <section className="rounded-xl border border-stone-200 bg-white p-6">
          <div className="flex items-baseline justify-between gap-2 flex-wrap mb-3">
            <h2 className="text-xs font-semibold text-stone-700 uppercase tracking-widest">
              Planned vs Actual labour
            </h2>
            <p className="text-[11px] text-stone-400">
              Planned-labour input ships in v2; planned series is 0 for now.
            </p>
          </div>
          {totalLabour === 0 ? (
            <p className="text-sm text-stone-500 text-center py-8">
              No labour entries in this date range.
            </p>
          ) : (
            <LabourBarChart data={chartData} />
          )}
        </section>

        {/* Table */}
        <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[820px]">
              <thead className="bg-stone-50">
                <tr className="text-[10px] uppercase tracking-wider text-stone-500">
                  <th className="text-left font-medium py-2 px-3">Date</th>
                  <th className="text-left font-medium py-2 px-3">Contractor</th>
                  <th className="text-left font-medium py-2 px-3">Location / Activity</th>
                  <th className="text-right font-medium py-2 px-3">Total</th>
                  {LABOUR_CATEGORIES.map((c) => (
                    <th
                      key={c}
                      className="text-right font-medium py-2 px-3 whitespace-nowrap"
                    >
                      {c}
                    </th>
                  ))}
                  <th className="text-left font-medium py-2 px-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5 + LABOUR_CATEGORIES.length}
                      className="py-10 text-center text-stone-500 text-sm"
                    >
                      No labour entries in this date range.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="border-t border-stone-100">
                      <td className="py-2 px-3 text-stone-700 whitespace-nowrap">
                        {fmtDay(r.date)}
                      </td>
                      <td className="py-2 px-3 text-stone-700">{r.contractor}</td>
                      <td className="py-2 px-3 max-w-[260px]">
                        <div className="font-medium text-stone-900 leading-snug">
                          {r.activity}
                        </div>
                        <div className="text-[10px] text-stone-500 mt-0.5">
                          {r.location}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums font-medium text-stone-900">
                        {r.total}
                      </td>
                      {LABOUR_CATEGORIES.map((c) => (
                        <td
                          key={c}
                          className="py-2 px-3 text-right tabular-nums text-stone-700"
                        >
                          {r.perCategory[c] || "—"}
                        </td>
                      ))}
                      <td className="py-2 px-3 text-stone-500 text-[11px] leading-snug max-w-[200px]">
                        {r.notes || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <p className="text-[10px] uppercase tracking-widest text-stone-500">{label}</p>
      <p className="text-2xl font-semibold text-stone-900 mt-1 tabular-nums">{value}</p>
    </div>
  );
}
