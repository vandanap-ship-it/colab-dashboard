import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canSeeDesktop } from "@/lib/roles";
import {
  fmtDateLong,
  getContractorWorkSummary,
  getProjectMeta,
  rangeFromSearchParams,
} from "@/lib/reports";
import ReportShell, { ReportSection } from "@/components/ReportShell";

export default async function ContractorSummaryReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");

  const { id } = await params;
  const sp = await searchParams;
  const range = rangeFromSearchParams(sp);

  const project = await getProjectMeta(id);
  if (!project) notFound();

  const report = await getContractorWorkSummary(id, range.from, range.to);

  const totals = report.rows.reduce(
    (acc, r) => {
      acc.activitiesUpdated += r.activitiesUpdated;
      acc.progressEntries += r.progressEntries;
      acc.totalLabour += r.totalLabour;
      acc.inspectionsTotal += r.inspectionsTotal;
      acc.inspectionsPassed += r.inspectionsPassed;
      acc.inspectionsRejected += r.inspectionsRejected;
      acc.issuesOpen += r.issuesOpen;
      acc.issuesResolved += r.issuesResolved;
      return acc;
    },
    {
      activitiesUpdated: 0,
      progressEntries: 0,
      totalLabour: 0,
      inspectionsTotal: 0,
      inspectionsPassed: 0,
      inspectionsRejected: 0,
      issuesOpen: 0,
      issuesResolved: 0,
    },
  );

  const periodLabel = `${fmtDateLong(range.from)} – ${fmtDateLong(range.to)}`;

  return (
    <ReportShell
      projectId={id}
      projectName={project.name}
      projectTagline={project.tagline}
      reportTitle="Contractor Work Summary"
      periodLabel={periodLabel}
      basePath={`/projects/${id}/reports/contractor-summary`}
      startDate={range.from}
      endDate={range.to}
    >
      <ReportSection index={1} title="Per-contractor performance">
        {report.rows.length === 0 ? (
          <p className="text-sm text-stone-500 italic">
            No contractor activity in this range.
          </p>
        ) : (
          <div className="rounded-lg border border-stone-200 overflow-x-auto">
            <table className="w-full text-xs border-collapse min-w-[720px]">
              <thead className="bg-stone-50">
                <tr className="text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
                  <th rowSpan={2} className="text-left font-medium py-2 px-3 align-bottom">
                    Contractor
                  </th>
                  <th rowSpan={2} className="text-right font-medium py-2 px-3 align-bottom">
                    Activities
                  </th>
                  <th rowSpan={2} className="text-right font-medium py-2 px-3 align-bottom">
                    Entries
                  </th>
                  <th rowSpan={2} className="text-right font-medium py-2 px-3 align-bottom">
                    Labour
                  </th>
                  <th colSpan={3} className="text-center font-medium py-2 px-3 border-l border-stone-200">
                    Inspections
                  </th>
                  <th colSpan={2} className="text-center font-medium py-2 px-3 border-l border-stone-200">
                    Snags
                  </th>
                </tr>
                <tr className="text-[10px] uppercase tracking-wider text-stone-400 border-b border-stone-200">
                  <th className="text-right font-medium py-1 px-3 border-l border-stone-200">
                    Total
                  </th>
                  <th className="text-right font-medium py-1 px-3">Passed</th>
                  <th className="text-right font-medium py-1 px-3">Rejected</th>
                  <th className="text-right font-medium py-1 px-3 border-l border-stone-200">
                    Open
                  </th>
                  <th className="text-right font-medium py-1 px-3">Resolved</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr
                    key={r.contractorId ?? r.contractorName}
                    className="border-t border-stone-100"
                  >
                    <td className="py-2 px-3 font-medium text-stone-900">
                      {r.contractorName}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-stone-700">
                      {r.activitiesUpdated}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-stone-700">
                      {r.progressEntries}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-stone-900 font-medium">
                      {r.totalLabour}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-stone-700 border-l border-stone-200">
                      {r.inspectionsTotal}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-emerald-700">
                      {r.inspectionsPassed || "—"}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-red-700">
                      {r.inspectionsRejected || "—"}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-amber-700 border-l border-stone-200">
                      {r.issuesOpen || "—"}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-stone-700">
                      {r.issuesResolved || "—"}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-stone-300 bg-stone-50/50">
                  <td className="py-2 px-3 font-semibold text-stone-900">Total</td>
                  <td className="py-2 px-3 text-right tabular-nums font-semibold text-stone-900">
                    {totals.activitiesUpdated}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums font-semibold text-stone-900">
                    {totals.progressEntries}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums font-bold text-stone-900">
                    {totals.totalLabour}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums font-semibold text-stone-900 border-l border-stone-200">
                    {totals.inspectionsTotal}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums font-semibold text-stone-900">
                    {totals.inspectionsPassed}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums font-semibold text-stone-900">
                    {totals.inspectionsRejected}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums font-semibold text-stone-900 border-l border-stone-200">
                    {totals.issuesOpen}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums font-semibold text-stone-900">
                    {totals.issuesResolved}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </ReportSection>
    </ReportShell>
  );
}
