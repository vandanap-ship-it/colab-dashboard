"use client";

import { useMemo, useState } from "react";

export type GanttNode = {
  id: string;
  name: string;
  level: number;
  parentId: string | null;
  baselineStart: string | null; // ISO
  baselineFinish: string | null; // ISO
  actualStart: string | null;
  actualFinish: string | null;
  projectedFinish: string | null;
  percentComplete: number;
  isLeaf: boolean;
  contractorName: string | null;
};

type Period = "day" | "week" | "month";

const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 44;
const LEFT_W = 280; // sticky activity-name column width
const PX_PER_DAY: Record<Period, number> = { day: 24, week: 6, month: 1.6 };

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function dayDiff(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}
function fmtMonth(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
}

export default function GanttChart({ nodes }: { nodes: GanttNode[] }) {
  const [period, setPeriod] = useState<Period>("week");
  const [showLeavesOnly, setShowLeavesOnly] = useState(false);

  // Filter to nodes with both baseline dates set.
  const visible = useMemo(
    () =>
      nodes.filter(
        (n) =>
          n.baselineStart &&
          n.baselineFinish &&
          (!showLeavesOnly || n.isLeaf),
      ),
    [nodes, showLeavesOnly],
  );

  const { minDate, maxDate, totalDays } = useMemo(() => {
    if (visible.length === 0) {
      const today = startOfDay(new Date());
      return { minDate: today, maxDate: addDays(today, 30), totalDays: 30 };
    }
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const n of visible) {
      if (n.baselineStart) min = Math.min(min, new Date(n.baselineStart).getTime());
      if (n.baselineFinish) max = Math.max(max, new Date(n.baselineFinish).getTime());
      if (n.actualStart) min = Math.min(min, new Date(n.actualStart).getTime());
      if (n.actualFinish) max = Math.max(max, new Date(n.actualFinish).getTime());
      if (n.projectedFinish) max = Math.max(max, new Date(n.projectedFinish).getTime());
    }
    const minDate = startOfDay(new Date(min));
    const maxDate = startOfDay(new Date(max));
    return { minDate, maxDate, totalDays: dayDiff(minDate, maxDate) + 1 };
  }, [visible]);

  const pxPerDay = PX_PER_DAY[period];
  const chartW = Math.max(400, totalDays * pxPerDay);
  const chartH = HEADER_HEIGHT + visible.length * ROW_HEIGHT;

  // Build month-tick markers for the header axis.
  const months: { x: number; label: string }[] = [];
  if (totalDays > 0) {
    const startMonth = new Date(
      Date.UTC(minDate.getUTCFullYear(), minDate.getUTCMonth(), 1),
    );
    let cur = startMonth;
    while (cur <= maxDate) {
      const x = dayDiff(minDate, cur) * pxPerDay;
      months.push({ x, label: fmtMonth(cur) });
      cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    }
  }

  // Today marker
  const today = startOfDay(new Date());
  const todayX =
    today >= minDate && today <= maxDate ? dayDiff(minDate, today) * pxPerDay : null;

  return (
    <div className="rounded-xl border border-stone-200 bg-white">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {(["day", "week", "month"] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={
                "text-xs font-medium px-3 py-1 rounded-full transition-colors " +
                (period === p
                  ? "bg-stone-900 text-white"
                  : "border border-stone-200 bg-white text-stone-700 hover:bg-stone-50")
              }
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-stone-600">
          <input
            type="checkbox"
            checked={showLeavesOnly}
            onChange={(e) => setShowLeavesOnly(e.target.checked)}
          />
          Leaves only
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-stone-500 text-center py-10">
          No scheduled activities to plot. Import a schedule first.
        </p>
      ) : (
        <div className="flex">
          {/* Sticky activity-name column */}
          <div
            className="border-r border-stone-200 bg-white shrink-0"
            style={{ width: LEFT_W }}
          >
            <div
              className="border-b border-stone-200 bg-stone-50"
              style={{ height: HEADER_HEIGHT }}
            >
              <div className="px-4 h-full flex items-end pb-2 text-[10px] uppercase tracking-widest text-stone-500">
                Activity
              </div>
            </div>
            {visible.map((n) => (
              <div
                key={n.id}
                className="px-4 border-b border-stone-100 flex items-center text-xs text-stone-700 truncate"
                style={{
                  height: ROW_HEIGHT,
                  paddingLeft: 16 + Math.min(n.level - 1, 4) * 12,
                  fontWeight: n.isLeaf ? 400 : 600,
                }}
                title={n.name}
              >
                <span className="truncate">{n.name}</span>
              </div>
            ))}
          </div>

          {/* Scrollable timeline */}
          <div className="overflow-x-auto flex-1 relative">
            <svg
              width={chartW}
              height={chartH}
              className="block"
              style={{ minWidth: chartW }}
            >
              {/* Header background */}
              <rect width={chartW} height={HEADER_HEIGHT} fill="#FAFAF9" />
              <line
                x1={0}
                x2={chartW}
                y1={HEADER_HEIGHT}
                y2={HEADER_HEIGHT}
                stroke="#E2D5B8"
                strokeWidth={1}
              />

              {/* Month ticks */}
              {months.map((m, i) => (
                <g key={i}>
                  <line
                    x1={m.x}
                    x2={m.x}
                    y1={0}
                    y2={chartH}
                    stroke="#EFE6D2"
                    strokeWidth={0.5}
                  />
                  <text
                    x={m.x + 6}
                    y={HEADER_HEIGHT - 14}
                    className="fill-stone-700 text-[10px] font-medium"
                  >
                    {m.label}
                  </text>
                </g>
              ))}

              {/* Today marker */}
              {todayX != null && (
                <g>
                  <line
                    x1={todayX}
                    x2={todayX}
                    y1={HEADER_HEIGHT - 6}
                    y2={chartH}
                    stroke="#F59E0B"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                  />
                  <text
                    x={todayX + 4}
                    y={HEADER_HEIGHT - 10}
                    className="fill-amber-700 text-[9px] font-semibold uppercase tracking-wider"
                  >
                    Today
                  </text>
                </g>
              )}

              {/* Bars */}
              {visible.map((n, i) => {
                const y = HEADER_HEIGHT + i * ROW_HEIGHT + 6;
                const bs = n.baselineStart ? new Date(n.baselineStart) : null;
                const bf = n.baselineFinish ? new Date(n.baselineFinish) : null;
                if (!bs || !bf) return null;
                const x1 = dayDiff(minDate, bs) * pxPerDay;
                const x2 = (dayDiff(minDate, bf) + 1) * pxPerDay;
                const w = Math.max(2, x2 - x1);
                const h = ROW_HEIGHT - 12;
                const fillW = (w * Math.min(100, Math.max(0, n.percentComplete))) / 100;

                // Pick a colour: blue (in progress / planned), green (complete), red (overdue)
                const isComplete = n.percentComplete >= 100;
                const isOverdue = !isComplete && bf < today;
                const baseFill = isComplete
                  ? "#10b981"
                  : isOverdue
                    ? "#ef4444"
                    : "#93c5fd";
                const progFill = isComplete
                  ? "#059669"
                  : isOverdue
                    ? "#b91c1c"
                    : "#1d4ed8";

                return (
                  <g key={n.id}>
                    {/* Row hover band */}
                    <rect
                      x={0}
                      y={HEADER_HEIGHT + i * ROW_HEIGHT}
                      width={chartW}
                      height={ROW_HEIGHT}
                      fill={i % 2 === 0 ? "#FFFFFF" : "#FBF7EE"}
                    />
                    <line
                      x1={0}
                      x2={chartW}
                      y1={HEADER_HEIGHT + (i + 1) * ROW_HEIGHT}
                      y2={HEADER_HEIGHT + (i + 1) * ROW_HEIGHT}
                      stroke="#F4EBD8"
                      strokeWidth={0.5}
                    />
                    {/* Baseline bar */}
                    <rect
                      x={x1}
                      y={y}
                      width={w}
                      height={h}
                      fill={baseFill}
                      rx={3}
                      opacity={0.8}
                    >
                      <title>
                        {n.name} — {bs.toISOString().slice(0, 10)} →{" "}
                        {bf.toISOString().slice(0, 10)} · {Math.round(n.percentComplete)}%
                      </title>
                    </rect>
                    {/* Progress fill */}
                    {fillW > 0 && (
                      <rect x={x1} y={y} width={fillW} height={h} fill={progFill} rx={3} />
                    )}
                    {/* Label inside bar if wide enough */}
                    {w > 80 && (
                      <text
                        x={x1 + 6}
                        y={y + h / 2 + 3}
                        className="fill-stone-900 text-[9px] font-medium pointer-events-none"
                      >
                        {Math.round(n.percentComplete)}%
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="px-4 py-2 border-t border-stone-200 flex items-center gap-4 flex-wrap text-xs text-stone-600">
        <Legend color="#93c5fd" label="Planned / in progress" />
        <Legend color="#10b981" label="Complete" />
        <Legend color="#ef4444" label="Overdue" />
        <span className="ml-auto text-[11px] text-stone-400">
          Showing {visible.length} of {nodes.length} activities
        </span>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-3 h-3 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
