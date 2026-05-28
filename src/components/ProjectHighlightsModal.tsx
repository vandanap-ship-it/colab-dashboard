"use client";

import { Fragment, useEffect, useState } from "react";
import ProbabilityBadge from "./ProbabilityBadge";

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
};

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function diffDays(a: string | null, b: string | null) {
  if (!a || !b) return null;
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

function minDate(dates: (string | null)[]): string | null {
  const valid = dates.filter((d): d is string => !!d).sort();
  return valid[0] ?? null;
}
function maxDate(dates: (string | null)[]): string | null {
  const valid = dates.filter((d): d is string => !!d).sort();
  return valid[valid.length - 1] ?? null;
}

export default function ProjectHighlightsModal({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const [nodes, setNodes] = useState<Node[] | null>(null);
  const [loadError, setLoadError] = useState(false);

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
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Phases are the topmost level present. After CSV import, phases are at
  // level 1; older demo seed had a project root at level 0 with phases at
  // level 1 too. We pick whatever the lowest present level is.
  const allLevels = Array.from(new Set((nodes ?? []).map((n) => n.level))).sort(
    (a, b) => a - b,
  );
  const phaseLevel = allLevels[0] ?? 1;
  const phases = (nodes ?? []).filter((n) => n.level === phaseLevel);

  // Aggregate leaves per phase (recursive descent).
  const leavesByPhase: Record<string, Node[]> = {};
  if (nodes) {
    const childrenOf = (id: string): Node[] => {
      const direct = nodes.filter((n) => n.parentId === id);
      const out: Node[] = [];
      for (const d of direct) {
        if (d.isLeaf) out.push(d);
        else out.push(...childrenOf(d.id));
      }
      return out;
    };
    for (const p of phases) leavesByPhase[p.id] = childrenOf(p.id);
  }

  function phaseStats(phase: Node) {
    const leaves = leavesByPhase[phase.id] ?? [];

    // Achieved %: avg of leaves' percentComplete.
    const achieved = leaves.length === 0
      ? phase.percentComplete
      : leaves.reduce((s, l) => s + l.percentComplete, 0) / leaves.length;

    // Dates: use phase's own dates if present, else aggregate from leaves.
    const baselineStart = phase.baselineStart ?? minDate(leaves.map((l) => l.baselineStart));
    const baselineFinish = phase.baselineFinish ?? maxDate(leaves.map((l) => l.baselineFinish));
    const actualStart = phase.actualStart ?? minDate(leaves.map((l) => l.actualStart));
    const actualFinish = phase.actualFinish ?? maxDate(leaves.map((l) => l.actualFinish));
    const projectedFinish =
      phase.projectedFinish ??
      maxDate(leaves.map((l) => l.projectedFinish ?? l.actualFinish ?? l.baselineFinish)) ??
      baselineFinish;

    const plannedDuration = diffDays(baselineFinish, baselineStart);
    const projectedDuration = diffDays(projectedFinish, baselineStart);
    const totalDelay =
      baselineFinish && projectedFinish ? diffDays(projectedFinish, baselineFinish) : null;

    return {
      achieved,
      baselineStart,
      baselineFinish,
      actualStart,
      projectedFinish,
      plannedDuration,
      projectedDuration,
      totalDelay,
    };
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-stone-900/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-5xl max-h-[90vh] overflow-auto bg-white rounded-xl border border-stone-200 shadow-xl"
      >
        <div className="sticky top-0 bg-stone-900 text-white px-6 py-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Project Highlights</h2>
          <button
            onClick={onClose}
            className="text-stone-300 hover:text-white text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {loadError ? (
          <p className="p-6 text-sm text-stone-500">
            Couldn&apos;t load highlights. Close and reopen to try again.
          </p>
        ) : nodes === null ? (
          <p className="p-6 text-sm text-stone-500">Loading…</p>
        ) : phases.length === 0 ? (
          <p className="p-6 text-sm text-stone-500">
            No phase data yet — import a schedule first.
          </p>
        ) : (
          <div className="p-6 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-stone-500 text-left">
                <tr>
                  <th className="px-2 py-2 font-medium">Phase</th>
                  <th className="px-2 py-2 font-medium text-right">Planned %</th>
                  <th className="px-2 py-2 font-medium">Start</th>
                  <th className="px-2 py-2 font-medium">Finish</th>
                  <th className="px-2 py-2 font-medium text-right">Duration</th>
                  <th className="px-2 py-2 font-medium text-right">Total Delay</th>
                  <th className="px-2 py-2 font-medium text-right">Probability</th>
                </tr>
              </thead>
              <tbody>
                {phases.map((p) => {
                  const s = phaseStats(p);
                  return (
                    <Fragment key={p.id}>
                      <tr className="bg-stone-900 text-white">
                        <td colSpan={7} className="px-2 py-1.5 font-semibold">
                          {p.name}
                        </td>
                      </tr>
                      <tr className="border-t border-stone-100">
                        <td className="px-2 py-2 font-medium text-emerald-700">Planned</td>
                        <td className="px-2 py-2 text-right">
                          <span className="bg-emerald-100 text-emerald-700 font-semibold px-2 py-0.5 rounded">
                            100.00%
                          </span>
                        </td>
                        <td className="px-2 py-2">{fmt(s.baselineStart)}</td>
                        <td className="px-2 py-2">{fmt(s.baselineFinish)}</td>
                        <td className="px-2 py-2 text-right">
                          {s.plannedDuration ?? "—"} days
                        </td>
                        <td className="px-2 py-2 text-right text-stone-400">—</td>
                        <td className="px-2 py-2 text-right text-stone-400">—</td>
                      </tr>
                      <tr>
                        <td className="px-2 py-2 font-medium text-red-700">Actual</td>
                        <td className="px-2 py-2 text-right">
                          <span
                            className={`font-semibold px-2 py-0.5 rounded ${
                              s.achieved >= 90
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-red-100 text-red-700"
                            }`}
                          >
                            {s.achieved.toFixed(2)}%
                          </span>
                        </td>
                        <td className="px-2 py-2">{fmt(s.actualStart)}</td>
                        <td className="px-2 py-2">{fmt(s.projectedFinish)}</td>
                        <td className="px-2 py-2 text-right">
                          {s.projectedDuration ?? "—"} days
                        </td>
                        <td className="px-2 py-2 text-right">
                          {s.totalDelay == null ? (
                            "—"
                          ) : (
                            <span
                              className={
                                s.totalDelay > 0
                                  ? "text-red-600 font-bold"
                                  : "text-emerald-600 font-bold"
                              }
                            >
                              {s.totalDelay > 0
                                ? `${s.totalDelay} Days`
                                : `${s.totalDelay} d`}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <ProbabilityBadge delayDays={s.totalDelay ?? 0} size="xs" />
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
