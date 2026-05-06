import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canSeeDesktop } from "@/lib/roles";
import {
  fmtDateLong,
  getObservationReport,
  getProjectMeta,
  rangeFromSearchParams,
} from "@/lib/reports";
import ReportShell, { ReportSection } from "@/components/ReportShell";

function fmtShort(d: Date): string {
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

export default async function ObservationsReportPage({
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

  const report = await getObservationReport(id, range.from, range.to);
  const t = report.totals;
  const periodLabel = `${fmtDateLong(range.from)} – ${fmtDateLong(range.to)}`;

  return (
    <ReportShell
      projectId={id}
      projectName={project.name}
      projectTagline={project.tagline}
      reportTitle="Master Observation Report"
      periodLabel={periodLabel}
      basePath={`/projects/${id}/reports/observations`}
      startDate={range.from}
      endDate={range.to}
    >
      <ReportSection index={1} title="Summary">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 print:grid-cols-4">
          <GroupCard
            title="Snags"
            rows={[
              ["New", t.issuesNew],
              ["Resolved", t.issuesResolved],
              ["Open at end", t.issuesOpenAtEnd],
            ]}
          />
          <GroupCard
            title="Inspections"
            rows={[
              ["New", t.inspectionsNew],
              ["Passed", t.inspectionsPassed],
              ["Rejected", t.inspectionsRejected],
              ["In review", t.inspectionsInReview],
            ]}
          />
          <GroupCard
            title="Concerns"
            rows={[
              ["New", t.concernsNew],
              ["Resolved", t.concernsResolved],
            ]}
          />
          <GroupCard
            title="Hindrances"
            rows={[
              ["New", t.hindrancesNew],
              ["Resolved", t.hindrancesResolved],
            ]}
          />
        </div>
      </ReportSection>

      <ReportSection index={2} title={`Snags · ${report.issues.length}`}>
        <DetailTable
          empty="No snags in this range."
          headers={["Description", "Activity", "Contractor", "Severity", "Status", "Created"]}
          rows={report.issues.map((i) => [
            i.description,
            i.activity ?? "—",
            i.contractor ?? "—",
            i.severity ?? "—",
            i.status,
            fmtShort(i.createdAt),
          ])}
        />
      </ReportSection>

      <ReportSection index={3} title={`Inspections · ${report.inspections.length}`}>
        <DetailTable
          empty="No inspections in this range."
          headers={["Title", "Activity", "Contractor", "Status", "Created", "Reviewed"]}
          rows={report.inspections.map((i) => [
            i.title,
            i.activity ?? "—",
            i.contractor ?? "—",
            i.status,
            fmtShort(i.createdAt),
            i.reviewedAt ? fmtShort(i.reviewedAt) : "—",
          ])}
        />
      </ReportSection>

      <ReportSection index={4} title="Concerns & Hindrances">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 print:grid-cols-2">
          <DetailTable
            compact
            title={`Concerns · ${report.concerns.length}`}
            empty="No concerns."
            headers={["Description", "Activity", "Status", "Created"]}
            rows={report.concerns.map((c) => [
              c.description,
              c.activity ?? "—",
              c.status,
              fmtShort(c.createdAt),
            ])}
          />
          <DetailTable
            compact
            title={`Hindrances · ${report.hindrances.length}`}
            empty="No hindrances."
            headers={["Description", "Activity", "Days impact", "Status", "Created"]}
            rows={report.hindrances.map((h) => [
              h.description,
              h.activity ?? "—",
              h.daysImpact != null ? String(h.daysImpact) : "—",
              h.status,
              fmtShort(h.createdAt),
            ])}
          />
        </div>
      </ReportSection>
    </ReportShell>
  );
}

function GroupCard({
  title,
  rows,
}: {
  title: string;
  rows: [string, number][];
}) {
  return (
    <div className="border border-stone-200 rounded-lg p-3">
      <p className="text-[10px] uppercase tracking-widest text-stone-500 mb-2">{title}</p>
      <dl className="space-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="text-stone-500">{label}</dt>
            <dd className="font-semibold text-stone-900 tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DetailTable({
  title,
  empty,
  headers,
  rows,
  compact,
}: {
  title?: string;
  empty: string;
  headers: string[];
  rows: string[][];
  compact?: boolean;
}) {
  return (
    <div className={compact ? "" : ""}>
      {title && (
        <h3 className="text-xs uppercase tracking-widest text-stone-500 mb-2">{title}</h3>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-stone-500 italic py-2">{empty}</p>
      ) : (
        <div className="rounded-lg border border-stone-200 overflow-x-auto">
          <table className={`w-full text-xs border-collapse ${compact ? "" : "min-w-[640px]"}`}>
            <thead className="bg-stone-50">
              <tr className="text-[10px] uppercase tracking-wider text-stone-500">
                {headers.map((h) => (
                  <th
                    key={h}
                    className="text-left font-medium py-1.5 px-3 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={i}
                  className="border-t border-stone-100 align-top break-inside-avoid"
                >
                  {r.map((cell, j) => (
                    <td
                      key={j}
                      className="py-1.5 px-3 text-stone-700 leading-snug"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
