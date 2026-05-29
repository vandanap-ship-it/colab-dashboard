import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canSeeDesktop } from "@/lib/roles";
import { getDprData } from "@/lib/dpr";
import ReportShell, { ReportSection } from "@/components/ReportShell";
import DprDatePicker from "@/components/DprDatePicker";
import PhotoStrip from "@/components/PhotoStrip";
import { todayIso, isValidIsoDate } from "@/lib/reports";

function fmtDateLong(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function DprPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id: projectId } = await params;
  const { date: rawDate } = await searchParams;
  const date = rawDate && isValidIsoDate(rawDate) ? rawDate : todayIso();

  const dpr = await getDprData(projectId, date);
  if (!dpr) notFound();

  const isMobile = !canSeeDesktop(session.user.role);
  const labourCats = Object.entries(dpr.totals.labourByCategory).sort(
    ([, a], [, b]) => b - a,
  );

  return (
    <ReportShell
      projectId={projectId}
      projectName={dpr.project.name}
      projectTagline={dpr.project.tagline}
      reportTitle="Daily Progress Report"
      periodLabel={fmtDateLong(date)}
      basePath={`/projects/${projectId}/dpr`}
      hideDatePicker
      toolbarExtras={<DprDatePicker projectId={projectId} selected={date} />}
      isMobileViewer={isMobile}
    >
      <ReportSection index={1} title="Day at a glance">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 print:grid-cols-5">
          <Stat label="Activities updated" value={dpr.totals.activitiesUpdated} />
          <Stat label="Total labour" value={dpr.totals.totalLabour} />
          <Stat label="Contractors on site" value={dpr.totals.contractorsOnSite} />
          <Stat label="Snags raised" value={dpr.issuesRaised.length} />
          <Stat label="Hindrances raised" value={dpr.hindrancesRaised.length} />
        </div>
      </ReportSection>

      {labourCats.length > 0 && (
        <ReportSection index={2} title="Labour by category">
          <div className="rounded-lg border border-stone-200 overflow-hidden">
            <table className="w-full text-sm border-collapse">
              <tbody>
                {labourCats.map(([cat, n], i) => (
                  <tr
                    key={cat}
                    className={i === 0 ? "" : "border-t border-stone-100"}
                  >
                    <td className="py-2 px-4 text-stone-700">{cat}</td>
                    <td className="py-2 px-4 text-right tabular-nums font-medium text-stone-900">
                      {n}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-stone-300 bg-stone-50/40">
                  <td className="py-2 px-4 font-semibold text-stone-900">Total</td>
                  <td className="py-2 px-4 text-right tabular-nums font-bold text-stone-900">
                    {dpr.totals.totalLabour}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </ReportSection>
      )}

      <ReportSection index={3} title={`Progress entries · ${dpr.progressEntries.length}`}>
        {dpr.progressEntries.length === 0 ? (
          <p className="text-sm text-stone-500 italic">
            No progress entries logged on this date.
          </p>
        ) : (
          <div className="space-y-3">
            {dpr.progressEntries.map((p) => (
              <div
                key={p.id}
                className="rounded-lg border border-stone-200 p-4 break-inside-avoid"
              >
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-stone-900">
                      {p.activityName}
                    </h3>
                    {p.location && (
                      <p className="text-[10px] uppercase tracking-wider text-stone-500 mt-0.5">
                        {p.location}
                      </p>
                    )}
                  </div>
                  <span className="text-xs font-medium text-stone-700 shrink-0">
                    {Math.round(p.activityPercentComplete)}% complete
                  </span>
                </div>

                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-3 text-xs">
                  <Field label="Achieved" value={`${p.achievedQuantity} ${p.unit ?? ""}`} />
                  <Field
                    label="Cumulative"
                    value={`${p.cumulativeQuantity}${p.totalQuantity ? ` / ${p.totalQuantity}` : ""} ${p.unit ?? ""}`}
                  />
                  <Field label="Contractor" value={p.contractorName ?? "—"} />
                  <Field
                    label="Photos"
                    value={p.photos.length > 0 ? `${p.photos.length}` : "—"}
                  />
                </dl>

                {p.photos.length > 0 && (
                  <div className="mt-3">
                    <PhotoStrip photos={p.photos} size="md" maxInline={6} />
                  </div>
                )}

                {p.labour.length > 0 && (
                  <div className="mt-3 flex items-center gap-1.5 flex-wrap text-xs">
                    <span className="text-[10px] text-stone-500 uppercase tracking-wider mr-1">
                      Labour
                    </span>
                    {/* Fold duplicate categories so the pill row reads cleanly. */}
                    {Object.entries(
                      p.labour.reduce<Record<string, number>>((acc, l) => {
                        acc[l.category] = (acc[l.category] ?? 0) + l.count;
                        return acc;
                      }, {}),
                    ).map(([category, count]) => (
                      <span
                        key={category}
                        className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-700"
                      >
                        {category} <strong className="text-stone-900">{count}</strong>
                      </span>
                    ))}
                  </div>
                )}

                {p.notes && (
                  <p className="text-xs text-stone-600 mt-3 leading-relaxed">
                    {p.notes}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </ReportSection>

      <ReportSection index={4} title="Snags, concerns & hindrances">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 print:grid-cols-3">
          <ListSection title="Hindrances raised" items={dpr.hindrancesRaised} />
          <ListSection title="Snags raised" items={dpr.issuesRaised} />
          <ListSection title="Concerns raised" items={dpr.concernsRaised} />
          <ListSection title="Hindrances resolved" items={dpr.hindrancesResolved} />
          <ListSection title="Snags resolved" items={dpr.issuesResolved} />
          <ListSection title="Concerns resolved" items={dpr.concernsResolved} />
        </div>
      </ReportSection>
    </ReportShell>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-stone-200 p-3">
      <p className="text-[10px] uppercase tracking-widest text-stone-400">{label}</p>
      <p className="text-2xl font-semibold text-stone-900 mt-1 tabular-nums">{value}</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-stone-500">{label}</dt>
      <dd className="text-stone-900 font-medium">{value}</dd>
    </div>
  );
}

function ListSection({
  title,
  items,
}: {
  title: string;
  items: { id: string; description: string; severity?: string | null; status?: string }[];
}) {
  return (
    <section className="break-inside-avoid">
      <h3 className="text-xs uppercase tracking-widest text-stone-500 mb-2">
        {title} ({items.length})
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-stone-400 italic">None.</p>
      ) : (
        <ul className="space-y-1.5 text-xs text-stone-700">
          {items.map((it) => (
            <li key={it.id} className="leading-snug border-l-2 border-amber-300 pl-2">
              {it.description}
              {it.severity && (
                <span className="ml-1 text-[10px] uppercase font-semibold text-amber-700">
                  · {it.severity}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
