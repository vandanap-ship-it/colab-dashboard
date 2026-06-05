"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { formatDayMonthYear as fmt } from "@/lib/dates";

type Node = {
  id: string;
  parentId: string | null;
  name: string;
  level: number;
  isLeaf: boolean;
  baselineStart: string | null;
  baselineFinish: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  projectedFinish: string | null;
  percentComplete: number;
  category: string | null;
  path: string[];
};

type BucketKey = "OVERDUE" | "THIS_WEEK" | "THIS_MONTH" | "LATER";

const BUCKET_META: Record<BucketKey, { label: string; dot: string; defaultOpen: boolean }> = {
  // Overdue + the two near-term buckets are open by default — they're the only
  // ones a busy MD / planner actually needs to glance at on the morning load.
  // "Later" stays collapsed so the screen doesn't drown in 50+ milestones that
  // aren't asking for attention right now.
  OVERDUE: { label: "Overdue", dot: "bg-red-500", defaultOpen: true },
  THIS_WEEK: { label: "Due this week", dot: "bg-amber-500", defaultOpen: true },
  THIS_MONTH: { label: "Due this month", dot: "bg-emerald-500", defaultOpen: true },
  LATER: { label: "Later", dot: "bg-stone-400", defaultOpen: false },
};

const BUCKET_ORDER: BucketKey[] = ["OVERDUE", "THIS_WEEK", "THIS_MONTH", "LATER"];

function diffDays(a: Date, b: Date) {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

/** Bucket a milestone by days until its baseline finish (today as reference). */
function bucketFor(daysUntil: number | null, completed: boolean): BucketKey | null {
  if (daysUntil === null || completed) return null; // completed and undated → hidden
  if (daysUntil < 0) return "OVERDUE";
  if (daysUntil <= 7) return "THIS_WEEK";
  if (daysUntil <= 30) return "THIS_MONTH";
  return "LATER";
}

type EnrichedMilestone = Node & {
  daysUntil: number | null;
  bucket: BucketKey | null;
  completed: boolean;
};

export default function MilestoneSummary({ projectId }: { projectId: string }) {
  const [nodes, setNodes] = useState<Node[] | null>(null);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<BucketKey>>(
    () => new Set(BUCKET_ORDER.filter((k) => !BUCKET_META[k].defaultOpen)),
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/wbs`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!cancelled) setNodes(d.nodes ?? []);
      })
      .catch(() => {
        if (!cancelled) setNodes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  /** All non-leaf level-2-or-3 nodes, enriched with bucket + days-until. */
  const enriched: EnrichedMilestone[] = useMemo(() => {
    if (!nodes) return [];
    const today = new Date();
    const out: EnrichedMilestone[] = [];
    for (const n of nodes) {
      if (n.isLeaf || (n.level !== 2 && n.level !== 3)) continue;
      const due = n.baselineFinish ? new Date(n.baselineFinish) : null;
      const daysUntil = due ? diffDays(due, today) : null;
      const completed = n.percentComplete >= 100;
      out.push({ ...n, daysUntil, completed, bucket: bucketFor(daysUntil, completed) });
    }
    return out;
  }, [nodes]);

  /** Apply search filter and group by bucket. */
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched.filter((m) => {
      if (m.bucket === null) return false;
      if (q && !m.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [enriched, search]);

  const byBucket = useMemo(() => {
    const map: Record<BucketKey, EnrichedMilestone[]> = {
      OVERDUE: [],
      THIS_WEEK: [],
      THIS_MONTH: [],
      LATER: [],
    };
    for (const m of visible) if (m.bucket) map[m.bucket].push(m);
    // Sort each bucket by date ascending (most urgent first within the bucket).
    for (const k of BUCKET_ORDER) {
      map[k].sort((a, b) => (a.daysUntil ?? 9e9) - (b.daysUntil ?? 9e9));
    }
    return map;
  }, [visible]);

  function toggle(k: BucketKey) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-stone-700 uppercase tracking-wider">
          Milestone Summary
        </h2>
        {/* Top counter strip — what the eye should land on first. */}
        {nodes !== null && (
          <div className="flex items-center gap-3 text-xs">
            <Counter dot={BUCKET_META.OVERDUE.dot} label="Overdue" count={byBucket.OVERDUE.length} />
            <Counter dot={BUCKET_META.THIS_WEEK.dot} label="This week" count={byBucket.THIS_WEEK.length} />
            <Counter dot={BUCKET_META.THIS_MONTH.dot} label="This month" count={byBucket.THIS_MONTH.length} />
          </div>
        )}
      </div>

      {nodes !== null && enriched.length > 0 && (
        <div className="relative mb-3">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search milestones…"
            className="w-full pl-7 pr-3 py-1.5 rounded-md border border-stone-200 bg-stone-50 text-sm placeholder:text-stone-400 focus:outline-none focus:border-stone-400 focus:bg-white"
          />
        </div>
      )}

      {nodes === null ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-stone-500">
          {enriched.length === 0
            ? "No milestones on this project yet."
            : "Nothing matches your search."}
        </p>
      ) : (
        <div className="space-y-2">
          {BUCKET_ORDER.map((k) => {
            const rows = byBucket[k];
            if (rows.length === 0) return null;
            const isCollapsed = collapsed.has(k);
            const Chevron = isCollapsed ? ChevronRight : ChevronDown;
            return (
              <div key={k} className="rounded-lg border border-stone-100">
                <button
                  type="button"
                  onClick={() => toggle(k)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-stone-50 transition-colors"
                  aria-expanded={!isCollapsed}
                >
                  <Chevron className="w-3.5 h-3.5 text-stone-400" />
                  <span className={`w-2 h-2 rounded-full ${BUCKET_META[k].dot}`} aria-hidden />
                  <span className="text-sm font-medium text-stone-800">
                    {BUCKET_META[k].label}
                  </span>
                  <span className="text-xs text-stone-500">({rows.length})</span>
                </button>
                {!isCollapsed && (
                  <ul className="divide-y divide-stone-100">
                    {rows.map((m) => (
                      <MilestoneRow key={m.id} m={m} />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Counter({ dot, label, count }: { dot: string; label: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${dot}`} aria-hidden />
      <span className="font-semibold text-stone-900 tabular-nums">{count}</span>
      <span className="text-stone-500">{label}</span>
    </span>
  );
}

function MilestoneRow({ m }: { m: EnrichedMilestone }) {
  const pct = Math.round(m.percentComplete);
  const days = m.daysUntil ?? 0;
  const daysText =
    days < 0 ? `${Math.abs(days)}d late` : days === 0 ? "today" : `in ${days}d`;
  const daysClass =
    m.bucket === "OVERDUE"
      ? "text-red-600 bg-red-50"
      : m.bucket === "THIS_WEEK"
        ? "text-amber-700 bg-amber-50"
        : "text-stone-600 bg-stone-100";

  return (
    <li className="px-3 py-2 flex items-baseline justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <div className="text-sm font-medium text-stone-900 truncate">{m.name}</div>
        {m.path.length > 1 && (
          <div className="text-[10px] text-stone-400 truncate">
            {m.path.slice(0, -1).join(" / ")}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-stone-500 tabular-nums">{fmt(m.baselineFinish)}</span>
        <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${daysClass}`}>
          {daysText}
        </span>
        <span className="text-stone-900 font-semibold tabular-nums w-9 text-right">{pct}%</span>
      </div>
    </li>
  );
}
