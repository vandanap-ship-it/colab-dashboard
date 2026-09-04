import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canSeeDesktop } from "@/lib/roles";
import { isScopedUser } from "@/lib/modules";
import {
  fmtDateLong,
  getChecklistReport,
  getProjectMeta,
  rangeFromSearchParams,
} from "@/lib/reports";
import ReportShell, { ReportSection } from "@/components/ReportShell";

const STATUS_ORDER: Array<"IN_REVIEW" | "PASSED" | "REJECTED"> = [
  "IN_REVIEW",
  "PASSED",
  "REJECTED",
];

const STATUS_META: Record<
  "IN_REVIEW" | "PASSED" | "REJECTED",
  { label: string; pill: string }
> = {
  IN_REVIEW: { label: "In Review", pill: "bg-amber-50 text-amber-800 ring-1 ring-amber-200" },
  PASSED: { label: "Closed", pill: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200" },
  REJECTED: { label: "Rejected", pill: "bg-red-50 text-red-800 ring-1 ring-red-200" },
};

function fmt(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default async function ChecklistReportPage({
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

  const data = await getChecklistReport(id, range.from, range.to);
  const periodLabel = `${fmtDateLong(range.from)} – ${fmtDateLong(range.to)}`;

  return (
    <ReportShell
      projectId={id}
      projectName={project.name}
      projectTagline={project.tagline}
      reportTitle="Checklist Report"
      periodLabel={periodLabel}
      basePath={`/projects/${id}/reports/checklist`}
      startDate={range.from}
      endDate={range.to}
    >
      <ReportSection index={1} title="Summary">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 print:grid-cols-5">
          <Stat label="Total" value={data.totals.total} />
          <Stat label="In Review" value={data.totals.inReview} tone="warn" />
          <Stat label="Closed" value={data.totals.passed} tone="ok" />
          <Stat label="Rejected" value={data.totals.rejected} tone="danger" />
          <Stat
            label="Success Rate"
            value={`${data.totals.successRate}%`}
            tone={data.totals.successRate >= 80 ? "ok" : "warn"}
          />
        </div>
      </ReportSection>

      {STATUS_ORDER.map((status, i) => {
        const rows = data.rows.filter((r) => r.status === status);
        const meta = STATUS_META[status];
        return (
          <ReportSection
            key={status}
            index={i + 2}
            title={`${meta.label} · ${rows.length}`}
          >
            {rows.length === 0 ? (
              <p className="text-xs text-stone-500 italic">None in this range.</p>
            ) : (
              <div className="rounded-lg border border-stone-200 overflow-x-auto">
                <table className="w-full text-xs min-w-[700px]">
                  <thead className="bg-stone-50 text-stone-500">
                    <tr>
                      <Th align="left">UID / Title</Th>
                      <Th align="left">Location</Th>
                      <Th align="left">Contractor</Th>
                      <Th align="left">Filled by</Th>
                      <Th align="left">Reviewed by</Th>
                      <Th>Items</Th>
                      <Th>Created</Th>
                      <Th>Reviewed</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t border-stone-100 break-inside-avoid">
                        <td className="py-2 px-3">
                          <div className="font-medium text-stone-900">{r.title}</div>
                          <div className="text-[10px] font-mono text-stone-400 mt-0.5">
                            {r.id.slice(0, 10).toUpperCase()}
                          </div>
                          {r.rejectionReason && (
                            <div className="text-[10px] text-red-600 mt-1">
                              Rejection: {r.rejectionReason}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-3 text-stone-700">{r.location}</td>
                        <td className="py-2 px-3 text-stone-700">
                          {r.contractorName ?? "—"}
                        </td>
                        <td className="py-2 px-3 text-stone-700">
                          {r.filledByName ?? "—"}
                        </td>
                        <td className="py-2 px-3 text-stone-700">
                          {r.reviewedByName ?? "—"}
                        </td>
                        <td className="py-2 px-3 text-right text-stone-700 tabular-nums">
                          {r.itemsPassed} / {r.itemsTotal}
                        </td>
                        <td className="py-2 px-3 text-right text-stone-700">
                          {fmt(r.createdAt)}
                        </td>
                        <td className="py-2 px-3 text-right text-stone-700">
                          {fmt(r.reviewedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ReportSection>
        );
      })}
    </ReportShell>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "left" }) {
  return (
    <th
      className={`text-[10px] uppercase tracking-wider font-medium py-2 px-3 ${
        align === "left" ? "text-left" : "text-right"
      }`}
    >
      {children}
    </th>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "ok" | "warn" | "danger";
}) {
  const colour =
    tone === "ok" ? "text-emerald-600"
      : tone === "warn" ? "text-amber-600"
        : tone === "danger" ? "text-red-600"
          : "text-stone-900";
  return (
    <div className="rounded-lg border border-stone-200 p-3">
      <p className="text-[10px] uppercase tracking-widest text-stone-400">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums mt-1 ${colour}`}>{value}</p>
    </div>
  );
}
