"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

// The picker endpoint already carries the villa/milestone shape we want
// here — Block → Villa → VillaMilestone (with pctComplete + done). Reading
// from it directly gets us proper per-villa status without trying to guess
// villa identity from WBS crumbs (which only 1.6% of raw activities carry).

type Milestone = {
  id: string;
  name: string;
  code: string;
  pctComplete: number;
  done: boolean;
};
type Villa = {
  id: string;
  number: number;
  label: string;
  milestones: Milestone[];
};
type Block = {
  code: string;
  name: string | null;
  villas: Villa[];
};
type PickerResp = { blocks: Block[] };

type StatusKey = "UPCOMING" | "ONGOING" | "QUEUE";

/**
 * A villa is:
 *   - Done      · every milestone marked done
 *   - Upcoming  · every milestone at 0% AND not done
 *   - Ongoing   · anything else (at least one milestone with 0 < pct < 100)
 * Matches how Shraddha reads the paper report.
 */
function villaStatus(v: Villa): StatusKey {
  if (v.milestones.length === 0) return "UPCOMING";
  const allDone = v.milestones.every((m) => m.done || m.pctComplete >= 100);
  if (allDone) return "QUEUE";
  const anyMoving = v.milestones.some((m) => m.pctComplete > 0 && m.pctComplete < 100);
  const anyStarted = v.milestones.some((m) => m.pctComplete > 0);
  if (anyMoving || (anyStarted && !allDone)) return "ONGOING";
  return "UPCOMING";
}

function villaAvgPct(v: Villa): number {
  if (v.milestones.length === 0) return 0;
  return (
    v.milestones.reduce((s, m) => s + (m.pctComplete || 0), 0) /
    v.milestones.length
  );
}

function villaMilestoneCounts(v: Villa) {
  let done = 0;
  let ongoing = 0;
  let upcoming = 0;
  for (const m of v.milestones) {
    if (m.done || m.pctComplete >= 100) done++;
    else if (m.pctComplete > 0) ongoing++;
    else upcoming++;
  }
  return { done, ongoing, upcoming, total: v.milestones.length };
}

export default function SiteProgressList({ projectId }: { projectId: string }) {
  const [data, setData] = useState<PickerResp | null>(null);
  const [tab, setTab] = useState<StatusKey>("ONGOING");
  const [search, setSearch] = useState("");
  const [openVillaId, setOpenVillaId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    fetch(`/api/projects/${projectId}/activities/picker`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: PickerResp) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadKey]);

  // Flat list of villas with their parent block code, sorted by villa number
  // (natural: V03 < V10 < V32 rather than lexicographic).
  const villasFlat = useMemo(() => {
    if (!data) return [] as Array<{ villa: Villa; blockCode: string }>;
    const out: Array<{ villa: Villa; blockCode: string }> = [];
    for (const b of data.blocks) {
      for (const v of b.villas) out.push({ villa: v, blockCode: b.code });
    }
    return out.sort((a, b) => a.villa.number - b.villa.number);
  }, [data]);

  const filteredVillas = useMemo(() => {
    const q = search.trim().toLowerCase();
    return villasFlat.filter(({ villa, blockCode }) => {
      if (villaStatus(villa) !== tab) return false;
      if (!q) return true;
      return (
        villa.label.toLowerCase().includes(q) ||
        blockCode.toLowerCase().includes(q)
      );
    });
  }, [villasFlat, tab, search]);

  const counts = useMemo(() => {
    const c = { UPCOMING: 0, ONGOING: 0, QUEUE: 0 };
    for (const { villa } of villasFlat) c[villaStatus(villa)]++;
    return c;
  }, [villasFlat]);

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
          <p className="text-sm text-stone-600">Couldn&apos;t load villas.</p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-2 text-sm font-medium text-stone-900 underline"
          >
            Retry
          </button>
        </div>
      ) : data === null ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : filteredVillas.length === 0 ? (
        <p className="text-sm text-stone-500">No villas in this status.</p>
      ) : (
        <ul className="space-y-2">
          {filteredVillas.map(({ villa, blockCode }) => (
            <li key={villa.id}>
              <VillaCard
                villa={villa}
                blockCode={blockCode}
                projectId={projectId}
                open={openVillaId === villa.id}
                onToggle={() => setOpenVillaId((cur) => (cur === villa.id ? null : villa.id))}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Villa card (summary row + expandable milestone list)
// ---------------------------------------------------------------------------

function VillaCard({
  villa,
  blockCode,
  projectId,
  open,
  onToggle,
}: {
  villa: Villa;
  blockCode: string;
  projectId: string;
  open: boolean;
  onToggle: () => void;
}) {
  const pct = Math.round(villaAvgPct(villa));
  const c = villaMilestoneCounts(villa);
  // Order: in-progress first (attention), then upcoming, then done. Matches
  // how the paper report reads left-to-right for a villa row.
  const sortedMilestones = useMemo(() => {
    const rank = (m: Milestone) => {
      if (m.done || m.pctComplete >= 100) return 2;
      if (m.pctComplete > 0) return 0;
      return 1;
    };
    return [...villa.milestones].sort((a, b) => rank(a) - rank(b));
  }, [villa.milestones]);
  return (
    <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-4 py-3 flex items-center gap-3 active:bg-stone-50"
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-stone-900 truncate">{villa.label}</div>
          <div className="text-[11px] text-stone-500 truncate mt-0.5">
            Block {blockCode} · {c.ongoing} in progress · {c.done}/{c.total} done
          </div>
        </div>
        <PctBadge percent={pct} />
        <ChevronRight
          className={`w-4 h-4 text-stone-400 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && (
        <ul className="border-t border-stone-100 divide-y divide-stone-100">
          {sortedMilestones.map((m) => {
            const status: StatusKey =
              m.done || m.pctComplete >= 100 ? "QUEUE" : m.pctComplete > 0 ? "ONGOING" : "UPCOMING";
            return (
              <li key={m.id}>
                <Link
                  // Milestone → activity drilldown. The generic mobile
                  // Progress form knows how to seed an activity from the
                  // milestone via the same route the ActivityPicker uses.
                  href={`/mobile/${projectId}/progress/new?milestone=${m.id}`}
                  className="flex items-center gap-3 px-4 py-2.5 active:bg-stone-50"
                >
                  <MilestonePill status={status} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-stone-900 truncate">{m.name}</div>
                  </div>
                  <div className="text-xs tabular-nums text-stone-500 shrink-0">
                    {m.pctComplete}%
                  </div>
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
 * Circular %-complete badge for a villa row. Colour maps to state so a site
 * engineer scrolling the "In Progress" tab can eyeball which villas are
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
