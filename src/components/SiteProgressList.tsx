"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatDayMonthYear as fmt } from "@/lib/dates";

type Activity = {
  id: string;
  name: string;
  taskCode: string;
  path: string[];
  baselineStart: string | null;
  baselineFinish: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  projectedFinish: string | null;
  percentComplete: number;
};

type StatusKey = "UPCOMING" | "ONGOING" | "QUEUE";

function statusOf(a: Activity, today: Date): StatusKey {
  const start = a.actualStart ? new Date(a.actualStart) : a.baselineStart ? new Date(a.baselineStart) : null;
  if (a.percentComplete >= 100 || (a.actualFinish && new Date(a.actualFinish) <= today)) return "QUEUE";
  if (start && start > today) return "UPCOMING";
  if (start && start <= today) return "ONGOING";
  return "ONGOING";
}


export default function SiteProgressList({ projectId }: { projectId: string }) {
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [tab, setTab] = useState<StatusKey>("ONGOING");
  const [search, setSearch] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    fetch(`/api/projects/${projectId}/wbs?leaves=true`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!cancelled) setActivities(d.nodes ?? []);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadKey]);

  const filtered = useMemo(() => {
    if (!activities) return [];
    const today = new Date();
    const rows = activities.filter((a) => {
      if (statusOf(a, today) !== tab) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return a.name.toLowerCase().includes(q) || a.path.join(" / ").toLowerCase().includes(q);
    });
    // Sort so the top of the list is what the engineer would want first:
    //   • In Progress: highest %-complete on top (nearing finish → attention)
    //   • Upcoming: nearest planned start on top (what's about to begin)
    //   • Done: most recently finished on top
    // Previously the list came back in WBS-index order — sensible for a
    // Gantt but not for a phone that renders one screen at a time.
    const key = (a: Activity): number => {
      if (tab === "UPCOMING") return a.baselineStart ? new Date(a.baselineStart).getTime() : Infinity;
      if (tab === "QUEUE") {
        const f = a.actualFinish ?? a.projectedFinish ?? a.baselineFinish;
        return f ? -new Date(f).getTime() : Infinity;
      }
      return -(a.percentComplete ?? 0); // ONGOING
    };
    return rows.sort((a, b) => key(a) - key(b));
  }, [activities, tab, search]);

  const counts = useMemo(() => {
    if (!activities) return { UPCOMING: 0, ONGOING: 0, QUEUE: 0 };
    const today = new Date();
    const c = { UPCOMING: 0, ONGOING: 0, QUEUE: 0 };
    for (const a of activities) c[statusOf(a, today)]++;
    return c;
  }, [activities]);

  return (
    <div className="px-4 py-4 space-y-4">
      <h1 className="text-xl font-semibold text-stone-900">Site Progress</h1>

      <div className="flex gap-2">
        {(["UPCOMING", "ONGOING", "QUEUE"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-full px-3 py-2 text-xs font-medium ${
              tab === t
                ? "bg-amber-400 text-stone-900"
                : "bg-white border border-stone-200 text-stone-600"
            }`}
          >
            {t === "UPCOMING" ? "Upcoming" : t === "ONGOING" ? "In Progress" : "Done"} ({counts[t]})
          </button>
        ))}
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search activity…"
        className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
      />

      {loadError ? (
        <div className="rounded-xl border border-stone-200 bg-white p-5 text-center">
          <p className="text-sm text-stone-600">Couldn&apos;t load activities.</p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-2 text-sm font-medium text-stone-900 underline"
          >
            Retry
          </button>
        </div>
      ) : activities === null ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-stone-500">No activities in this status.</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((a) => (
            <li key={a.id}>
              <Link
                href={`/mobile/${projectId}/activity/${a.id}`}
                className="block rounded-xl border border-stone-200 bg-white p-4 active:scale-[0.99] transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-medium text-stone-900 truncate">{a.name}</h3>
                    <p className="text-[10px] text-stone-500 truncate mt-0.5">{a.path.slice(0, -1).join(" / ")}</p>
                  </div>
                  {/* Bigger % complete indicator — 64px instead of 48px, and
                      colour-coded by state so an engineer scanning the list
                      can find their in-flight rows without reading each %.
                      Killed the "ID: R3" line above the title — no one uses
                      the WBS ID to find their row. */}
                  <PctBadge percent={a.percentComplete} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-stone-500">Planned Start</div>
                    <div>{fmt(a.baselineStart)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-stone-500">Planned End</div>
                    <div>{fmt(a.baselineFinish)}</div>
                  </div>
                  <div>
                    <div className="text-stone-500">Actual Start</div>
                    <div>{fmt(a.actualStart)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-stone-500">Projected End</div>
                    <div>{fmt(a.projectedFinish)}</div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Big circular %-complete badge for a Site Progress row. Colour maps to state
 * so a site engineer scrolling the "In Progress" tab can eyeball what's
 * nearing finish (green), what's in the middle (amber), and what hasn't
 * started (grey) without reading numbers.
 */
function PctBadge({ percent }: { percent: number }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  // Grey for 0 (not started), green for 100 (done), amber ramp in between.
  // Deliberately no red: this list is view-only status, not urgency.
  const ring =
    p === 0
      ? "border-stone-200 text-stone-400"
      : p >= 100
        ? "border-emerald-500 text-emerald-700"
        : p >= 50
          ? "border-amber-500 text-amber-700"
          : "border-amber-300 text-amber-700";
  return (
    <div
      className={`shrink-0 h-16 w-16 rounded-full border-[3px] flex items-center justify-center text-sm font-bold tabular-nums ${ring}`}
      aria-label={`${p} percent complete`}
    >
      {p}%
    </div>
  );
}
