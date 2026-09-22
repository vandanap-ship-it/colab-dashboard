import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, ClipboardList, Users } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";
import { istDayStart } from "@/lib/istDay";

export const dynamic = "force-dynamic";

/**
 * Mobile DLR — Daily Labour Report. Derived from ProgressEntry rows: any
 * entry logged on the picked day with a non-zero labour headcount rolls
 * into the summary.
 *
 * Structure:
 *   - Date picker chip (today by default), with < prev / next > arrows
 *     that always keep the picker inside the last 30 days to keep this
 *     page snappy.
 *   - Headline: total labour + entry / contractor / activity counts.
 *   - Per-contractor cards: each contractor's rows grouped, activity +
 *     total headcount + notes.
 *
 * Writing the DLR itself isn't a separate flow — every labour tally comes
 * from Log Progress (already on the FAB and the primary tile). The
 * "raise a DLR" affordance links to /progress/new so tapping the CTA
 * naturally flows into logging the entry that WILL appear here.
 */

const LABOUR_CATEGORIES = ["Skilled", "Unskilled", "Mason", "Helper", "Supervisor"];

export default async function MobileDlrPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { projectId } = await params;
  const sp = await searchParams;

  if (!canAccessModule(session.user.modules, MODULES.PROGRESS)) {
    redirect(`/mobile/${projectId}`);
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  // Date resolution — today IST default; ?date=YYYY-MM-DD to jump.
  const today = istDayStart();
  const picked = parseDate(sp.date) ?? today;
  // Clamp to a sensible window — the desktop page handles arbitrary ranges;
  // the mobile view is a "today or recent" tool.
  const earliest = new Date(today);
  earliest.setUTCDate(earliest.getUTCDate() - 60);
  const clamped = picked < earliest ? earliest : picked > today ? today : picked;

  const dayStart = new Date(clamped);
  const dayEnd = new Date(clamped);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const entries = await prisma.progressEntry.findMany({
    where: { projectId, date: { gte: dayStart, lt: dayEnd } },
    include: {
      contractor: { select: { id: true, name: true } },
      labour: { select: { category: true, count: true } },
      wbsNode: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  type Row = {
    id: string;
    contractorId: string | null;
    contractorName: string;
    activity: string;
    perCategory: Record<string, number>;
    total: number;
    notes: string;
  };

  const rows: Row[] = entries
    .map((e) => {
      const per: Record<string, number> = Object.fromEntries(
        LABOUR_CATEGORIES.map((c) => [c, 0]),
      );
      let total = 0;
      for (const l of e.labour) {
        if (per[l.category] != null) per[l.category] += l.count;
        else per.Helper = (per.Helper ?? 0) + l.count;
        total += l.count;
      }
      return {
        id: e.id,
        contractorId: e.contractor?.id ?? null,
        contractorName: e.contractor?.name ?? "(unassigned)",
        activity: e.wbsNode?.name ?? "—",
        perCategory: per,
        total,
        notes: e.notes ?? "",
      };
    })
    .filter((r) => r.total > 0);

  const totalLabour = rows.reduce((s, r) => s + r.total, 0);
  const contractorSet = new Set(rows.map((r) => r.contractorId ?? r.contractorName));
  const activitySet = new Set(rows.map((r) => r.activity));

  // Group rows by contractor for the render.
  const byContractor = new Map<string, { name: string; rows: Row[]; subtotal: number }>();
  for (const r of rows) {
    const key = r.contractorId ?? r.contractorName;
    const bucket = byContractor.get(key) ?? { name: r.contractorName, rows: [], subtotal: 0 };
    bucket.rows.push(r);
    bucket.subtotal += r.total;
    byContractor.set(key, bucket);
  }
  const contractorGroups = Array.from(byContractor.values()).sort(
    (a, b) => b.subtotal - a.subtotal,
  );

  const prev = new Date(clamped);
  prev.setUTCDate(prev.getUTCDate() - 1);
  const next = new Date(clamped);
  next.setUTCDate(next.getUTCDate() + 1);
  const canGoPrev = prev >= earliest;
  const canGoNext = next <= today;

  return (
    <div className="flex-1 flex flex-col bg-ivory min-h-0">
      <div
        className="px-5 pt-5 pb-4 border-b border-sandstone-100"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        <p className="font-serif italic text-[13px] text-ferrous-600 tracking-wide">
          Daily Labour Report
        </p>
        <h1 className="font-serif text-[28px] leading-tight text-ink tracking-tight mt-0.5">
          DLR
        </h1>

        {/* Date pill with prev/next arrows */}
        <div className="mt-3 flex items-center gap-2">
          {canGoPrev ? (
            <Link
              href={`/mobile/${projectId}/dlr?date=${iso(prev)}`}
              aria-label="Previous day"
              className="w-8 h-8 rounded-full bg-sandstone-100 text-ink-2 flex items-center justify-center"
            >
              <ChevronLeft className="w-4 h-4" />
            </Link>
          ) : (
            <span className="w-8 h-8 rounded-full bg-sandstone-100 text-ink-3/40 flex items-center justify-center">
              <ChevronLeft className="w-4 h-4" />
            </span>
          )}
          <div className="flex-1 text-center rounded-full bg-ink text-cream px-4 py-1.5 text-[13px] font-semibold">
            {fmtDayLabel(clamped, today)}
          </div>
          {canGoNext ? (
            <Link
              href={`/mobile/${projectId}/dlr?date=${iso(next)}`}
              aria-label="Next day"
              className="w-8 h-8 rounded-full bg-sandstone-100 text-ink-2 flex items-center justify-center"
            >
              <ChevronRight className="w-4 h-4" />
            </Link>
          ) : (
            <span className="w-8 h-8 rounded-full bg-sandstone-100 text-ink-3/40 flex items-center justify-center">
              <ChevronRight className="w-4 h-4" />
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {/* Headline */}
        <section className="rounded-2xl border border-sandstone-100 bg-cream p-5">
          <div className="text-[10.5px] font-semibold text-ink-3 uppercase tracking-[0.14em]">
            Total labour on site
          </div>
          <div className="mt-1 flex items-baseline gap-2 text-ferrous-700">
            <Users className="w-6 h-6" />
            <span
              className="font-serif tabular-nums"
              style={{ fontSize: "44px", lineHeight: "1", letterSpacing: "-0.02em" }}
            >
              {totalLabour}
            </span>
          </div>
          <p className="text-[12px] text-ink-3 mt-2">
            {rows.length === 0 ? (
              "No labour logged for this day."
            ) : (
              <>
                Across{" "}
                <span className="font-semibold text-ink">{contractorSet.size}</span> contractor{contractorSet.size === 1 ? "" : "s"} and{" "}
                <span className="font-semibold text-ink">{activitySet.size}</span> activit{activitySet.size === 1 ? "y" : "ies"}.
              </>
            )}
          </p>
        </section>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-8 text-center">
            <ClipboardList className="w-6 h-6 text-stone-300 mx-auto" />
            <p className="text-sm text-stone-500 mt-2">
              Nothing logged yet.
            </p>
            <Link
              href={`/mobile/${projectId}/progress/new`}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-ink text-cream text-[13px] font-semibold px-4 py-2"
            >
              Log progress
            </Link>
          </div>
        ) : (
          contractorGroups.map((g) => (
            <section key={g.name} className="rounded-2xl border border-sandstone-100 bg-cream shadow-soft p-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[15px] font-semibold text-ink">{g.name}</h2>
                <div className="text-[13px] tabular-nums font-semibold text-ferrous-700">
                  {g.subtotal}
                </div>
              </div>
              <ul className="mt-3 space-y-2">
                {g.rows.map((r) => (
                  <li key={r.id} className="rounded-xl bg-white border border-sandstone-100 p-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="text-[13.5px] font-medium text-ink leading-snug min-w-0 flex-1">
                        {r.activity}
                      </div>
                      <div className="text-[13px] tabular-nums font-semibold text-ink shrink-0">
                        {r.total}
                      </div>
                    </div>
                    {/* Per-category chips — only render non-zero categories so
                        the row stays compact. */}
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {LABOUR_CATEGORIES.filter((c) => r.perCategory[c] > 0).map((c) => (
                        <span
                          key={c}
                          className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-2 bg-sandstone-100 px-1.5 py-0.5 rounded"
                        >
                          {c} · <span className="tabular-nums">{r.perCategory[c]}</span>
                        </span>
                      ))}
                    </div>
                    {r.notes && (
                      <p className="text-[11.5px] text-ink-3 mt-1.5 italic leading-snug">
                        &ldquo;{r.notes}&rdquo;
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function parseDate(v: string | undefined): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + "T00:00:00.000Z");
  return isNaN(d.getTime()) ? null : d;
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function fmtDayLabel(d: Date, today: Date): string {
  const diffMs = today.getTime() - d.getTime();
  const days = Math.round(diffMs / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}
