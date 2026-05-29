"use client";

import { useEffect, useMemo, useState } from "react";

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

const TIME_FILTERS = [
  { key: "ALL", label: "All Milestones" },
  { key: "MONTH", label: "This Month" },
  { key: "M3", label: "< 3 Months" },
  { key: "M6", label: "< 6 Months" },
] as const;

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
function diffDays(a: Date, b: Date) {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

export default function MilestoneSummary({ projectId }: { projectId: string }) {
  const [nodes, setNodes] = useState<Node[] | null>(null);
  const [phaseFilter, setPhaseFilter] = useState<string>("ALL");
  const [timeFilter, setTimeFilter] = useState<(typeof TIME_FILTERS)[number]["key"]>("ALL");

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
        // Leave nodes null → component shows its "Loading…" / empty fallback
        // rather than crashing. Milestones are non-critical chrome.
        if (!cancelled) setNodes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // "Phases" = top-level groupings beneath the project root. We use level 2 if available, else level 3.
  // The "milestones" we display = level 2 and 3 branches (groupings, not leaves).
  const phases = useMemo(() => {
    if (!nodes) return [] as string[];
    const set = new Set<string>();
    for (const n of nodes) {
      if (n.level === 2 || n.level === 3) set.add(n.name);
    }
    return Array.from(set);
  }, [nodes]);

  const milestones = useMemo(() => {
    if (!nodes) return [];
    return nodes.filter((n) => !n.isLeaf && (n.level === 2 || n.level === 3));
  }, [nodes]);

  const filtered = useMemo(() => {
    const today = new Date();
    return milestones.filter((m) => {
      if (phaseFilter !== "ALL") {
        // Match if any path segment equals the phase filter
        if (!m.path.includes(phaseFilter)) return false;
      }
      if (timeFilter === "ALL") return true;
      const due = m.baselineFinish ? new Date(m.baselineFinish) : null;
      if (!due) return false;
      const days = diffDays(due, today);
      if (timeFilter === "MONTH") return days <= 30 && days >= -30;
      if (timeFilter === "M3") return days <= 90;
      if (timeFilter === "M6") return days <= 180;
      return true;
    });
  }, [milestones, phaseFilter, timeFilter]);

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-stone-700 uppercase tracking-wider">Milestone Summary</h2>
      </div>

      {nodes !== null && phases.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2 mb-2">
            <button
              onClick={() => setPhaseFilter("ALL")}
              className={`text-xs font-medium px-3 py-1.5 rounded-full ${
                phaseFilter === "ALL" ? "bg-amber-400 text-stone-900" : "bg-stone-100 text-stone-600"
              }`}
            >
              All
            </button>
            {phases.map((p) => (
              <button
                key={p}
                onClick={() => setPhaseFilter(p)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full ${
                  phaseFilter === p ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-600"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            {TIME_FILTERS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTimeFilter(t.key)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full ${
                  timeFilter === t.key ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-600"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </>
      )}

      {nodes === null ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-stone-500">No milestones in this filter.</p>
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-xs">
            <thead className="text-stone-500 text-left">
              <tr>
                <th className="px-2 py-2 font-medium">Milestone</th>
                <th className="px-2 py-2 font-medium">Planned</th>
                <th className="px-2 py-2 font-medium">Actual</th>
                <th className="px-2 py-2 font-medium">Projected</th>
                <th className="px-2 py-2 font-medium text-right">Delay</th>
                <th className="px-2 py-2 font-medium text-right">Progress</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const baseline = m.baselineFinish ? new Date(m.baselineFinish) : null;
                const projected = m.projectedFinish ? new Date(m.projectedFinish) : (m.actualFinish ? new Date(m.actualFinish) : null);
                const delay = baseline && projected ? diffDays(projected, baseline) : null;
                return (
                  <tr key={m.id} className="border-t border-stone-100">
                    <td className="px-2 py-2">
                      <div className="font-medium text-stone-900">{m.name}</div>
                      <div className="text-[10px] text-stone-500">{m.path.slice(0, -1).join(" / ")}</div>
                    </td>
                    <td className="px-2 py-2 text-stone-600">{fmt(m.baselineFinish)}</td>
                    <td className="px-2 py-2 text-stone-600">{fmt(m.actualFinish)}</td>
                    <td className="px-2 py-2 text-stone-600">{fmt(m.projectedFinish)}</td>
                    <td className="px-2 py-2 text-right">
                      {delay == null ? "—" : (
                        <span className={delay > 0 ? "text-red-600 font-semibold" : "text-emerald-600 font-semibold"}>
                          {delay > 0 ? `+${delay}d` : `${delay}d`}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <span className="text-stone-900 font-semibold">{Math.round(m.percentComplete)}%</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
