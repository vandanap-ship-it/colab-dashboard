import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canSeeDesktop } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import {
  fmtDateLong,
  getMasterReport,
  getProjectMeta,
  rangeFromSearchParams,
} from "@/lib/reports";
import ReportShell, { ReportSection } from "@/components/ReportShell";
import ProbabilityBadge from "@/components/ProbabilityBadge";
import PhotoStrip from "@/components/PhotoStrip";
import MasterReportCsvButton from "@/components/MasterReportCsvButton";

function fmt(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Signed delay → readable label. Positive = late, negative = ahead, 0 = on time. */
function formatDelay(days: number): string {
  if (days === 0) return "0 Days";
  if (days > 0) return `${days} Days late`;
  return `${Math.abs(days)} Days ahead`;
}

/** Colour tone: positive = danger (red), negative = ok-but-green (success). */
function delayTone(days: number): "danger" | "ok" | "success" {
  if (days > 0) return "danger";
  if (days < 0) return "success";
  return "ok";
}

export default async function MasterReportPage({
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

  const data = await getMasterReport(id, range.from, range.to);

  // Project Highlights: progress entries with photos in the date range.
  const start = new Date(range.from + "T00:00:00Z");
  const endExclusive = new Date(range.to + "T00:00:00Z");
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const highlightEntries = await prisma.progressEntry.findMany({
    where: {
      projectId: id,
      date: { gte: start, lt: endExclusive },
      photos: { some: {} },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 30,
    include: {
      contractor: { select: { name: true } },
      photos: { select: { id: true, url: true }, orderBy: { uploadedAt: "asc" } },
      wbsNode: { select: { id: true, name: true, parentId: true, totalQuantity: true, unit: true } },
    },
  });

  // Build location path — walks up to 6 parents from each highlight entry's
  // WBSNode. Previous code loaded the entire WBSNode table (~14k rows for
  // Amanvana) to build these lookups, costing ~10 seconds on the deploy.
  // Instead: walk the tree level-by-level in ID batches, stopping when the
  // frontier is empty or we've climbed 6 levels. Worst case here is ~30
  // highlights × 7 levels = ~210 rows fetched, in ~7 short queries.
  const seedIds = new Set<string>();
  for (const e of highlightEntries) {
    if (e.wbsNode?.id) seedIds.add(e.wbsNode.id);
  }
  const nodeById = new Map<string, { id: string; name: string; parentId: string | null; level: number }>();
  let frontier: string[] = [...seedIds];
  for (let depth = 0; depth < 7 && frontier.length > 0; depth++) {
    const found = await prisma.wBSNode.findMany({
      where: { projectId: id, id: { in: frontier } },
      select: { id: true, name: true, parentId: true, level: true },
    });
    const next: string[] = [];
    for (const n of found) {
      if (!nodeById.has(n.id)) {
        nodeById.set(n.id, n);
        if (n.parentId) next.push(n.parentId);
      }
    }
    frontier = [...new Set(next)];
  }
  function locationFor(nodeId: string): string {
    const parts: string[] = [];
    let cur: string | null = nodeById.get(nodeId)?.parentId ?? null;
    let depth = 0;
    while (cur && depth < 6) {
      const n = nodeById.get(cur);
      if (n && n.level >= 1) parts.push(n.name);
      cur = n?.parentId ?? null;
      depth += 1;
    }
    return parts.reverse().join(" / ") || "—";
  }

  const periodLabel = `${fmtDateLong(range.from)} – ${fmtDateLong(range.to)}`;

  return (
    <ReportShell
      projectId={id}
      projectName={project.name}
      projectTagline={project.tagline}
      reportTitle="Weekly Progress Report"
      periodLabel={periodLabel}
      basePath={`/projects/${id}/reports/master`}
      startDate={range.from}
      endDate={range.to}
      toolbarExtras={
        <MasterReportCsvButton
          projectName={project.name}
          projectCode={project.code ?? null}
          periodLabel={periodLabel}
          data={data}
        />
      }
    >
      {/* SECTION 01 — Overall Project Health */}
      <ReportSection index={1} title="Overall Project Health">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 print:grid-cols-4">
          {/* Physical Progress */}
          <div className="rounded-lg border border-stone-200 p-4">
            <p className="text-[10px] uppercase tracking-widest text-stone-400">
              Physical Progress
            </p>
            <ArcGauge percent={data.overall.achievedPercent} />
            <div className="space-y-1.5 mt-3 text-xs">
              <PercentBar
                label="Planned"
                value={data.overall.plannedPercent}
                color="bg-amber-200"
              />
              <PercentBar
                label="Achieved"
                value={data.overall.achievedPercent}
                color="bg-amber-500"
              />
            </div>
          </div>

          {/* Timeline */}
          <div className="rounded-lg border border-stone-200 p-4">
            <p className="text-[10px] uppercase tracking-widest text-stone-400">
              Timeline
            </p>
            <div className="mt-2 space-y-3">
              <TimelineRow
                topLabel="Planned Start"
                bottomLabel="Planned End"
                topDate={fmt(data.overall.plannedStart)}
                bottomDate={fmt(data.overall.plannedEnd)}
                tone="planned"
              />
              <TimelineRow
                topLabel="Actual Start"
                bottomLabel="Projected End"
                topDate={fmt(data.overall.actualStart)}
                bottomDate={fmt(data.overall.projectedEnd)}
                tone="actual"
              />
            </div>
          </div>

          {/* Schedule Summary */}
          <div className="rounded-lg border border-stone-200 p-4">
            <p className="text-[10px] uppercase tracking-widest text-stone-400">
              Schedule Summary
            </p>
            <dl className="mt-2 space-y-1.5 text-xs">
              <KV label="Project Start" value={fmt(data.overall.plannedStart)} />
              <KV label="Project End" value={fmt(data.overall.plannedEnd)} />
              <KV label="RERA End Date" value={fmt(data.overall.reraEndDate)} />
              <KV
                label="Planned Duration"
                value={
                  data.overall.plannedDurationDays != null
                    ? `${data.overall.plannedDurationDays} Days`
                    : "—"
                }
              />
              <KV
                label="Projected Duration"
                value={
                  data.overall.projectedDurationDays != null
                    ? `${data.overall.projectedDurationDays} Days`
                    : "—"
                }
              />
              <div className="flex items-center justify-between pt-1">
                <dt className="text-stone-500">On-Time Probability</dt>
                <dd>
                  <ProbabilityBadge delayDays={data.overall.totalDelayDays} size="xs" />
                </dd>
              </div>
            </dl>
          </div>

          {/* Key Metrics */}
          <div className="rounded-lg border border-stone-200 p-4">
            <p className="text-[10px] uppercase tracking-widest text-stone-400">
              Key Metrics
            </p>
            <div className="mt-2 space-y-3">
              <Metric
                label="Total Delay"
                value={formatDelay(data.overall.totalDelayDays)}
                tone={delayTone(data.overall.totalDelayDays)}
              />
              <Metric
                label="RERA Delay"
                value={formatDelay(data.overall.reraDelayDays)}
                tone={delayTone(data.overall.reraDelayDays)}
              />
              <Metric
                label="Hindrances"
                value={`${data.overall.hindrancesOpen} open`}
                tone={data.overall.hindrancesOpen > 0 ? "danger" : "ok"}
              />
            </div>
          </div>
        </div>
      </ReportSection>

      {/* SECTION 02 — Project Health by Zone */}
      <ReportSection index={2} title="Project Health by Zone">
        {data.perZone.length === 0 ? (
          <p className="text-sm text-stone-500 italic">
            No phase data — import a schedule first.
          </p>
        ) : (
          <div className="rounded-lg border border-stone-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-stone-50 text-stone-500">
                <tr>
                  <Th align="left">Zone</Th>
                  <Th>Start Date</Th>
                  <Th>Finish Date</Th>
                  <Th>Duration</Th>
                  <Th>Total Delay</Th>
                  <Th>RERA</Th>
                  <Th>Completion</Th>
                </tr>
              </thead>
              <tbody>
                {data.perZone.map((p) => (
                  <ZoneRow key={p.id} phase={p} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportSection>

      {/* SECTION 03 — Project Highlights (progress entries with photos) */}
      {highlightEntries.length > 0 && (
        <ReportSection
          index={3}
          title="Project Highlights"
          description={`${highlightEntries.length} entries with photos in this period`}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:grid-cols-2">
            {highlightEntries.map((e) => (
              <div
                key={e.id}
                className="break-inside-avoid rounded-lg border border-stone-200 p-4 space-y-3"
              >
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-widest text-stone-400 truncate">
                      {locationFor(e.wbsNode.id)}
                    </p>
                    <h3 className="text-sm font-semibold text-stone-900 leading-snug mt-0.5">
                      {e.wbsNode.name}
                    </h3>
                  </div>
                  <span className="text-[10px] text-stone-500 whitespace-nowrap">
                    {fmt(e.date)}
                  </span>
                </div>
                <PhotoStrip photos={e.photos} size="lg" maxInline={6} />
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <KV label="Achieved" value={String(e.achievedQuantity)} />
                  <KV label="Cumulative" value={String(e.cumulativeQuantity)} />
                  <KV label="Contractor" value={e.contractor?.name ?? "—"} />
                  <KV
                    label="Activity %"
                    value={
                      e.wbsNode.totalQuantity && e.wbsNode.totalQuantity > 0
                        ? `${Math.round((e.cumulativeQuantity / e.wbsNode.totalQuantity) * 100)}%`
                        : "—"
                    }
                  />
                </dl>
                {e.notes && (
                  <p className="text-[11px] text-stone-600 leading-relaxed">{e.notes}</p>
                )}
              </div>
            ))}
          </div>
        </ReportSection>
      )}

      {/* SECTION 04 — Total Activities */}
      <ReportSection
        index={4}
        title="Work Activity Summary · Total Activities"
        description={`${data.totalActivities.length} activities`}
      >
        {data.totalActivities.length === 0 ? (
          <p className="text-sm text-stone-500 italic">No activities loaded.</p>
        ) : (
          <div className="rounded-lg border border-stone-200 overflow-x-auto">
            <table className="w-full text-xs min-w-[760px]">
              <thead className="bg-stone-50 text-stone-500">
                <tr>
                  <Th align="left">Activity / Location</Th>
                  <Th>Plan %</Th>
                  <Th>Actual %</Th>
                  <Th align="left">Reason for Delay</Th>
                  <Th>Planned Start</Th>
                  <Th>Planned End</Th>
                  <Th>Projected End</Th>
                </tr>
              </thead>
              <tbody>
                {data.totalActivities.map((a) => (
                  <tr key={a.id} className="border-t border-stone-100 break-inside-avoid">
                    <td className="py-2 px-3">
                      <div className="font-medium text-stone-900">{a.name}</div>
                      <div className="text-[10px] text-stone-500 mt-0.5">{a.location}</div>
                    </td>
                    <td className="py-2 px-3">
                      <PercentInline value={a.plannedPercent} colour="amber-200" />
                    </td>
                    <td className="py-2 px-3">
                      <PercentInline value={a.actualPercent} colour="amber-500" />
                    </td>
                    <td className="py-2 px-3 text-stone-600 text-[11px]">
                      {a.delayReason ?? "—"}
                    </td>
                    <td className="py-2 px-3 text-stone-700 text-right">
                      {fmt(a.plannedStart)}
                    </td>
                    <td className="py-2 px-3 text-stone-700 text-right">
                      {fmt(a.plannedEnd)}
                    </td>
                    <td className="py-2 px-3 text-stone-700 text-right">
                      {fmt(a.projectedEnd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportSection>
    </ReportShell>
  );
}

// ---------- presentational sub-components ----------

function ArcGauge({ percent }: { percent: number }) {
  const p = Math.max(0, Math.min(100, percent));
  const radius = 50;
  const circ = Math.PI * radius; // half-circle circumference
  const dashOffset = circ * (1 - p / 100);
  return (
    <div className="relative flex items-center justify-center mt-2 mb-1">
      <svg viewBox="0 0 120 70" className="w-32 h-auto">
        <path
          d="M 10 60 A 50 50 0 0 1 110 60"
          fill="none"
          stroke="#E2D5B8"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path
          d="M 10 60 A 50 50 0 0 1 110 60"
          fill="none"
          stroke="#A8946A"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-2">
        <span className="text-lg font-semibold tracking-tight text-stone-900">
          {p.toFixed(1)}%
        </span>
        <span className="text-[9px] uppercase tracking-widest text-stone-400">
          Achieved
        </span>
      </div>
    </div>
  );
}

function PercentBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-stone-700">
        <span>{label}</span>
        <span className="tabular-nums font-medium text-stone-900">
          {value.toFixed(1)}%
        </span>
      </div>
      <div className="mt-1 h-1.5 bg-stone-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${color}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </div>
  );
}

function TimelineRow({
  topLabel,
  bottomLabel,
  topDate,
  bottomDate,
  tone,
}: {
  topLabel: string;
  bottomLabel: string;
  topDate: string;
  bottomDate: string;
  tone: "planned" | "actual";
}) {
  const colour = tone === "planned" ? "bg-amber-200" : "bg-amber-500";
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] text-stone-500 mb-1">
        <span>{topLabel}</span>
        <span>{bottomLabel}</span>
      </div>
      <div className={`h-1.5 rounded-full ${colour}`} />
      <div className="flex items-center justify-between text-[10px] text-stone-700 mt-1">
        <span>{topDate}</span>
        <span>{bottomDate}</span>
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-stone-500">{label}</dt>
      <dd className="text-stone-900 font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "danger" | "success";
}) {
  // "ok" = neutral on-time grey-green, "success" = actively ahead green,
  // "danger" = late red.
  const colour =
    tone === "danger"
      ? "text-red-600"
      : tone === "success"
        ? "text-emerald-600"
        : "text-stone-700";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-stone-400">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${colour}`}>{value}</p>
    </div>
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

function ZoneRow({
  phase,
}: {
  phase: import("@/lib/reports").MasterReportData["perZone"][number];
}) {
  function fmtCell(d: Date | null | undefined) {
    if (!d) return "—";
    return new Date(d).toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }
  return (
    <>
      {/* Zone header row */}
      <tr className="border-t border-stone-200 bg-amber-50/40">
        <td colSpan={7} className="py-1.5 px-3 text-xs font-semibold text-stone-900">
          {phase.name}
        </td>
      </tr>
      {/* Planned row */}
      <tr className="border-t border-stone-100">
        <td className="py-2 px-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-stone-500 w-14">
              Planned
            </span>
            <span className="text-stone-900 font-medium">100%</span>
          </div>
        </td>
        <td className="py-2 px-3 text-right text-stone-700">
          {fmtCell(phase.plannedStart)}
        </td>
        <td className="py-2 px-3 text-right text-stone-700">
          {fmtCell(phase.plannedFinish)}
        </td>
        <td className="py-2 px-3 text-right text-stone-700">
          {phase.plannedDurationDays != null ? `${phase.plannedDurationDays} Days` : "—"}
        </td>
        <td className="py-2 px-3 text-right">
          <span
            className={`font-semibold tabular-nums ${
              phase.totalDelayDays > 0
                ? "text-red-600"
                : phase.totalDelayDays < 0
                  ? "text-emerald-600"
                  : "text-stone-600"
            }`}
          >
            {formatDelay(phase.totalDelayDays)}
          </span>
        </td>
        <td className="py-2 px-3 text-right text-stone-700">0 Days</td>
        <td className="py-2 px-3 text-right">
          <ProbabilityBadge delayDays={phase.totalDelayDays} size="xs" />
        </td>
      </tr>
      {/* Actual row */}
      <tr className="border-t border-stone-100">
        <td className="py-2 px-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-stone-500 w-14">
              Actual
            </span>
            <span className="text-stone-900 font-medium tabular-nums">
              {phase.actualPercent.toFixed(1)}%
            </span>
          </div>
        </td>
        <td className="py-2 px-3 text-right text-stone-700">
          {fmtCell(phase.actualStart)}
        </td>
        <td className="py-2 px-3 text-right text-stone-700">
          {fmtCell(phase.projectedFinish)}
        </td>
        <td className="py-2 px-3 text-right text-stone-700">
          {phase.actualDurationDays != null ? `${phase.actualDurationDays} Days` : "—"}
        </td>
        <td className="py-2 px-3 text-right text-stone-400 text-[11px]">
          {phase.hindrancesCount} Hindrance{phase.hindrancesCount === 1 ? "" : "s"}
        </td>
        <td className="py-2 px-3" />
        <td className="py-2 px-3" />
      </tr>
    </>
  );
}

function PercentInline({ value, colour }: { value: number; colour: string }) {
  const cls = colour === "amber-500" ? "bg-amber-500" : "bg-amber-200";
  return (
    <div className="flex items-center gap-2">
      <span className="text-stone-900 font-medium tabular-nums w-12 text-right">
        {value.toFixed(1)}%
      </span>
      <span className="flex-1 h-1 rounded-full bg-stone-100 overflow-hidden">
        <span
          className={`block h-full ${cls}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </span>
    </div>
  );
}
