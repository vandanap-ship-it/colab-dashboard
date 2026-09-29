"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, FileEdit } from "lucide-react";
import { ScreenHeading } from "./mobile/ui";
import { AMANVANA_CONTRACTORS, AMANVANA_VILLA_NUMBER_TO_BLOCK } from "@/lib/projects/amanvana";

// Contractor-of-villa lookup. Same logic ActivityPicker uses: villa labels
// carry ints ("Villa 3", "Villa 10 & 11", "Villa Set ( V32, V33 )") and any
// of them landing in the Abraham set flags the villa as Abraham's; else
// Elegant. Grouped-pair labels hit both by design.
const ABRAHAM_NUMBERS = new Set(
  Object.keys(AMANVANA_VILLA_NUMBER_TO_BLOCK).map((n) => parseInt(n, 10)),
);
function contractorOfVillaLabel(label: string): "abraham" | "elegant" {
  const nums: number[] = [];
  for (const m of label.matchAll(/\d+/g)) {
    const n = parseInt(m[0], 10);
    if (Number.isFinite(n)) nums.push(n);
  }
  if (nums.length === 0) return "elegant";
  return nums.some((n) => ABRAHAM_NUMBERS.has(n)) ? "abraham" : "elegant";
}

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

// Colab-parity Site Progress buckets (Madhavan zip 2026-09-30):
//   UPCOMING   - "Upcoming" tab
//   ONGOING    - "On Going" tab (Colab spelling; two words)
//   IN_QUALITY - "In Quality" tab. Villas where at least one activity is
//                currently blocked by a pending QAQC checklist per
//                `checkPrecheck`. Populated by a follow-up endpoint;
//                count renders as 0 until wired.
//   QUEUE      - "Completed" tab (kept the internal name QUEUE for
//                minimal churn; display label is now "Completed").
type StatusKey = "UPCOMING" | "ONGOING" | "IN_QUALITY" | "QUEUE";

/**
 * A villa is:
 *   - In Quality · at least one activity is blocked by a pending QAQC
 *                  checklist (this bucket wins over Ongoing/Upcoming
 *                  because the site team needs to see the gate before
 *                  they try to log more progress).
 *   - Completed  · every milestone marked done
 *   - Upcoming   · every milestone at 0% AND not done
 *   - On Going   · anything else (at least one milestone in progress)
 * Matches how Shraddha reads the paper report and Colab's own tab order.
 */
function villaStatus(v: Villa, blockedIds: Set<string>): StatusKey {
  if (blockedIds.has(v.id)) return "IN_QUALITY";
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

interface DraftRow {
  id: string;
  createdAt: string;
  cumulativeQuantity: number;
  wbsNode: {
    id: string;
    name: string;
    totalQuantity: number | null;
  };
}

type ContractorKey = "all" | "abraham" | "elegant";

export default function SiteProgressList({ projectId }: { projectId: string }) {
  const [data, setData] = useState<PickerResp | null>(null);
  const [tab, setTab] = useState<StatusKey>("ONGOING");
  const [search, setSearch] = useState("");
  const [contractor, setContractor] = useState<ContractorKey>("all");
  const [openVillaId, setOpenVillaId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Colab-parity "In Quality" bucket. Fetched separately from the
  // picker tree since it depends on inspection state (independent
  // refresh cycle: an inspection PASS should flip a villa out of In
  // Quality without needing a picker reload).
  const [blockedVillaIds, setBlockedVillaIds] = useState<Set<string>>(new Set());
  // Draft rows for the current user on this project. Small query,
  // runs alongside the picker fetch. Empty by default → strip renders
  // nothing. On failure we silently drop it — a broken drafts strip
  // shouldn't block the main villa list.
  const [drafts, setDrafts] = useState<DraftRow[]>([]);

  // Drafts fetch — user-scoped by the server route; no need to filter here.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/progress?projectId=${encodeURIComponent(projectId)}&status=draft&limit=20`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((j: { entries?: DraftRow[] }) => {
        if (cancelled) return;
        setDrafts(Array.isArray(j.entries) ? j.entries : []);
      })
      .catch(() => {
        if (!cancelled) setDrafts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadKey]);

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

  // In Quality villa set. Failure is silent — a broken gate endpoint
  // shouldn't hide the whole list; the tab just shows 0.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/quality-gate-status`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { blockedVillaIds: [] }))
      .then((j: { blockedVillaIds?: string[] }) => {
        if (cancelled) return;
        setBlockedVillaIds(new Set(Array.isArray(j.blockedVillaIds) ? j.blockedVillaIds : []));
      })
      .catch(() => {
        if (!cancelled) setBlockedVillaIds(new Set());
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
      if (villaStatus(villa, blockedVillaIds) !== tab) return false;
      if (contractor !== "all" && contractorOfVillaLabel(villa.label) !== contractor) return false;
      if (!q) return true;
      return (
        villa.label.toLowerCase().includes(q) ||
        blockCode.toLowerCase().includes(q)
      );
    });
  }, [villasFlat, tab, search, contractor, blockedVillaIds]);

  const counts = useMemo(() => {
    const c: Record<StatusKey, number> = { UPCOMING: 0, ONGOING: 0, IN_QUALITY: 0, QUEUE: 0 };
    for (const { villa } of villasFlat) c[villaStatus(villa, blockedVillaIds)]++;
    return c;
  }, [villasFlat, blockedVillaIds]);

  return (
    <div className="px-5 py-5 space-y-4">
      <ScreenHeading
        title="Site progress"
        lede="Every villa on the site, most-active first. Tap one to see its milestones."
      />

      {/* Drafts strip · surfaces the current user's unfinished
          Progress entries. Tap one to resume in the form (pre-filled).
          Only shown when the engineer has drafts, so the section
          doesn't take space for engineers who never save drafts. */}
      {drafts.length > 0 && (
        <section
          className="rounded-2xl border border-sandstone-100 bg-cream overflow-hidden"
          aria-label="Your drafts"
        >
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-sandstone-100">
            <FileEdit className="w-4 h-4 text-ferrous-500" />
            <span className="text-[13px] font-semibold text-ink">
              Your drafts <span className="text-ink-3 font-normal">({drafts.length})</span>
            </span>
          </div>
          <ul className="divide-y divide-sandstone-100">
            {drafts.map((d) => {
              const total = d.wbsNode.totalQuantity ?? 0;
              const pct =
                total > 0
                  ? Math.max(0, Math.min(100, Math.round((d.cumulativeQuantity / total) * 100)))
                  : Math.max(0, Math.min(100, Math.round(d.cumulativeQuantity)));
              return (
                <li key={d.id}>
                  <Link
                    href={`/mobile/${projectId}/progress/new?draftId=${d.id}`}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-medium text-ink truncate">
                        {d.wbsNode.name}
                      </div>
                      <div className="text-[12px] text-ink-3 mt-0.5">
                        {pct}% saved &middot; {new Date(d.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-ink-3 flex-shrink-0" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Contractor filter · Amanvana has two awarded contractors. Chips
          sit above the status tabs so the engineer can narrow the whole
          list to one contractor's scope in a single tap. "All" is the
          default so no engineer is surprised by hidden villas on load. */}
      <div className="flex gap-2">
        {([
          { key: "all" as const, label: "All contractors" },
          { key: "abraham" as const, label: AMANVANA_CONTRACTORS.abraham },
          { key: "elegant" as const, label: AMANVANA_CONTRACTORS.elegant },
        ]).map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setContractor(c.key)}
            className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold ${
              contractor === c.key
                ? "bg-ferrous-500 text-white"
                : "bg-sandstone-100 text-ink-2"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Colab-parity 4-tab strip · Upcoming · On Going · In Quality ·
          Completed. Horizontal-scroll so all four fit on a narrow phone. */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto no-scrollbar px-1 pb-1">
        {(["UPCOMING", "ONGOING", "IN_QUALITY", "QUEUE"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap ${
              tab === t
                ? "bg-ink text-cream"
                : "bg-cream border border-sandstone-100 text-ink-2"
            }`}
          >
            {t === "UPCOMING"
              ? "Upcoming"
              : t === "ONGOING"
                ? "On Going"
                : t === "IN_QUALITY"
                  ? "In Quality"
                  : "Completed"}
            <span
              className={`ml-1.5 inline-flex items-center justify-center rounded-full text-[10px] px-1.5 min-w-[18px] h-[16px] ${
                tab === t ? "bg-cream text-ink" : "bg-sandstone-100 text-ink-3"
              }`}
            >
              {counts[t]}
            </span>
          </button>
        ))}
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search villa or block…"
        className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[15px]"
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
    <div className="rounded-2xl border border-sandstone-100 bg-cream overflow-hidden shadow-soft">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-4 py-3.5 flex items-center gap-3 active:bg-sandstone-50"
      >
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-ink truncate">{villa.label}</div>
          <div className="text-[12px] text-ink-3 truncate mt-0.5">
            Block {blockCode} · {c.ongoing} in progress · {c.done}/{c.total} done
          </div>
        </div>
        <PctBadge percent={pct} />
        <ChevronRight
          className={`w-4 h-4 text-ink-3 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && (
        <ul className="border-t border-sandstone-100 divide-y divide-sandstone-100 bg-white">
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
    ONGOING:    { dot: "bg-amber-500",   label: "On Going"   },
    UPCOMING:   { dot: "bg-stone-300",   label: "Upcoming"   },
    IN_QUALITY: { dot: "bg-orange-500",  label: "In Quality" },
    QUEUE:      { dot: "bg-emerald-500", label: "Completed"  },
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
