import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { auth } from "@/lib/auth";
import { canSeeDesktop, isAdmin } from "@/lib/roles";
import { isScopedUser } from "@/lib/modules";
import { prisma } from "@/lib/prisma";
import Navbar from "@/components/Navbar";
import AdoptionDauChart from "@/components/AdoptionDauChart";
import {
  loadAdoption,
  rangeLabel,
  istDayKey,
  MODULE_KEYS,
  MODULE_LABELS,
  TEAM_LABELS,
  type AdoptionMode,
  type AdoptionRange,
  type DayModuleRow,
  type TeamRow,
} from "@/lib/adoption";

export const dynamic = "force-dynamic";

const RANGES: AdoptionRange[] = ["14d", "30d", "handover"];
const MODES: AdoptionMode[] = ["real", "all"];

/**
 * /projects/[id]/adoption — planner-side dashboard answering "is the
 * site team actually using Siddhi?" Four sections:
 *
 *   1. Daily active users chart (DAU)
 *   2. Rows per module per week (Progress / HSE / Permits / ...)
 *   3. Per-user leaderboard
 *   4. Contractor-side rollup
 *
 * Time range from ?range=14d|30d|handover (default 30d). Access is
 * desktop-only, scoped users bounced to mobile — same gate as the
 * reports landing.
 */
export default async function AdoptionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string; mode?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");
  // Admins see Adoption even if their user row carries a modules
  // scope (Vandana 2026-10-21); planners / product-team / site-manager
  // accounts still bounce back to mobile when they're module-scoped.
  if (!isAdmin(session.user.role) && isScopedUser(session.user.modules)) {
    redirect("/mobile");
  }

  const { id } = await params;
  const { range: rangeParam, mode: modeParam } = await searchParams;
  const range: AdoptionRange = (RANGES as string[]).includes(rangeParam ?? "")
    ? (rangeParam as AdoptionRange)
    : "30d";
  const mode: AdoptionMode = (MODES as string[]).includes(modeParam ?? "")
    ? (modeParam as AdoptionMode)
    : "real";

  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const data = await loadAdoption(project.id, range, mode);
  const basePath = `/projects/${project.id}/adoption`;
  const linkFor = (nextRange: AdoptionRange, nextMode: AdoptionMode) => {
    const parts: string[] = [];
    if (nextRange !== "30d") parts.push(`range=${nextRange}`);
    if (nextMode !== "real") parts.push(`mode=${nextMode}`);
    return parts.length ? `${basePath}?${parts.join("&")}` : basePath;
  };

  return (
    <div className="min-h-screen bg-ivory">
      <Navbar />

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Link
              href={`/projects/${project.id}/reports`}
              className="inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink mb-1"
            >
              <ArrowLeft className="w-3 h-3" />
              Back to Reports
            </Link>
            <h1 className="font-serif text-[32px] leading-tight text-ink tracking-tight">
              Adoption
            </h1>
            <p className="text-[13px] text-ink-3 mt-1">
              {project.name} · {rangeLabel(range)} ·{" "}
              {mode === "real" ? "real site team only" : "all rows (incl. import)"}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink">
              <span className="inline-flex items-center gap-2">
                <span className="font-semibold tabular-nums">{data.totalActiveUsers}</span>
                <span className="text-ink-3">
                  {data.totalActiveUsers === 1 ? "person logging" : "people logging"}
                </span>
                {data.previous && (
                  <Delta
                    current={data.totalActiveUsers}
                    previous={data.previous.totalActiveUsers}
                  />
                )}
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="font-semibold tabular-nums">{data.totalRows}</span>
                <span className="text-ink-3">entries logged</span>
                {data.previous && (
                  <Delta current={data.totalRows} previous={data.previous.totalRows} />
                )}
              </span>
            </div>
            {mode === "real" && data.excludedRows > 0 && (
              <p className="text-[11px] text-ink-4 italic mt-1">
                Hiding {data.excludedRows} row{data.excludedRows === 1 ? "" : "s"} from Colab
                import or admin accounts. Flip to &ldquo;All rows&rdquo; to see them.
              </p>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            <nav className="inline-flex rounded-xl border border-sandstone-200 bg-white p-0.5" aria-label="Time range">
              {RANGES.map((r) => {
                const isActive = r === range;
                return (
                  <Link
                    key={r}
                    href={linkFor(r, mode)}
                    className={`inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[12px] font-semibold ${
                      isActive
                        ? "bg-ink text-cream"
                        : "text-ink-3 hover:text-ink"
                    }`}
                  >
                    {r === "14d" ? "14 days" : r === "30d" ? "30 days" : "Since handover"}
                  </Link>
                );
              })}
            </nav>
            <nav
              className="inline-flex rounded-xl border border-sandstone-200 bg-white p-0.5"
              aria-label="Which rows to count"
            >
              {MODES.map((m) => {
                const isActive = m === mode;
                return (
                  <Link
                    key={m}
                    href={linkFor(range, m)}
                    className={`inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[12px] font-semibold ${
                      isActive ? "bg-ink text-cream" : "text-ink-3 hover:text-ink"
                    }`}
                    title={
                      m === "real"
                        ? "Hide Colab-imported rows and admin test rows"
                        : "Show every row, including import and admin"
                    }
                  >
                    {m === "real" ? "Real site team" : "All rows"}
                  </Link>
                );
              })}
            </nav>
          </div>
        </header>

        {/* ─── Dormant / slow alert band ─────────────────────────── */}
        {(data.dormantModules.length > 0 || data.slowModules.length > 0) && (
          <section
            className={`rounded-xl border px-4 py-3 ${
              data.dormantModules.length > 0
                ? "border-ferrous-200 bg-ferrous-50/60"
                : "border-brand-200 bg-brand-50/60"
            }`}
            aria-label="Dormant surfaces"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle
                className={`w-4 h-4 shrink-0 mt-0.5 ${
                  data.dormantModules.length > 0 ? "text-ferrous-700" : "text-brand-700"
                }`}
              />
              <div className="text-[13px] text-ink space-y-1">
                {data.dormantModules.length > 0 && (
                  <p>
                    <span className="font-semibold text-ferrous-700">
                      Nobody used this in the last 7 days:
                    </span>{" "}
                    {data.dormantModules.map((m) => MODULE_LABELS[m]).join(" · ")}
                  </p>
                )}
                {data.slowModules.length > 0 && (
                  <p>
                    <span className="font-semibold text-brand-700">
                      Only used 1–2 times in the last 7 days:
                    </span>{" "}
                    {data.slowModules.map((m) => MODULE_LABELS[m]).join(" · ")}
                  </p>
                )}
                <p className="text-[11px] text-ink-3">
                  Counting {mode === "real" ? "real site-team" : "all"} entries. If a
                  surface belongs to a team not live on Siddhi yet, note it before
                  the next rollout.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* ─── 1. Team cards ────────────────────────────────────── */}
        {/* The question Vandana keeps asking: "which team is heavy, which
            team is cold?" One card per team, rolled up by surface
            ownership (progress+manpower = Progress team, hse+permits+
            inductions = Safety team, qaqc = QA/QC team). */}
        <TeamCards teams={data.teams} now={data.now} />

        {/* ─── 2. People logging each day ───────────────────────── */}
        <AdoptionDauChart points={data.dau} />

        {/* ─── 3. Day × surface grid ────────────────────────────── */}
        {/* "Was manpower entered Nov 1? Nov 2? ..." — at-a-glance
            heatmap, one row per surface, one column per day in the
            window. Respects the active mode (real vs all). */}
        <DayByModuleGrid rows={data.dayByModule} nowKey={istDayKey(data.now)} mode={data.mode} />

        {/* ─── 4. Per-user leaderboard ──────────────────────────── */}
        <section className="rounded-xl border border-sandstone-200 bg-white">
          <header className="px-4 py-3 border-b border-sandstone-100 flex items-baseline justify-between gap-3">
            <h3 className="text-[13px] font-semibold uppercase tracking-wider text-ink-3">
              Who&apos;s using Siddhi
            </h3>
            <p className="text-[11px] text-ink-3">
              {data.users.length} {data.users.length === 1 ? "person" : "people"} active in this range
            </p>
          </header>
          {data.users.length === 0 ? (
            <p className="px-4 py-6 text-[13px] text-ink-3 italic text-center">
              No activity in this window.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-sandstone-50 text-[10px] uppercase tracking-wider text-ink-3">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold">User</th>
                    <th className="text-left px-3 py-2 font-semibold">Role</th>
                    <th className="text-left px-3 py-2 font-semibold">Contractor</th>
                    <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">
                      Last 7 days
                    </th>
                    <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">
                      This range
                    </th>
                    {data.previous && (
                      <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">
                        vs prior
                      </th>
                    )}
                    <th className="text-left px-4 py-2 font-semibold whitespace-nowrap">
                      Last entry
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u) => {
                    const prior = data.previous?.rowsByUser[u.userId] ?? 0;
                    return (
                      <tr key={u.userId} className="border-t border-sandstone-100">
                        <td className="px-4 py-2">
                          <div className="font-medium text-ink">{u.name}</div>
                          <div className="text-[10px] text-ink-3">@{u.username}</div>
                        </td>
                        <td className="px-3 py-2 text-ink-3">{u.role.replace(/_/g, " ").toLowerCase()}</td>
                        <td className="px-3 py-2 text-ink-3">
                          {u.contractorName || <span className="text-ink-4 italic">in-house</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink">{u.rowsLast7d || "—"}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">
                          {u.rowsInWindow}
                        </td>
                        {data.previous && (
                          <td className="px-3 py-2 text-right">
                            <Delta current={u.rowsInWindow} previous={prior} compact />
                          </td>
                        )}
                        <td className="px-4 py-2 text-ink-3 whitespace-nowrap">
                          {u.lastSeen ? fmtRelative(u.lastSeen, data.now) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ─── 4. Contractor rollup ─────────────────────────────── */}
        <section className="rounded-xl border border-sandstone-200 bg-white">
          <header className="px-4 py-3 border-b border-sandstone-100 flex items-baseline justify-between gap-3">
            <h3 className="text-[13px] font-semibold uppercase tracking-wider text-ink-3">
              By contractor
            </h3>
            <p className="text-[11px] text-ink-3">
              {data.contractors.length} contractor{data.contractors.length === 1 ? "" : "s"} active
            </p>
          </header>
          {data.contractors.length === 0 ? (
            <p className="px-4 py-6 text-[13px] text-ink-3 italic text-center">
              No contractor-tagged activity in this window.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-sandstone-50 text-[10px] uppercase tracking-wider text-ink-3">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold">Contractor</th>
                    <th className="text-right px-3 py-2 font-semibold">People logging</th>
                    <th className="text-right px-3 py-2 font-semibold">Entries this range</th>
                    {data.previous && (
                      <th className="text-right px-4 py-2 font-semibold whitespace-nowrap">
                        vs prior
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.contractors.map((c) => {
                    const prior = data.previous?.rowsByContractor[c.contractorId] ?? 0;
                    return (
                      <tr key={c.contractorId} className="border-t border-sandstone-100">
                        <td className="px-4 py-2 font-medium text-ink">{c.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-3">{c.userCount}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">
                          {c.rowsInWindow}
                        </td>
                        {data.previous && (
                          <td className="px-4 py-2 text-right">
                            <Delta current={c.rowsInWindow} previous={prior} compact />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

/** Compact delta badge: green up-arrow for positive change, red down-
 *  arrow for negative, cement dash for no change. `compact` makes it
 *  fit cleanly in a table cell (icon + number, no "vs prior" tail). */
function Delta({
  current,
  previous,
  compact,
}: {
  current: number;
  previous: number;
  compact?: boolean;
}) {
  const diff = current - previous;
  if (diff === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-ink-3">
        <Minus className="w-3 h-3" />
        {compact ? "0" : "no change"}
      </span>
    );
  }
  if (diff > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 tabular-nums">
        <TrendingUp className="w-3 h-3" />
        +{diff}
        {!compact && <span className="text-ink-3 font-normal">vs prior</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ferrous-700 tabular-nums">
      <TrendingDown className="w-3 h-3" />
      {diff}
      {!compact && <span className="text-ink-3 font-normal">vs prior</span>}
    </span>
  );
}

function fmtRelative(d: Date, now: Date): string {
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

/**
 * Day × module heatmap. One row per surface (Progress, Manpower, HSE,
 * Permits, Inductions, QA/QC WIRs, Observations), one column per day
 * in the active window. Each cell shows that surface's row-count for
 * that day; empty cells render as a faint dash so a blank Sunday is
 * visibly different from "today, no entries yet". Weekend columns get
 * a subtle sandstone tint; today's column header lights ferrous so the
 * eye can find "now" without counting back from the right edge.
 *
 * The grid honours whatever mode the page is in — "real" strips
 * import rows and admin-created rows. All counts come from the
 * server-side rollupDayByModule().
 */
function DayByModuleGrid({
  rows,
  nowKey,
  mode,
}: {
  rows: DayModuleRow[];
  nowKey: string;
  mode: AdoptionMode;
}) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <section className="rounded-xl border border-sandstone-200 bg-white">
      <header className="px-4 py-3 border-b border-sandstone-100 flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-ink-3">
          Day-by-day activity
        </h3>
        <p className="text-[11px] text-ink-3">
          {rows.length} day{rows.length === 1 ? "" : "s"}
          {mode === "real" ? " · real site team" : " · all rows"}
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="text-[11px] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-sandstone-50 text-left px-3 py-2 font-semibold uppercase tracking-wider text-[10px] text-ink-3 border-b border-sandstone-100 min-w-[140px]">
                Surface
              </th>
              {rows.map((r) => {
                const [, mm, dd] = r.day.split("-");
                const date = new Date(`${r.day}T00:00:00+05:30`);
                const weekday = date.getUTCDay(); // 0=Sun 6=Sat in UTC after +5:30 shift keeps weekday
                const isWeekend = weekday === 0;
                const isFirstOfMonth = dd === "01";
                const isToday = r.day === nowKey;
                return (
                  <th
                    key={r.day}
                    className={`px-1.5 py-1.5 font-medium tabular-nums text-center border-b border-sandstone-100 ${
                      isToday
                        ? "bg-ferrous-500 text-white"
                        : isWeekend
                        ? "bg-sandstone-50 text-ink-3"
                        : "bg-sandstone-50 text-ink-3"
                    }`}
                    title={date.toLocaleDateString("en-GB", {
                      weekday: "short",
                      day: "2-digit",
                      month: "short",
                      timeZone: "Asia/Kolkata",
                    })}
                  >
                    <div
                      className={`text-[9px] uppercase tracking-wider ${
                        isToday ? "text-sandstone-50" : "text-ink-4"
                      }`}
                    >
                      {isFirstOfMonth
                        ? MONTH_SHORT[parseInt(mm, 10) - 1]
                        : " "}
                    </div>
                    <div className="font-semibold text-[11px]">{dd}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {MODULE_KEYS.map((m) => (
              <tr key={m}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-white text-left px-3 py-1.5 font-medium text-ink border-b border-sandstone-100 whitespace-nowrap"
                >
                  {MODULE_LABELS[m]}
                </th>
                {rows.map((r) => {
                  const n = r.counts[m];
                  const [, , dd] = r.day.split("-");
                  const date = new Date(`${r.day}T00:00:00+05:30`);
                  const isWeekend = date.getUTCDay() === 0;
                  const isToday = r.day === nowKey;
                  return (
                    <td
                      key={r.day}
                      className={`text-center tabular-nums border-b border-sandstone-100 ${cellTone(
                        n,
                      )} ${isWeekend ? "bg-opacity-70" : ""} ${
                        isToday ? "ring-1 ring-inset ring-ferrous-500" : ""
                      }`}
                      style={{ width: 28, minWidth: 28, maxWidth: 28, height: 24 }}
                      title={`${MODULE_LABELS[m]} · ${dd}: ${n} ${n === 1 ? "row" : "rows"}`}
                    >
                      {n > 0 ? n : <span className="text-ink-4">·</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            {/* Totals row — a quick "was ANYTHING entered today" summary */}
            <tr>
              <th
                scope="row"
                className="sticky left-0 z-10 bg-sandstone-50 text-left px-3 py-1.5 font-semibold text-ink border-t border-sandstone-200 whitespace-nowrap"
              >
                All surfaces
              </th>
              {rows.map((r) => {
                const isToday = r.day === nowKey;
                return (
                  <td
                    key={r.day}
                    className={`text-center tabular-nums font-semibold border-t border-sandstone-200 ${cellTone(
                      r.total,
                    )} ${isToday ? "ring-1 ring-inset ring-ferrous-500" : ""}`}
                    style={{ width: 28, minWidth: 28, maxWidth: 28, height: 26 }}
                  >
                    {r.total > 0 ? r.total : <span className="text-ink-4">·</span>}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-[10px] text-ink-4 border-t border-sandstone-100">
        Each cell is one day&apos;s row-count on that surface. Hover a cell for the exact day. Today&apos;s column is outlined.
      </p>
    </section>
  );
}

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Background tint scaled by activity count. 0 = faint, 1-2 = brand-50,
 *  3-5 = brand-100, 6-10 = brand-200, 11+ = ferrous (saturated). Kept
 *  deliberately coarse — the exact numbers in-cell carry the fine detail. */
function cellTone(n: number): string {
  if (n <= 0) return "bg-white";
  if (n <= 2) return "bg-brand-50 text-brand-700";
  if (n <= 5) return "bg-brand-100 text-brand-700";
  if (n <= 10) return "bg-brand-200 text-ink";
  return "bg-ferrous-500 text-white";
}

/**
 * Three cards side-by-side, one per site team (Progress / Safety / QA/QC).
 * Each card shows the headline number — rows logged in the last 7 days —
 * and the full-range total + the last-entry recency underneath. The 7-day
 * number is tinted so a cold team reads red before the eye even parses
 * the digit. Clicking a card could later deep-link into a per-team user
 * list; for now it's a read-only summary.
 */
function TeamCards({ teams, now }: { teams: TeamRow[]; now: Date }) {
  return (
    <section
      className="grid grid-cols-1 sm:grid-cols-3 gap-3"
      aria-label="Activity by team"
    >
      {teams.map((t) => {
        const tone = teamTone(t.rowsLast7d);
        return (
          <div
            key={t.team}
            className="rounded-xl border border-sandstone-200 bg-white p-4 flex flex-col gap-2"
          >
            <div className="flex items-baseline justify-between">
              <h4 className="text-[13px] font-semibold uppercase tracking-wider text-ink-3">
                {TEAM_LABELS[t.team]}
              </h4>
              <span className="text-[10px] text-ink-4">
                {t.activeUsers} {t.activeUsers === 1 ? "person" : "people"}
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className={`text-[32px] font-serif leading-none tabular-nums ${tone.text}`}>
                {t.rowsLast7d}
              </span>
              <span className={`text-[11px] ${tone.text}`}>
                {t.rowsLast7d === 1 ? "entry" : "entries"} this week
              </span>
            </div>
            <div className="text-[11px] text-ink-3">
              <span className="font-semibold text-ink tabular-nums">{t.rowsInWindow}</span>{" "}
              in this range · last entry {t.lastEntry ? fmtRelative(t.lastEntry, now) : "never"}
            </div>
            <div className={`h-1 rounded-full ${tone.bar}`} />
          </div>
        );
      })}
    </section>
  );
}

/** Colour signal for a team card based on last-7-day row count. The
 *  bar underneath each card doubles as the warning signal — a cold
 *  team reads red before the eye even parses the digit. */
function teamTone(rowsLast7d: number): { text: string; bar: string } {
  if (rowsLast7d === 0) return { text: "text-ferrous-700", bar: "bg-ferrous-500" };
  if (rowsLast7d <= 10) return { text: "text-brand-700", bar: "bg-brand-500" };
  return { text: "text-ink", bar: "bg-emerald-500" };
}
