"use client";

import { useMemo, useState } from "react";
import type { TimelineData } from "@/lib/scheduleServer";

interface Props {
  data: TimelineData;
}

const MS_PER_DAY = 86_400_000;

// Colour bands mirror the executive-dashboard status palette.
const COLORS = {
  done:      "#2E7D5B",   // completed on-time
  doneSlipped: "#C77A2A", // completed with delay
  inProgress: "#2F5D8A",  // actual started, not done
  atRisk:    "#B33A3A",   // projected past baseline
  planned:   "#B8BCC4",   // future work, no signal yet
} as const;

function slipDays(baselineFinish: Date | null, finish: Date | null): number {
  if (!baselineFinish || !finish) return 0;
  return Math.round((finish.getTime() - baselineFinish.getTime()) / MS_PER_DAY);
}

function colorFor(m: TimelineData["villas"][number]["milestones"][number]): string {
  if (m.actualFinish) {
    const slip = slipDays(m.baselineFinish, m.actualFinish);
    return slip > 0 ? COLORS.doneSlipped : COLORS.done;
  }
  if (m.actualStart) return COLORS.inProgress;
  if (m.projectedFinish && m.baselineFinish && m.projectedFinish > m.baselineFinish) {
    return COLORS.atRisk;
  }
  return COLORS.planned;
}

/**
 * CSS-grid Gantt. Each villa is one row. The row is a horizontal strip
 * divided by months; each milestone is a colored bar positioned by its date
 * range. Simple, information-dense, no external chart library.
 */
export default function MilestoneTimeline({ data }: Props) {
  const [blockFilter, setBlockFilter] = useState<string>("");

  // Compute overall date window + list of months.
  const { rangeStart, rangeEnd, months } = useMemo(() => {
    const start = data.projectStart ?? new Date();
    const end = data.projectEnd ?? new Date(start.getTime() + 365 * MS_PER_DAY);
    // Round to month boundaries
    const s = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    const e = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0));
    const months: { label: string; start: Date }[] = [];
    for (let d = new Date(s); d <= e; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
      const labels = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      months.push({ label: `${labels[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(-2)}`, start: new Date(d) });
    }
    return { rangeStart: s, rangeEnd: e, months };
  }, [data.projectStart, data.projectEnd]);

  const totalMs = rangeEnd.getTime() - rangeStart.getTime();
  const pctFor = (date: Date): number => Math.max(0, Math.min(100, ((date.getTime() - rangeStart.getTime()) / totalMs) * 100));

  // Block filter options — unique block codes present.
  const blockCodes = useMemo(() => {
    const set = new Set(data.villas.map((v) => v.blockCode));
    return Array.from(set).sort((a, b) => {
      const ai = parseInt(a, 10); const bi = parseInt(b, 10);
      if (!isNaN(ai) && !isNaN(bi) && ai !== bi) return ai - bi;
      return a.localeCompare(b);
    });
  }, [data.villas]);

  const visibleVillas = blockFilter
    ? data.villas.filter((v) => v.blockCode === blockFilter)
    : data.villas;

  // Today marker position
  const today = new Date();
  const todayPct = today >= rangeStart && today <= rangeEnd ? pctFor(today) : null;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-2 text-sm">
          <label className="text-stone-500 text-xs uppercase tracking-wider font-semibold">Block</label>
          <select
            value={blockFilter}
            onChange={(e) => setBlockFilter(e.target.value)}
            className="rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-sm"
          >
            <option value="">All blocks ({data.villas.length} villas)</option>
            {blockCodes.map((c) => (
              <option key={c} value={c}>Block {c}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3 text-xs text-stone-500">
          <Legend color={COLORS.done} label="Done · on-time" />
          <Legend color={COLORS.doneSlipped} label="Done · slipped" />
          <Legend color={COLORS.inProgress} label="In progress" />
          <Legend color={COLORS.atRisk} label="Projected slip" />
          <Legend color={COLORS.planned} label="Planned" />
        </div>
      </div>

      {/* Chart */}
      <div className="rounded-xl border border-stone-200 bg-white overflow-x-auto">
        <div className="min-w-[900px]">
          {/* Month header */}
          <div className="grid" style={{ gridTemplateColumns: "160px 1fr", borderBottom: "1px solid #EDE9DD" }}>
            <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-stone-500 border-r border-stone-100">
              Villa
            </div>
            <div className="relative">
              <div className="grid" style={{ gridTemplateColumns: `repeat(${months.length}, 1fr)` }}>
                {months.map((m, i) => (
                  <div key={i} className="px-1 py-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400 border-r border-stone-100 text-center">
                    {m.label}
                  </div>
                ))}
              </div>
              {todayPct != null && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-red-500 z-10 pointer-events-none"
                  style={{ left: `${todayPct}%` }}
                  title="Today"
                />
              )}
            </div>
          </div>

          {/* Villa rows */}
          <div>
            {visibleVillas.length === 0 ? (
              <div className="p-8 text-center text-stone-400 text-sm">
                No villas match this filter.
              </div>
            ) : (
              visibleVillas.map((v) => (
                <div key={v.villaId} className="grid border-b border-stone-100" style={{ gridTemplateColumns: "160px 1fr" }}>
                  <div className="px-3 py-3 text-sm border-r border-stone-100 flex flex-col justify-center">
                    <div className="font-medium text-stone-900">{v.villaLabel}</div>
                    <div className="text-[10px] text-stone-400 font-mono">Block {v.blockCode}</div>
                  </div>
                  <div className="relative" style={{ height: 40 }}>
                    {todayPct != null && (
                      <div
                        className="absolute top-0 bottom-0 w-px bg-red-500 opacity-40 z-10 pointer-events-none"
                        style={{ left: `${todayPct}%` }}
                      />
                    )}
                    {v.milestones.map((m) => {
                      const start = m.actualStart ?? m.baselineStart;
                      const finish = m.actualFinish ?? m.projectedFinish ?? m.baselineFinish;
                      if (!start || !finish) return null;
                      const left = pctFor(start);
                      const right = pctFor(finish);
                      const width = Math.max(0.3, right - left);
                      return (
                        <div
                          key={m.sectionCode}
                          className="absolute rounded-sm hover:opacity-90 hover:z-20"
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            top: 12,
                            height: 16,
                            background: colorFor(m),
                          }}
                          title={`${m.sectionName} · ${m.pctComplete.toFixed(0)}% · ${dateShort(m.baselineStart)} → ${dateShort(m.baselineFinish)}${m.actualFinish ? ` (actual ${dateShort(m.actualFinish)})` : ""}`}
                        />
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="text-xs text-stone-400 mt-3">
        {visibleVillas.length} villas · date range {dateShort(rangeStart)} → {dateShort(rangeEnd)}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-3 h-3 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function dateShort(d: Date | null): string {
  if (!d) return "—";
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${String(d.getUTCDate()).padStart(2, "0")} ${months[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(-2)}`;
}
