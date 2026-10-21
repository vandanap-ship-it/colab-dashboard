import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { auth } from "@/lib/auth";
import { canSeeDesktop, isAdmin } from "@/lib/roles";
import { isScopedUser } from "@/lib/modules";
import { prisma } from "@/lib/prisma";
import Navbar from "@/components/Navbar";
import AdoptionDauChart from "@/components/AdoptionDauChart";
import {
  loadAdoption,
  rangeLabel,
  MODULE_KEYS,
  MODULE_LABELS,
  type AdoptionRange,
} from "@/lib/adoption";

export const dynamic = "force-dynamic";

const RANGES: AdoptionRange[] = ["14d", "30d", "handover"];

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
  searchParams: Promise<{ range?: string }>;
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
  const { range: rangeParam } = await searchParams;
  const range: AdoptionRange = (RANGES as string[]).includes(rangeParam ?? "")
    ? (rangeParam as AdoptionRange)
    : "30d";

  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const data = await loadAdoption(project.id, range);

  return (
    <div className="min-h-screen bg-ivory">
      <Navbar />

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <header className="flex items-start justify-between gap-4">
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
              {project.name} · {rangeLabel(range)}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink">
              <span className="inline-flex items-center gap-2">
                <span className="font-semibold tabular-nums">{data.totalActiveUsers}</span>
                <span className="text-ink-3">active user{data.totalActiveUsers === 1 ? "" : "s"}</span>
                {data.previous && (
                  <Delta
                    current={data.totalActiveUsers}
                    previous={data.previous.totalActiveUsers}
                  />
                )}
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="font-semibold tabular-nums">{data.totalRows}</span>
                <span className="text-ink-3">rows raised</span>
                {data.previous && (
                  <Delta current={data.totalRows} previous={data.previous.totalRows} />
                )}
              </span>
            </div>
          </div>

          <nav className="inline-flex rounded-xl border border-sandstone-200 bg-white p-0.5" aria-label="Time range">
            {RANGES.map((r) => {
              const isActive = r === range;
              return (
                <Link
                  key={r}
                  href={`/projects/${project.id}/adoption?range=${r}`}
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
        </header>

        {/* ─── 1. DAU chart ─────────────────────────────────────── */}
        <AdoptionDauChart points={data.dau} />

        {/* ─── 2. Module × week table ───────────────────────────── */}
        <section className="rounded-xl border border-sandstone-200 bg-white">
          <header className="px-4 py-3 border-b border-sandstone-100 flex items-baseline justify-between gap-3">
            <h3 className="text-[13px] font-semibold uppercase tracking-wider text-ink-3">
              Rows per module per week
            </h3>
            <p className="text-[11px] text-ink-3">
              {data.weeks.length} week{data.weeks.length === 1 ? "" : "s"}
            </p>
          </header>
          {data.weeks.length === 0 ? (
            <p className="px-4 py-6 text-[13px] text-ink-3 italic text-center">
              No rows in this window.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-sandstone-50 text-[10px] uppercase tracking-wider text-ink-3">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold">Week</th>
                    {MODULE_KEYS.map((m) => (
                      <th key={m} className="text-right px-3 py-2 font-semibold whitespace-nowrap">
                        {MODULE_LABELS[m]}
                      </th>
                    ))}
                    <th className="text-right px-4 py-2 font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.weeks.map((row) => (
                    <tr key={row.week} className="border-t border-sandstone-100">
                      <td className="px-4 py-2 font-medium text-ink">{row.week}</td>
                      {MODULE_KEYS.map((m) => (
                        <td
                          key={m}
                          className={`text-right px-3 py-2 tabular-nums ${
                            row.counts[m] === 0 ? "text-ink-4" : "text-ink"
                          }`}
                        >
                          {row.counts[m] || "—"}
                        </td>
                      ))}
                      <td className="text-right px-4 py-2 font-semibold tabular-nums text-ink">
                        {row.total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ─── 3. Per-user leaderboard ──────────────────────────── */}
        <section className="rounded-xl border border-sandstone-200 bg-white">
          <header className="px-4 py-3 border-b border-sandstone-100 flex items-baseline justify-between gap-3">
            <h3 className="text-[13px] font-semibold uppercase tracking-wider text-ink-3">
              Who&apos;s using Siddhi
            </h3>
            <p className="text-[11px] text-ink-3">
              {data.users.length} user{data.users.length === 1 ? "" : "s"} active in window
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
                      Last 7d
                    </th>
                    <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">
                      In window
                    </th>
                    {data.previous && (
                      <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">
                        Δ vs prior
                      </th>
                    )}
                    <th className="text-left px-4 py-2 font-semibold whitespace-nowrap">
                      Last seen
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
                    <th className="text-right px-3 py-2 font-semibold">Active users</th>
                    <th className="text-right px-3 py-2 font-semibold">Rows in window</th>
                    {data.previous && (
                      <th className="text-right px-4 py-2 font-semibold whitespace-nowrap">
                        Δ vs prior
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
