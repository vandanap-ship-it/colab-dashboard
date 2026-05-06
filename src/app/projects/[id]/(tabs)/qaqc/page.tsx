import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { HardHat } from "lucide-react";
import QAQCList from "@/components/QAQCList";
import MiniBarChart from "@/components/MiniBarChart";
import { isAdmin, ROLES } from "@/lib/roles";

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function dayKey(d: Date): string {
  return startOfDay(d).toISOString().slice(0, 10);
}

function dayLabel(key: string): string {
  return new Date(key + "T00:00:00Z").toLocaleDateString(undefined, {
    day: "2-digit",
    timeZone: "UTC",
  });
}

function build7Days(today = new Date()): string[] {
  const buckets: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const ref = new Date(today);
    ref.setUTCDate(today.getUTCDate() - i);
    buckets.push(dayKey(ref));
  }
  return buckets;
}

export default async function QAQCTabPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return null;

  const { id: projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) notFound();

  const today = new Date();
  const sevenDays = build7Days(today);
  const sevenDaysAgo = new Date(sevenDays[0] + "T00:00:00Z");

  // ------ Inspection (WIR) aggregates ------
  const inspections = await prisma.inspection.findMany({
    where: { projectId },
    select: {
      id: true,
      status: true,
      createdAt: true,
      reviewedAt: true,
      wbsNode: {
        select: { contractor: { select: { id: true, name: true } } },
      },
    },
  });

  const inspTotal = inspections.length;
  const inspPassed = inspections.filter((i) => i.status === "PASSED").length;
  const inspRejected = inspections.filter((i) => i.status === "REJECTED").length;
  const inspInReview = inspections.filter((i) => i.status === "IN_REVIEW").length;
  const inspDecided = inspPassed + inspRejected;
  const inspSuccessRate = inspDecided === 0 ? 0 : Math.round((inspPassed / inspDecided) * 100);

  // 7-day spark for inspections (count by createdAt day)
  const inspByDay = new Map<string, number>(sevenDays.map((d) => [d, 0]));
  for (const i of inspections) {
    if (i.createdAt < sevenDaysAgo) continue;
    const k = dayKey(i.createdAt);
    if (inspByDay.has(k)) inspByDay.set(k, (inspByDay.get(k) ?? 0) + 1);
  }
  const inspSparkData = sevenDays.map((d) => ({ label: dayLabel(d), value: inspByDay.get(d) ?? 0 }));
  const inspToday = inspByDay.get(dayKey(today)) ?? 0;

  // ------ Issues (treated as Observations for v1) ------
  const issues = await prisma.issue.findMany({
    where: { projectId },
    select: {
      id: true,
      status: true,
      severity: true,
      category: true,
      createdAt: true,
      updatedAt: true,
      wbsNode: {
        select: { contractor: { select: { id: true, name: true } } },
      },
    },
  });

  const issueTotal = issues.length;
  const issueOpen = issues.filter((i) => i.status === "OPEN").length;
  const issueResolved = issues.filter((i) => i.status === "RESOLVED").length;
  const completionPercent =
    issueTotal === 0 ? 0 : Math.round((issueResolved / issueTotal) * 100);

  // Average TAT (turnaround) — for resolved issues, days from createdAt to updatedAt
  const tatDays: number[] = [];
  for (const i of issues) {
    if (i.status === "RESOLVED") {
      const diff =
        (new Date(i.updatedAt).getTime() - new Date(i.createdAt).getTime()) / 86400000;
      tatDays.push(diff);
    }
  }
  const avgTat =
    tatDays.length === 0 ? 0 : Math.round((tatDays.reduce((s, n) => s + n, 0) / tatDays.length) * 10) / 10;

  // 7-day spark for issues (NCR equivalent)
  const issueByDay = new Map<string, number>(sevenDays.map((d) => [d, 0]));
  for (const i of issues) {
    if (i.createdAt < sevenDaysAgo) continue;
    const k = dayKey(i.createdAt);
    if (issueByDay.has(k)) issueByDay.set(k, (issueByDay.get(k) ?? 0) + 1);
  }
  const issueSparkData = sevenDays.map((d) => ({ label: dayLabel(d), value: issueByDay.get(d) ?? 0 }));
  const issueToday = issueByDay.get(dayKey(today)) ?? 0;

  // ------ Defects By Category (freeform `category` field) ------
  const catCounts: Record<string, number> = {};
  for (const i of issues) {
    const k = i.category?.trim() || "Uncategorised";
    catCounts[k] = (catCounts[k] ?? 0) + 1;
  }
  const catList = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
  const catMax = Math.max(1, ...catList.map(([, n]) => n));

  // Defects By Severity — kept for the alt view in case category is sparse
  const sevCounts: Record<string, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const i of issues) {
    if (i.severity) sevCounts[i.severity] = (sevCounts[i.severity] ?? 0) + 1;
  }
  const sevList = Object.entries(sevCounts).filter(([, n]) => n > 0);
  const sevMax = Math.max(1, ...sevList.map(([, n]) => n));

  // ------ Contractor Performance Master ------
  type Perf = {
    contractorId: string | null;
    name: string;
    wirNew: number;
    wirOpen: number;
    wirClose: number;
    issueNew: number;
    issueOpen: number;
    issueClose: number;
  };
  const perfMap = new Map<string, Perf>();
  function getPerf(contractorId: string | null, name: string): Perf {
    const key = contractorId ?? "__unassigned__";
    let existing = perfMap.get(key);
    if (!existing) {
      existing = {
        contractorId,
        name,
        wirNew: 0,
        wirOpen: 0,
        wirClose: 0,
        issueNew: 0,
        issueOpen: 0,
        issueClose: 0,
      };
      perfMap.set(key, existing);
    }
    return existing;
  }
  for (const i of inspections) {
    const c = i.wbsNode?.contractor ?? null;
    const perf = getPerf(c?.id ?? null, c?.name ?? "(unassigned)");
    if (i.status === "IN_REVIEW") {
      perf.wirNew += 1;
      perf.wirOpen += 1;
    } else if (i.status === "PASSED" || i.status === "REJECTED") {
      perf.wirClose += 1;
    }
  }
  for (const i of issues) {
    const c = i.wbsNode?.contractor ?? null;
    const perf = getPerf(c?.id ?? null, c?.name ?? "(unassigned)");
    if (i.status === "OPEN") {
      perf.issueNew += 1;
      perf.issueOpen += 1;
    } else if (i.status === "RESOLVED") {
      perf.issueClose += 1;
    }
  }
  const perfRows = Array.from(perfMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  // ------ Render ------
  return (
    <div className="space-y-6">
      {/* Top KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Work Inspection Request */}
        <section className="rounded-xl border border-stone-200 bg-stone-900 text-white p-6">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-xs uppercase tracking-wider text-stone-300">
                Work Inspection Request
              </h3>
              <p className="mt-3 text-4xl font-semibold text-amber-400">{inspSuccessRate}%</p>
              <p className="text-xs text-stone-400">Success Rate</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <KV label="Total" value={inspTotal} />
              <KV label="Passed" value={inspPassed} />
              <KV label="Rejected" value={inspRejected} />
              <KV label="In Review" value={inspInReview} />
            </dl>
          </div>
        </section>

        {/* Snags and Defects */}
        <section className="rounded-xl border border-stone-200 bg-white p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-xs uppercase tracking-wider text-stone-500">
              Snags and Defects
            </h3>
            <p className="text-xs text-stone-500">
              <span className="font-semibold text-stone-900">{avgTat}d</span> avg TAT
            </p>
          </div>
          <p className="mt-3 text-4xl font-semibold text-stone-900">{completionPercent}%</p>
          <p className="text-xs text-stone-500">Completed</p>
          <div className="mt-4 space-y-2 text-xs">
            <ProgressRow
              label={`OBS (${issueTotal})`}
              total={issueTotal}
              segments={[
                { value: issueOpen, color: "#f59e0b", legendKey: "NEW" },
                { value: issueResolved, color: "#10b981", legendKey: "CLSD" },
              ]}
            />
          </div>
        </section>
      </div>

      {/* Middle row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Defects by Category (with severity breakdown beneath) */}
        <section className="rounded-xl border border-stone-200 bg-white p-6">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-xs uppercase tracking-wider text-stone-500">
              Defects By Category
            </h3>
            <span className="text-[10px] uppercase tracking-wider text-stone-400">
              {issues.length} total
            </span>
          </div>
          {catList.length === 0 ? (
            <p className="text-sm text-stone-500 text-center py-6">No defects logged yet.</p>
          ) : (
            <ul className="space-y-2">
              {catList.map(([label, n]) => (
                <li key={label} className="flex items-center gap-3 text-sm">
                  <span className="w-44 shrink-0 text-stone-700 truncate" title={label}>
                    {label}
                  </span>
                  <span className="flex-1 h-2 rounded-full bg-stone-100 overflow-hidden">
                    <span
                      className="block h-full bg-amber-400"
                      style={{ width: `${(n / catMax) * 100}%` }}
                    />
                  </span>
                  <span className="w-8 text-right tabular-nums text-stone-900 font-medium">
                    {n}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {sevList.length > 0 && (
            <div className="mt-5 pt-4 border-t border-stone-100">
              <h4 className="text-[10px] uppercase tracking-wider text-stone-400 mb-2">
                By severity
              </h4>
              <ul className="space-y-1.5 text-xs">
                {sevList.map(([label, n]) => {
                  const colour =
                    label === "HIGH" ? "bg-red-500"
                      : label === "MEDIUM" ? "bg-amber-500"
                        : "bg-emerald-500";
                  return (
                    <li key={label} className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${colour}`} />
                      <span className="text-stone-700 capitalize w-20">{label.toLowerCase()}</span>
                      <span className="flex-1 h-1.5 rounded-full bg-stone-100 overflow-hidden">
                        <span
                          className={`block h-full ${colour} opacity-70`}
                          style={{ width: `${(n / sevMax) * 100}%` }}
                        />
                      </span>
                      <span className="w-6 text-right tabular-nums text-stone-700">
                        {n}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        {/* Latest Day Snapshot */}
        <section className="rounded-xl border border-stone-200 bg-white p-6">
          <h3 className="text-xs uppercase tracking-wider text-stone-500">
            Latest Day Snapshot
          </h3>
          <p className="text-[11px] text-stone-400 mt-0.5">
            Operational activity for {today.toLocaleDateString()}
          </p>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <SparkPanel
              label="Work Inspection"
              count={inspToday}
              color="#1d4ed8"
              data={inspSparkData}
            />
            <SparkPanel
              label="Snags"
              count={issueToday}
              color="#f59e0b"
              data={issueSparkData}
            />
          </div>
        </section>
      </div>

      {/* Contractor performance */}
      <section className="rounded-xl border border-stone-200 bg-white p-6 overflow-x-auto">
        <h3 className="text-xs uppercase tracking-wider text-stone-500 mb-4 flex items-center gap-1.5">
          <HardHat className="w-3.5 h-3.5" />
          Contractor Performance Master
        </h3>
        {perfRows.length === 0 ? (
          <p className="text-sm text-stone-500 text-center py-6">
            No contractor activity yet.
          </p>
        ) : (
          <table className="w-full text-sm border-collapse min-w-[640px]">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-stone-500 border-b border-stone-200">
                <th rowSpan={2} className="text-left font-medium py-2 pr-3 align-bottom">
                  Agency name
                </th>
                <th colSpan={3} className="text-center font-medium py-2 px-3">
                  WIR Performance
                </th>
                <th colSpan={3} className="text-center font-medium py-2 px-3">
                  Snags &amp; Responsiveness
                </th>
              </tr>
              <tr className="text-[10px] uppercase tracking-wider text-stone-400 border-b border-stone-200">
                <th className="text-right font-medium py-1 pr-3">New</th>
                <th className="text-right font-medium py-1 pr-3">Open</th>
                <th className="text-right font-medium py-1 pr-3">Close</th>
                <th className="text-right font-medium py-1 pr-3">New</th>
                <th className="text-right font-medium py-1 pr-3">Open</th>
                <th className="text-right font-medium py-1 pr-3">Close</th>
              </tr>
            </thead>
            <tbody>
              {perfRows.map((r) => (
                <tr key={r.contractorId ?? "__unassigned__"} className="border-b border-stone-100 last:border-b-0">
                  <td className="py-2 pr-3 font-medium text-stone-900">{r.name}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.wirNew}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.wirOpen}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.wirClose}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.issueNew}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.issueOpen}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.issueClose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Legacy QAQCList for now — gives planners the action surface (pass/reject) */}
      <QAQCList
        projectId={projectId}
        canReview={
          session.user.role === ROLES.PLANNER ||
          session.user.role === ROLES.PRODUCT_TEAM ||
          isAdmin(session.user.role)
        }
      />
    </div>
  );
}

function KV({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt className="text-stone-300">{label}</dt>
      <dd className="text-right font-semibold text-white tabular-nums">{value}</dd>
    </>
  );
}

function ProgressRow({
  label,
  total,
  segments,
}: {
  label: string;
  total: number;
  segments: { value: number; color: string; legendKey: string }[];
}) {
  const safeTotal = total === 0 ? 1 : total;
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-medium text-stone-900">{label}</span>
        <span className="flex items-center gap-3 text-stone-500">
          {segments.map((s) => (
            <span key={s.legendKey} className="flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: s.color }}
              />
              {s.legendKey}:{s.value}
            </span>
          ))}
        </span>
      </div>
      <div className="h-2 rounded-full bg-stone-100 overflow-hidden flex">
        {segments.map((s) => (
          <span
            key={s.legendKey}
            style={{
              width: `${(s.value / safeTotal) * 100}%`,
              background: s.color,
            }}
            className="h-full"
          />
        ))}
      </div>
    </div>
  );
}

function SparkPanel({
  label,
  count,
  color,
  data,
}: {
  label: string;
  count: number;
  color: string;
  data: { label: string; value: number }[];
}) {
  return (
    <div className="rounded-lg p-3 text-white" style={{ background: color }}>
      <p className="text-2xl font-semibold">{count}</p>
      <p className="text-[11px] uppercase tracking-wider opacity-90">{label}</p>
      <p className="text-[10px] opacity-80 mt-1">Mon - Last 7 days</p>
      <div className="mt-2 bg-white/10 rounded">
        <MiniBarChart data={data} color="rgba(255,255,255,0.85)" height={64} />
      </div>
    </div>
  );
}
