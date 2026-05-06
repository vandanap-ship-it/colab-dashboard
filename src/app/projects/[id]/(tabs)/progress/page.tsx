import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import LabourBarChart, { type LabourBarPoint } from "@/components/LabourBarChart";
import LabourPeriodSwitcher from "@/components/LabourPeriodSwitcher";

type Period = "daily" | "weekly" | "monthly";

const BUCKET_COUNTS: Record<Period, number> = {
  daily: 14,
  weekly: 8,
  monthly: 6,
};

// ---- Bucket helpers (UTC-stable to avoid timezone drift) ----

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function startOfWeek(d: Date): Date {
  // Week starts Monday.
  const day = d.getUTCDay(); // 0 = Sun ... 6 = Sat
  const diff = (day + 6) % 7; // Mon=0 ... Sun=6
  const sd = startOfDay(d);
  sd.setUTCDate(sd.getUTCDate() - diff);
  return sd;
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function bucketKey(d: Date, period: Period): string {
  const ref =
    period === "daily" ? startOfDay(d) : period === "weekly" ? startOfWeek(d) : startOfMonth(d);
  return ref.toISOString().slice(0, 10);
}

function bucketLabel(key: string, period: Period): string {
  const d = new Date(key + "T00:00:00Z");
  if (period === "daily") {
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", timeZone: "UTC" });
  }
  if (period === "weekly") {
    return `W${d.toLocaleDateString(undefined, { day: "2-digit", month: "short", timeZone: "UTC" })}`;
  }
  return d.toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" });
}

function buildBuckets(period: Period, today = new Date()): string[] {
  const count = BUCKET_COUNTS[period];
  const buckets: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const ref = new Date(today);
    if (period === "daily") ref.setUTCDate(today.getUTCDate() - i);
    else if (period === "weekly") ref.setUTCDate(today.getUTCDate() - i * 7);
    else ref.setUTCMonth(today.getUTCMonth() - i);
    buckets.push(bucketKey(ref, period));
  }
  return buckets;
}

export default async function ProgressTabPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null;

  const { id: projectId } = await params;
  const { period: rawPeriod } = await searchParams;
  const period: Period =
    rawPeriod === "weekly" || rawPeriod === "monthly" ? rawPeriod : "daily";

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) notFound();

  const today = new Date();
  const buckets = buildBuckets(period, today);
  const earliest = new Date(buckets[0] + "T00:00:00Z");

  const entriesWithLabour = await prisma.progressEntry.findMany({
    where: { projectId, date: { gte: earliest } },
    include: {
      contractor: { select: { id: true, name: true } },
    },
  });

  const entryIds = entriesWithLabour.map((e) => e.id);
  const labourRows = entryIds.length
    ? await prisma.progressLabour.findMany({
        where: { progressEntryId: { in: entryIds } },
        select: { progressEntryId: true, category: true, count: true },
      })
    : [];

  const labourByEntry = new Map<string, { category: string; count: number }[]>();
  for (const l of labourRows) {
    const arr = labourByEntry.get(l.progressEntryId) ?? [];
    arr.push({ category: l.category, count: l.count });
    labourByEntry.set(l.progressEntryId, arr);
  }

  // ---- Chart aggregation: total labour per bucket ----
  const totalsByBucket = new Map<string, number>();
  for (const b of buckets) totalsByBucket.set(b, 0);

  // ---- Table aggregation: contractor x category x bucket ----
  type RowKey = string; // `${contractorName}::${category}`
  const tableTotals = new Map<RowKey, Map<string, number>>();
  const contractorOrder: string[] = [];
  const seenContractor = new Set<string>();

  for (const e of entriesWithLabour) {
    const key = bucketKey(e.date, period);
    if (!totalsByBucket.has(key)) continue; // outside visible range
    const labours = labourByEntry.get(e.id) ?? [];
    const labourSum = labours.reduce((s, l) => s + l.count, 0);
    totalsByBucket.set(key, (totalsByBucket.get(key) ?? 0) + labourSum);

    const cName = e.contractor?.name ?? "(unassigned)";
    if (!seenContractor.has(cName)) {
      seenContractor.add(cName);
      contractorOrder.push(cName);
    }
    for (const l of labours) {
      const rk: RowKey = `${cName}::${l.category}`;
      const buckMap = tableTotals.get(rk) ?? new Map<string, number>();
      buckMap.set(key, (buckMap.get(key) ?? 0) + l.count);
      tableTotals.set(rk, buckMap);
    }
  }

  const chartData: LabourBarPoint[] = buckets.map((b) => ({
    label: bucketLabel(b, period),
    planned: 0, // v1: no planned-labour input yet
    actual: totalsByBucket.get(b) ?? 0,
  }));

  const totalActual = chartData.reduce((s, d) => s + d.actual, 0);

  type Row = { contractor: string; category: string; perBucket: number[]; total: number };
  const rows: Row[] = [];
  for (const cName of contractorOrder) {
    const cats = Array.from(tableTotals.keys())
      .filter((k) => k.startsWith(cName + "::"))
      .map((k) => k.slice(cName.length + 2))
      .sort();
    for (const cat of cats) {
      const buckMap = tableTotals.get(`${cName}::${cat}`)!;
      const perBucket = buckets.map((b) => buckMap.get(b) ?? 0);
      const total = perBucket.reduce((s, n) => s + n, 0);
      rows.push({ contractor: cName, category: cat, perBucket, total });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-stone-700 uppercase tracking-wider">
            Planned vs Actual Labour Summary
          </h2>
          <p className="text-xs text-stone-500 mt-1">
            Actual labour counted from mobile progress entries. Planned-labour input
            ships in v1.1.
          </p>
        </div>
        <LabourPeriodSwitcher active={period} />
      </div>

      <section className="rounded-xl border border-stone-200 bg-white p-6">
        {totalActual === 0 ? (
          <p className="text-sm text-stone-500 text-center py-10">
            No labour entries in the last{" "}
            {period === "daily"
              ? `${BUCKET_COUNTS.daily} days`
              : period === "weekly"
                ? `${BUCKET_COUNTS.weekly} weeks`
                : `${BUCKET_COUNTS.monthly} months`}
            .
          </p>
        ) : (
          <LabourBarChart data={chartData} />
        )}
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-6 overflow-x-auto">
        <h3 className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-3">
          Contractor &times; Category breakdown
        </h3>
        {rows.length === 0 ? (
          <p className="text-sm text-stone-500 text-center py-6">
            No contractor labour to show in this range.
          </p>
        ) : (
          <table className="w-full text-sm border-collapse min-w-[600px]">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-stone-500 border-b border-stone-200">
                <th className="text-left font-medium py-2 pr-3">Contractor</th>
                <th className="text-left font-medium py-2 pr-3">Category</th>
                {buckets.map((b) => (
                  <th
                    key={b}
                    className="text-right font-medium py-2 pr-3 whitespace-nowrap"
                  >
                    {bucketLabel(b, period)}
                  </th>
                ))}
                <th className="text-right font-medium py-2 pr-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const sameContractorAbove = i > 0 && rows[i - 1].contractor === r.contractor;
                return (
                  <tr
                    key={`${r.contractor}::${r.category}`}
                    className="border-b border-stone-100 last:border-b-0"
                  >
                    <td className="py-2 pr-3 font-medium text-stone-900">
                      {sameContractorAbove ? "" : r.contractor}
                    </td>
                    <td className="py-2 pr-3 text-stone-700">{r.category}</td>
                    {r.perBucket.map((v, j) => (
                      <td
                        key={j}
                        className="py-2 pr-3 text-right tabular-nums text-stone-700"
                      >
                        {v || "—"}
                      </td>
                    ))}
                    <td className="py-2 pr-3 text-right tabular-nums font-medium text-stone-900">
                      {r.total}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
