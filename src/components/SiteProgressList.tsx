"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

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

// The WBS crumb trail for Amanvana runs
//   [Project, Block XX, Villa YY (or Villa Set), Section, Sub-section, Activity]
// We extract the villa crumb ("Villa 07", "Villa 10 & 11", "Villa Set ( V32, V33 )")
// as the villa identity. Any activity whose crumbs don't include a Villa* segment
// (e.g. project-level activities) rolls up under a fallback "Project-level" group
// so we still surface them rather than silently drop.
const VILLA_CRUMB_RE = /^villa\b/i;
function villaCrumbOf(a: Activity): string {
  const villaCrumb = a.path.find((p) => VILLA_CRUMB_RE.test(p));
  return villaCrumb ?? "Project-level";
}
function blockCrumbOf(a: Activity): string | null {
  const blockCrumb = a.path.find((p) => /^block\b/i.test(p));
  return blockCrumb ?? null;
}

type VillaGroup = {
  villa: string;
  block: string | null;
  activities: Activity[];
  status: StatusKey; // Whichever status the villa's activities MOSTLY fall into (dominant)
  ongoingCount: number;
  doneCount: number;
  upcomingCount: number;
  totalCount: number;
  avgPercent: number;
};

/** Group activities by villa, then compute a headline status per villa so the
 *  three-tab filter still means something at the villa level. A villa lands in
 *  "In Progress" if it has at least one ONGOING activity; "Upcoming" if all its
 *  activities are still upcoming; "Done" only when every activity is complete.
 *  This mirrors how Shraddha reads the paper report — "which villas are moving
 *  right now" is the primary question, not "which activities". */
function groupByVilla(activities: Activity[], today: Date): VillaGroup[] {
  const byVilla = new Map<string, VillaGroup>();
  for (const a of activities) {
    const villa = villaCrumbOf(a);
    const block = blockCrumbOf(a);
    let g = byVilla.get(villa);
    if (!g) {
      g = {
        villa,
        block,
        activities: [],
        status: "ONGOING",
        ongoingCount: 0,
        doneCount: 0,
        upcomingCount: 0,
        totalCount: 0,
        avgPercent: 0,
      };
      byVilla.set(villa, g);
    }
    g.activities.push(a);
    g.totalCount++;
    const s = statusOf(a, today);
    if (s === "ONGOING") g.ongoingCount++;
    else if (s === "UPCOMING") g.upcomingCount++;
    else g.doneCount++;
  }
  const groups = Array.from(byVilla.values());
  for (const g of groups) {
    g.avgPercent =
      g.activities.reduce((sum, a) => sum + (a.percentComplete || 0), 0) /
      Math.max(1, g.activities.length);
    if (g.ongoingCount > 0) g.status = "ONGOING";
    else if (g.doneCount === g.totalCount) g.status = "QUEUE";
    else g.status = "UPCOMING";
  }
  return groups;
}

/** Extract "Villa 07" → 7 for natural-number sort so villa 2 sits before villa 10. */
function villaSortKey(v: string): number {
  const m = v.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

export default function SiteProgressList({ projectId }: { projectId: string }) {
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [tab, setTab] = useState<StatusKey>("ONGOING");
  const [search, setSearch] = useState("");
  const [openVilla, setOpenVilla] = useState<string | null>(null);
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

  const today = useMemo(() => new Date(), []);
  const villaGroups = useMemo(() => {
    if (!activities) return [];
    return groupByVilla(activities, today);
  }, [activities, today]);

  const filteredVillas = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = villaGroups.filter((g) => {
      if (g.status !== tab) return false;
      if (!q) return true;
      return (
        g.villa.toLowerCase().includes(q) ||
        (g.block ?? "").toLowerCase().includes(q)
      );
    });
    // Villa 02, 03, 04… reads naturally in numeric order — matches the paper
    // scorecard. Villas without a number (fallback groups) sort last.
    return rows.sort((a, b) => villaSortKey(a.villa) - villaSortKey(b.villa));
  }, [villaGroups, tab, search]);

  const counts = useMemo(() => {
    const c = { UPCOMING: 0, ONGOING: 0, QUEUE: 0 };
    for (const g of villaGroups) c[g.status]++;
    return c;
  }, [villaGroups]);

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
        placeholder="Search villa or block…"
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
      ) : filteredVillas.length === 0 ? (
        <p className="text-sm text-stone-500">No villas in this status.</p>
      ) : (
        <ul className="space-y-2">
          {filteredVillas.map((g) => (
            <li key={g.villa}>
              <VillaCard
                group={g}
                projectId={projectId}
                today={today}
                open={openVilla === g.villa}
                onToggle={() => setOpenVilla((cur) => (cur === g.villa ? null : g.villa))}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Villa card (row + expandable milestone list)
// ---------------------------------------------------------------------------

function VillaCard({
  group,
  projectId,
  today,
  open,
  onToggle,
}: {
  group: VillaGroup;
  projectId: string;
  today: Date;
  open: boolean;
  onToggle: () => void;
}) {
  const pct = Math.round(group.avgPercent);
  // Sort activities inside the villa: in-progress on top, then upcoming, then
  // done — same read order Shraddha uses in her weekly review.
  const sortedActivities = useMemo(() => {
    const rank = (a: Activity) => {
      const s = statusOf(a, today);
      return s === "ONGOING" ? 0 : s === "UPCOMING" ? 1 : 2;
    };
    return [...group.activities].sort((a, b) => rank(a) - rank(b));
  }, [group.activities, today]);
  return (
    <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-4 py-3 flex items-center gap-3 active:bg-stone-50"
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-stone-900 truncate">{group.villa}</div>
          <div className="text-[11px] text-stone-500 truncate mt-0.5">
            {group.block ?? "Project-level"} · {group.ongoingCount} in progress · {group.doneCount}/{group.totalCount} done
          </div>
        </div>
        <PctBadge percent={pct} />
        <ChevronRight
          className={`w-4 h-4 text-stone-400 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && (
        <ul className="border-t border-stone-100 divide-y divide-stone-100">
          {sortedActivities.map((a) => {
            const s = statusOf(a, today);
            return (
              <li key={a.id}>
                <Link
                  href={`/mobile/${projectId}/activity/${a.id}`}
                  className="flex items-center gap-3 px-4 py-2.5 active:bg-stone-50"
                >
                  <MilestonePill status={s} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-stone-900 truncate">{a.name}</div>
                    <div className="text-[10px] text-stone-500 truncate">
                      {/* Show the section crumb (parent of the leaf, minus the villa/block) so an engineer can tell "Ground Floor Structure" apart from "Terrace Works". */}
                      {a.path.slice(0, -1).filter((p) => !/^villa\b/i.test(p) && !/^block\b/i.test(p)).join(" / ")}
                    </div>
                  </div>
                  <div className="text-xs tabular-nums text-stone-500 shrink-0">{Math.round(a.percentComplete)}%</div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MilestonePill({ status }: { status: StatusKey }) {
  const cfg = {
    ONGOING:  { dot: "bg-amber-500",   label: "In progress" },
    UPCOMING: { dot: "bg-stone-300",   label: "Upcoming"    },
    QUEUE:    { dot: "bg-emerald-500", label: "Done"        },
  } as const;
  const c = cfg[status];
  return (
    <span className="inline-flex items-center gap-1.5 shrink-0">
      <span className={`w-2 h-2 rounded-full ${c.dot}`} aria-hidden />
      <span className="sr-only">{c.label}</span>
    </span>
  );
}

/**
 * Big circular %-complete badge for a villa row. Colour maps to state so a
 * site engineer scrolling the "In Progress" tab can eyeball which villas are
 * nearing finish (green), which are mid-work (amber), and which are just
 * getting started (light amber) without reading numbers.
 */
function PctBadge({ percent }: { percent: number }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
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
      className={`shrink-0 h-12 w-12 rounded-full border-[3px] flex items-center justify-center text-xs font-bold tabular-nums ${ring}`}
      aria-label={`${p} percent complete`}
    >
      {p}%
    </div>
  );
}
