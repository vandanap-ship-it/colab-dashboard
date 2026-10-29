import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canSeeDesktop } from "@/lib/roles";
import { isScopedUser } from "@/lib/modules";
import {
  fmtDateLong,
  fmtDateShort,
  getLabourSupplyReport,
  getProjectMeta,
  rangeFromSearchParams,
  type LabourSupplyBreakdown,
} from "@/lib/reports";
import ReportShell, { ReportSection } from "@/components/ReportShell";

export default async function LabourSupplyReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");
  if (isScopedUser(session.user.modules)) redirect("/mobile");

  const { id } = await params;
  const sp = await searchParams;
  const range = rangeFromSearchParams(sp);

  const project = await getProjectMeta(id);
  if (!project) notFound();

  const report = await getLabourSupplyReport(id, range.from, range.to);
  const periodLabel = `${fmtDateLong(range.from)} – ${fmtDateLong(range.to)}`;

  // Count distinct contractors across all three sources — one contractor
  // appearing in two sources still counts once.
  const contractorNames = new Set<string>();
  for (const b of [report.progressLabour, report.manpowerLog, report.permitLabour]) {
    for (const c of b.contractors) contractorNames.add(c.contractorName);
  }
  const combinedGrandTotal =
    report.progressLabour.grandTotal +
    report.manpowerLog.grandTotal +
    report.permitLabour.grandTotal;

  return (
    <ReportShell
      projectId={id}
      projectName={project.name}
      projectTagline={project.tagline}
      reportTitle="Labour Supply Report"
      periodLabel={periodLabel}
      basePath={`/projects/${id}/reports/labour-supply`}
      startDate={range.from}
      endDate={range.to}
    >
      <ReportSection index={1} title="Summary">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 print:grid-cols-4">
          <Stat label="Days in range" value={report.days.length} />
          <Stat label="Distinct contractors" value={contractorNames.size} />
          <Stat label="Total (all sources)" value={combinedGrandTotal} />
          <Stat label="Sources counted" value={3} />
        </div>
        <p className="text-xs text-stone-500 italic mt-3 leading-relaxed">
          Labour data lives in three places in Siddhi: inside progress
          entries, inside the standalone manpower log, and inside work
          permits. Each is counted separately below so a day's number is
          traceable to its source. Totals above are the simple sum across
          all three (no de-dup).
        </p>
      </ReportSection>

      <BreakdownSection
        index={2}
        title="Progress labour"
        subtitle="Per-activity labour counts logged inside each progress entry."
        breakdown={report.progressLabour}
        days={report.days}
      />

      <BreakdownSection
        index={3}
        title="Manpower log (standalone)"
        subtitle="Daily headcount entered via the mobile Manpower tile."
        breakdown={report.manpowerLog}
        days={report.days}
      />

      <BreakdownSection
        index={4}
        title="Permit labour"
        subtitle="Role + # Workers listed on each Work Permit, grouped by the permit's creation day."
        breakdown={report.permitLabour}
        days={report.days}
      />
    </ReportShell>
  );
}

function BreakdownSection({
  index,
  title,
  subtitle,
  breakdown,
  days,
}: {
  index: number;
  title: string;
  subtitle: string;
  breakdown: LabourSupplyBreakdown;
  days: string[];
}) {
  return (
    <ReportSection index={index} title={title}>
      <p className="text-xs text-stone-500 italic -mt-1 mb-3 leading-relaxed">
        {subtitle}
      </p>

      {breakdown.contractors.length === 0 ? (
        <p className="text-sm text-stone-500 italic">
          No entries from this source in the selected date range.
        </p>
      ) : (
        <>
          <div className="space-y-8">
            {breakdown.contractors.map((c) => (
              <div key={c.contractorName} className="break-inside-avoid">
                <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
                  <h3 className="text-sm font-semibold text-stone-900">
                    {c.contractorName}
                  </h3>
                  <span className="text-xs text-stone-500">
                    Total: <strong className="text-stone-900">{c.grandTotal}</strong>
                  </span>
                </div>
                <div className="rounded-lg border border-stone-200 overflow-x-auto">
                  <table className="w-full text-xs border-collapse min-w-[560px]">
                    <thead className="bg-stone-50">
                      <tr className="text-[10px] uppercase tracking-wider text-stone-500">
                        <th className="text-left font-medium py-1.5 px-3 w-32">
                          Category
                        </th>
                        {days.map((d) => (
                          <th
                            key={d}
                            className="text-right font-medium py-1.5 px-2 whitespace-nowrap"
                          >
                            {fmtDateShort(d)}
                          </th>
                        ))}
                        <th className="text-right font-medium py-1.5 px-3 border-l border-stone-200">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.rows.map((r) => (
                        <tr
                          key={r.category}
                          className="border-t border-stone-100"
                        >
                          <td className="py-1.5 px-3 text-stone-700">{r.category}</td>
                          {r.perDay.map((v, i) => (
                            <td
                              key={i}
                              className="py-1.5 px-2 text-right tabular-nums text-stone-700"
                            >
                              {v || "—"}
                            </td>
                          ))}
                          <td className="py-1.5 px-3 text-right tabular-nums font-medium text-stone-900 border-l border-stone-200">
                            {r.total}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-stone-300 bg-stone-50/40">
                        <td className="py-1.5 px-3 font-semibold text-stone-900">
                          Total
                        </td>
                        {c.totalsPerDay.map((v, i) => (
                          <td
                            key={i}
                            className="py-1.5 px-2 text-right tabular-nums font-semibold text-stone-900"
                          >
                            {v || "—"}
                          </td>
                        ))}
                        <td className="py-1.5 px-3 text-right tabular-nums font-bold text-stone-900 border-l border-stone-200">
                          {c.grandTotal}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-lg border border-stone-200 overflow-x-auto">
            <table className="w-full text-xs border-collapse min-w-[560px]">
              <thead className="bg-stone-50">
                <tr className="text-[10px] uppercase tracking-wider text-stone-500">
                  <th className="text-left font-medium py-1.5 px-3 w-32">
                    All contractors
                  </th>
                  {days.map((d) => (
                    <th
                      key={d}
                      className="text-right font-medium py-1.5 px-2 whitespace-nowrap"
                    >
                      {fmtDateShort(d)}
                    </th>
                  ))}
                  <th className="text-right font-medium py-1.5 px-3 border-l border-stone-200">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="py-1.5 px-3 font-semibold text-stone-900">
                    Daily total
                  </td>
                  {breakdown.grandTotalPerDay.map((v, i) => (
                    <td
                      key={i}
                      className="py-1.5 px-2 text-right tabular-nums font-semibold text-stone-900"
                    >
                      {v || "—"}
                    </td>
                  ))}
                  <td className="py-1.5 px-3 text-right tabular-nums font-bold text-stone-900 border-l border-stone-200">
                    {breakdown.grandTotal}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </ReportSection>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-stone-200 p-3">
      <p className="text-[10px] uppercase tracking-widest text-stone-400">{label}</p>
      <p className="text-2xl font-semibold text-stone-900 tabular-nums mt-1">{value}</p>
    </div>
  );
}
