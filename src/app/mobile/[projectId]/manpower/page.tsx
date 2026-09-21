import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Plus, Users, Calendar } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";
import { getDashboardManpowerStrip } from "@/lib/manpowerServer";
import { istDayStart } from "@/lib/istDay";

export const dynamic = "force-dynamic";

/**
 * Mobile Manpower list — until now the mobile app could only log manpower,
 * not browse it. Shows two things at a glance:
 *
 *   1. Today's headline — same numbers the home card shows (planned vs
 *      actual, status color), just re-rendered here so you land on the
 *      right context after tapping the "Log manpower" tile.
 *   2. Last 7 days — one card per day with total headcount plus a
 *      per-contractor breakdown, latest date first. Days with no entries
 *      still render (as "Not logged"), so gaps in the record are obvious.
 */
export default async function MobileManpowerListPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { projectId } = await params;
  if (!canAccessModule(session.user.modules, MODULES.PROGRESS)) {
    redirect(`/mobile/${projectId}`);
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const today = istDayStart();
  // Query the last 7 *including today*, so a Monday visit shows Mon–last
  // Tuesday. We roll our own IST-anchored date range because the entryDate
  // column is stored at 00:00 UTC per the schema note.
  const startInclusive = new Date(today);
  startInclusive.setUTCDate(startInclusive.getUTCDate() - 6);

  const [strip, rows, contractors] = await Promise.all([
    getDashboardManpowerStrip(projectId, today),
    prisma.manpowerEntry.findMany({
      where: {
        projectId,
        deletedAt: null,
        entryDate: { gte: startInclusive, lte: today },
      },
      select: {
        entryDate: true,
        actualCount: true,
        trade: true,
        contractorId: true,
      },
      orderBy: { entryDate: "desc" },
    }),
    prisma.contractor.findMany({
      where: { projectId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const contractorNameById = new Map(contractors.map((c) => [c.id, c.name]));

  // Bucket the rows by day → contractor → sub-total. Keeping the data
  // shape tidy so the render loop stays readable.
  type DayBucket = {
    date: Date;
    total: number;
    byContractor: Map<string, { name: string; count: number }>;
  };
  const buckets = new Map<string, DayBucket>();
  const dateKey = (d: Date) => d.toISOString().slice(0, 10);

  // Seed empty buckets for every day in the window so gaps show as "Not logged".
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    buckets.set(dateKey(d), { date: d, total: 0, byContractor: new Map() });
  }
  for (const r of rows) {
    const key = dateKey(r.entryDate);
    const b = buckets.get(key);
    if (!b) continue;
    b.total += r.actualCount;
    const name = contractorNameById.get(r.contractorId) ?? "Untagged";
    const prev = b.byContractor.get(r.contractorId) ?? { name, count: 0 };
    b.byContractor.set(r.contractorId, { name, count: prev.count + r.actualCount });
  }
  const days = Array.from(buckets.values()).sort((a, b) => b.date.getTime() - a.date.getTime());

  return (
    <div className="flex-1 flex flex-col bg-ivory min-h-0">
      <div
        className="px-5 pt-5 pb-4 border-b border-sandstone-100"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="font-serif text-[28px] leading-tight text-ink tracking-tight">
            Manpower
          </h1>
          <Link
            href={`/mobile/${projectId}/manpower/new`}
            className="inline-flex items-center gap-1 rounded-full bg-ink text-cream text-[12px] font-semibold px-3 py-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Log
          </Link>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {/* Today headline — mirrors the home site-pulse tile so the number
            is the same no matter where you land. */}
        <TodayCard strip={strip} />

        <section>
          <div className="text-[11px] font-semibold text-ink-3 uppercase tracking-[0.14em] mb-2 px-1 flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-ferrous-600" />
            Last 7 days
          </div>
          <ul className="space-y-2">
            {days.map((d) => (
              <DayRow key={d.date.toISOString()} bucket={d} />
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentational
// ---------------------------------------------------------------------------

function TodayCard({
  strip,
}: {
  strip: Awaited<ReturnType<typeof getDashboardManpowerStrip>>;
}) {
  const noPlan = strip.status === "no-plan";
  const headline =
    noPlan
      ? "No manpower plan set for today."
      : strip.status === "not-logged"
        ? "Manpower not logged yet today."
        : strip.status === "below"
          ? "Below plan today."
          : strip.status === "above"
            ? "Above plan today."
            : "On plan today.";
  const toneClass =
    strip.status === "on-plan" || strip.status === "above"
      ? "text-emerald-700"
      : strip.status === "below" || strip.status === "not-logged"
        ? "text-ferrous-600"
        : "text-ink-3";

  return (
    <section className="relative rounded-2xl bg-cream border border-sandstone-100 overflow-hidden">
      <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px] bg-ferrous-500" />
      <div className="px-5 py-5">
        <div className="flex items-baseline justify-between">
          <p className={`font-serif text-[15px] italic ${toneClass}`}>{headline}</p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
          <TodayStat
            label="On site"
            value={noPlan ? "—" : strip.actual}
            note={noPlan ? "no plan" : `of ${strip.planned} planned`}
            tone="warm"
          />
          <TodayStat
            label="Variance"
            value={noPlan ? "—" : strip.variance}
            note={strip.variance === 0 ? "matches plan" : strip.variance > 0 ? "above plan" : "short"}
          />
        </div>
        {!noPlan && strip.planned > 0 && (
          <div className="mt-4 space-y-1.5">
            <div className="flex items-baseline justify-between text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
              <span>Plan {strip.planned}</span>
              <span>Actual {strip.actual}</span>
            </div>
            <div className="relative h-[6px] rounded-full bg-sandstone-100 overflow-hidden">
              <div
                className={
                  strip.actual >= strip.planned
                    ? "absolute inset-y-0 left-0 bg-emerald-500"
                    : "absolute inset-y-0 left-0 bg-ferrous-500"
                }
                style={{
                  width: `${Math.min(110, (strip.actual / Math.max(strip.planned, 1)) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function TodayStat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string | number;
  note?: string;
  tone?: "warm";
}) {
  const valueTone = tone === "warm" ? "text-ferrous-700" : "text-ink";
  return (
    <div>
      <p className="text-[10.5px] font-semibold text-ink-3 uppercase tracking-[0.14em]">
        {label}
      </p>
      <p
        className={`font-serif ${valueTone} mt-1`}
        style={{ fontSize: "36px", lineHeight: "1", letterSpacing: "-0.015em", fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </p>
      {note && <p className="text-[12px] text-ink-3 mt-1.5">{note}</p>}
    </div>
  );
}

function DayRow({
  bucket,
}: {
  bucket: { date: Date; total: number; byContractor: Map<string, { name: string; count: number }> };
}) {
  const byContractor = Array.from(bucket.byContractor.values()).sort((a, b) => b.count - a.count);
  const isEmpty = bucket.total === 0;
  return (
    <li>
      <div className="rounded-2xl border border-sandstone-100 bg-cream shadow-soft p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[13px] font-semibold text-ink">
            {fmtDayLabel(bucket.date)}
          </div>
          <div className="flex items-center gap-1.5">
            <Users className={`w-3.5 h-3.5 ${isEmpty ? "text-ink-3" : "text-ferrous-600"}`} />
            <span
              className={`font-serif tabular-nums ${isEmpty ? "text-ink-3" : "text-ferrous-600"}`}
              style={{ fontSize: "22px", lineHeight: "1", letterSpacing: "-0.02em" }}
            >
              {bucket.total}
            </span>
          </div>
        </div>
        {isEmpty ? (
          <p className="text-[12px] text-ink-3 mt-1.5">Not logged.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {byContractor.map((c) => (
              <li key={c.name} className="flex items-center justify-between text-[12.5px] text-ink-2">
                <span>{c.name}</span>
                <span className="tabular-nums font-medium">{c.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function fmtDayLabel(d: Date): string {
  const today = istDayStart();
  const diffMs = today.getTime() - d.getTime();
  const dayMs = 1000 * 60 * 60 * 24;
  const days = Math.round(diffMs / dayMs);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
}
