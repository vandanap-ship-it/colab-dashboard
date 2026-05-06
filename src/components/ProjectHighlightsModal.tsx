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
  return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
function diffDays(a: string | null, b: string | null) {
  if (!a || !b) return null;
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

export default function ProjectHighlightsModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [nodes, setNodes] = useState<Node[] | null>(null);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/wbs`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setNodes(d.nodes));
  }, [projectId]);

  // Phase = level 2 (e.g. Vaayu, Bhoomi, FLAP under HOS Experience root)
  const phases = (nodes ?? []).filter((n) => n.level === 2);
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

  function phaseAchieved(phase: Node): number {
    const leaves = leavesByPhase[phase.id] ?? [];
    if (leaves.length === 0) return phase.percentComplete;
    return leaves.reduce((s, l) => s + l.percentComplete, 0) / leaves.length;
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
          <button onClick={onClose} className="text-stone-300 hover:text-white text-xl leading-none" aria-label="Close">
            ×
          </button>
        </div>

        {nodes === null ? (
          <p className="p-6 text-sm text-stone-500">Loading…</p>
        ) : phases.length === 0 ? (
          <p className="p-6 text-sm text-stone-500">No phase data yet — import a schedule first.</p>
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
                  const achieved = phaseAchieved(p);
                  const plannedDuration = diffDays(p.baselineFinish, p.baselineStart);
                  const projectedFinish = p.projectedFinish ?? p.actualFinish ?? p.baselineFinish;
                  const projectedDuration = diffDays(projectedFinish, p.baselineStart);
                  const totalDelay = p.baselineFinish && projectedFinish
                    ? diffDays(projectedFinish, p.baselineFinish)
                    : null;
                  return (
                    <Fragment key={p.id}>
                      <tr className="bg-stone-900 text-white">
                        <td colSpan={7} className="px-2 py-1.5 font-semibold">{p.name}</td>
                      </tr>
                      <tr className="border-t border-stone-100">
                        <td className="px-2 py-2 font-medium text-emerald-700">Planned</td>
                        <td className="px-2 py-2 text-right">
                          <span className="bg-emerald-100 text-emerald-700 font-semibold px-2 py-0.5 rounded">
                            100.00%
                          </span>
                        </td>
                        <td className="px-2 py-2">{fmt(p.baselineStart)}</td>
                        <td className="px-2 py-2">{fmt(p.baselineFinish)}</td>
                        <td className="px-2 py-2 text-right">{plannedDuration ?? "—"} days</td>
                        <td className="px-2 py-2 text-right text-stone-400">—</td>
                        <td className="px-2 py-2 text-right text-stone-400">—</td>
                      </tr>
                      <tr>
                        <td className="px-2 py-2 font-medium text-red-700">Actual</td>
                        <td className="px-2 py-2 text-right">
                          <span
                            className={`font-semibold px-2 py-0.5 rounded ${
                              achieved >= 90 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                            }`}
                          >
                            {achieved.toFixed(2)}%
                          </span>
                        </td>
                        <td className="px-2 py-2">{fmt(p.actualStart)}</td>
                        <td className="px-2 py-2">{fmt(projectedFinish)}</td>
                        <td className="px-2 py-2 text-right">
                          {projectedDuration ?? "—"} days
                        </td>
                        <td className="px-2 py-2 text-right">
                          {totalDelay == null ? "—" : (
                            <span className={totalDelay > 0 ? "text-red-600 font-bold" : "text-emerald-600 font-bold"}>
                              {totalDelay > 0 ? `${totalDelay} Days` : `${totalDelay} d`}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <ProbabilityBadge delayDays={totalDelay ?? 0} size="xs" />
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
