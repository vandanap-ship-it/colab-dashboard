import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { canSeeDesktop } from "@/lib/roles";
import { isScopedUser } from "@/lib/modules";
import Navbar from "@/components/Navbar";
import { getContractorScorecard, type ContractorScorecardRow } from "@/lib/contractorScorecard";

export const dynamic = "force-dynamic";

/**
 * Contractor scorecard — a one-page side-by-side comparison of Abraham vs
 * Elegant (or whatever two contractors the project has) that leadership
 * uses at the weekly review.
 *
 * Metrics per contractor:
 *   - Villas in scope (from the awarded-contract registry, not tag count)
 *   - Quality — WIR pass rate + in-review backlog + rejected count
 *   - Snags   — open / high-open / resolved / median resolution days
 *   - Progress — activities completed, activities currently overdue,
 *     average delay days on completed activities
 *
 * When a metric is better for one contractor, that side gets a subtle
 * emerald border on the tile; worse gets amber. Ties stay neutral.
 * "Better" is domain-obvious: higher pass rate is better, fewer high-open
 * snags is better, fewer overdue is better.
 */
export default async function ContractorScorecardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");
  if (isScopedUser(session.user.modules)) redirect("/mobile");

  const { id: projectId } = await params;
  const scorecard = await getContractorScorecard(projectId);
  if (!scorecard) notFound();

  const rows = scorecard.rows;
  const twoUp = rows.length === 2;

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-stone-50">
        <div className="max-w-6xl mx-auto p-6 space-y-6">
          {/* Crumb + heading */}
          <div>
            <Link
              href={`/projects/${projectId}`}
              className="text-xs text-stone-500 hover:text-stone-900 inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {scorecard.projectName}
            </Link>
            <h1 className="text-2xl font-semibold text-stone-900 mt-1">
              Contractor Scorecard
            </h1>
            <p className="text-sm text-stone-500 mt-1">
              As of {fmtDateLong(scorecard.asOf)} · lifetime numbers, not
              date-ranged. Refreshes on every load.
            </p>
          </div>

          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-300 bg-white p-10 text-center">
              <p className="text-sm text-stone-500">
                No active contractors on this project yet.
              </p>
            </div>
          ) : (
            <>
              {/* Side-by-side cards. On tablet + widths this is two-up; on
                  narrow screens it stacks. */}
              <div className={twoUp ? "grid grid-cols-1 md:grid-cols-2 gap-4" : "grid grid-cols-1 gap-4"}>
                {rows.map((r) => {
                  const compare = twoUp ? rows.find((o) => o.contractorId !== r.contractorId) : null;
                  return <ContractorCard key={r.contractorId ?? r.contractorName} row={r} compare={compare ?? null} />;
                })}
              </div>

              {/* Comparison table — same metrics, one row per metric so it's
                  easy to scan "who's ahead on X". Only renders when we have
                  exactly two contractors. */}
              {twoUp && (
                <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
                  <div className="px-4 py-3 border-b border-stone-100 text-xs font-semibold text-stone-500 uppercase tracking-wider">
                    Head-to-head
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-stone-500">
                        <th className="text-left py-2 px-4 font-medium">Metric</th>
                        <th className="text-right py-2 px-4 font-medium">{rows[0].contractorName}</th>
                        <th className="text-right py-2 px-4 font-medium">{rows[1].contractorName}</th>
                      </tr>
                    </thead>
                    <tbody className="text-stone-700">
                      <MetricRow label="Villas in scope" a={rows[0].villaCount} b={rows[1].villaCount} format="int" better="higher" />
                      <MetricRow label="WIRs total" a={rows[0].inspections.total} b={rows[1].inspections.total} format="int" better="none" />
                      <MetricRow label="Pass rate" a={rows[0].inspections.passRate} b={rows[1].inspections.passRate} format="pct" better="higher" />
                      <MetricRow label="Rejected" a={rows[0].inspections.rejected} b={rows[1].inspections.rejected} format="int" better="lower" />
                      <MetricRow label="In review" a={rows[0].inspections.inReview} b={rows[1].inspections.inReview} format="int" better="lower" />
                      <MetricRow label="Snags open" a={rows[0].snags.open} b={rows[1].snags.open} format="int" better="lower" />
                      <MetricRow label="High open" a={rows[0].snags.highOpen} b={rows[1].snags.highOpen} format="int" better="lower" />
                      <MetricRow label="Snags resolved" a={rows[0].snags.resolved} b={rows[1].snags.resolved} format="int" better="higher" />
                      <MetricRow label="Median resolution days" a={rows[0].snags.medianResolutionDays} b={rows[1].snags.medianResolutionDays} format="days" better="lower" />
                      <MetricRow label="Activities completed" a={rows[0].progress.activitiesCompleted} b={rows[1].progress.activitiesCompleted} format="int" better="higher" />
                      <MetricRow label="Activities overdue" a={rows[0].progress.activitiesOverdue} b={rows[1].progress.activitiesOverdue} format="int" better="lower" />
                      <MetricRow label="Avg delay (completed)" a={rows[0].progress.avgDelayDaysCompleted} b={rows[1].progress.avgDelayDaysCompleted} format="days-signed" better="lower" />
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Presentational
// ---------------------------------------------------------------------------

function ContractorCard({ row, compare }: { row: ContractorScorecardRow; compare: ContractorScorecardRow | null }) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-stone-900">{row.contractorName}</h2>
        <span className="text-xs text-stone-500 uppercase tracking-wider font-semibold">
          {row.villaCount} villa{row.villaCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Tile
          label="Pass rate"
          value={fmtPct(row.inspections.passRate)}
          note={`${row.inspections.passed}/${row.inspections.passed + row.inspections.rejected} reviewed`}
          tone={compareTone(row.inspections.passRate, compare?.inspections.passRate, "higher")}
        />
        <Tile
          label="Snags open"
          value={row.snags.open}
          note={row.snags.highOpen > 0 ? `${row.snags.highOpen} high` : "—"}
          tone={compareTone(row.snags.open, compare?.snags.open, "lower")}
        />
        <Tile
          label="Overdue"
          value={row.progress.activitiesOverdue}
          note="activities"
          tone={compareTone(row.progress.activitiesOverdue, compare?.progress.activitiesOverdue, "lower")}
        />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <MetaLine label="WIRs total" value={row.inspections.total} />
        <MetaLine label="Rejected" value={row.inspections.rejected} />
        <MetaLine label="In review" value={row.inspections.inReview} />
        <MetaLine label="Resolved snags" value={row.snags.resolved} />
        <MetaLine label="Median resolution" value={fmtDays(row.snags.medianResolutionDays)} />
        <MetaLine label="Activities completed" value={row.progress.activitiesCompleted} />
        <MetaLine label="Avg delay on completed" value={fmtDaysSigned(row.progress.avgDelayDaysCompleted)} />
      </dl>
    </section>
  );
}

function Tile({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string | number;
  note?: string;
  tone: "good" | "bad" | "neutral";
}) {
  const border =
    tone === "good" ? "border-emerald-200 bg-emerald-50/40" : tone === "bad" ? "border-amber-200 bg-amber-50/40" : "border-stone-200 bg-stone-50";
  const valueTone = tone === "good" ? "text-emerald-800" : tone === "bad" ? "text-amber-900" : "text-stone-900";
  return (
    <div className={`rounded-xl border ${border} p-3`}>
      <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums mt-1 ${valueTone}`}>{value}</div>
      {note && <div className="text-[11px] text-stone-500 mt-0.5">{note}</div>}
    </div>
  );
}

function MetaLine({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between border-b border-stone-100 py-1 last:border-b-0">
      <span className="text-stone-500 text-xs">{label}</span>
      <span className="text-stone-900 tabular-nums text-sm font-medium">{value}</span>
    </div>
  );
}

type Better = "higher" | "lower" | "none";
type Format = "int" | "pct" | "days" | "days-signed";

function MetricRow({ label, a, b, format, better }: {
  label: string;
  a: number | null;
  b: number | null;
  format: Format;
  better: Better;
}) {
  const aClass = winnerClass(a, b, better);
  const bClass = winnerClass(b, a, better);
  const fmt = (n: number | null) =>
    format === "pct" ? fmtPct(n)
    : format === "days" ? fmtDays(n)
    : format === "days-signed" ? fmtDaysSigned(n)
    : n == null ? "—" : String(n);
  return (
    <tr className="border-t border-stone-100">
      <td className="py-2 px-4">{label}</td>
      <td className={`py-2 px-4 text-right tabular-nums ${aClass}`}>{fmt(a)}</td>
      <td className={`py-2 px-4 text-right tabular-nums ${bClass}`}>{fmt(b)}</td>
    </tr>
  );
}

function winnerClass(mine: number | null, other: number | null, better: Better): string {
  if (better === "none") return "";
  if (mine == null || other == null) return "";
  if (mine === other) return "";
  const wins = better === "higher" ? mine > other : mine < other;
  return wins ? "text-emerald-700 font-semibold" : "text-stone-500";
}

function compareTone(
  mine: number | null | undefined,
  other: number | null | undefined,
  better: "higher" | "lower",
): "good" | "bad" | "neutral" {
  if (mine == null || other == null) return "neutral";
  if (mine === other) return "neutral";
  const wins = better === "higher" ? mine > other : mine < other;
  return wins ? "good" : "bad";
}

// ---------------------------------------------------------------------------
// Formatters — same shape whether the source value is missing (null) or a
// real number, so the eye can scan the columns without hunting for "—".
// ---------------------------------------------------------------------------

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${Math.round(n * 100)}%`;
}
function fmtDays(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}d`;
}
function fmtDaysSigned(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n === 0) return "on time";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}d`;
}
function fmtDateLong(d: Date): string {
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
