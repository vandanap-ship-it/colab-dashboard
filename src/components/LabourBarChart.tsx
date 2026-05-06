"use client";

export type LabourBarPoint = {
  label: string;
  planned: number;
  actual: number;
};

export default function LabourBarChart({
  data,
  height = 200,
}: {
  data: LabourBarPoint[];
  height?: number;
}) {
  if (data.length === 0) {
    return <p className="text-xs text-stone-500">No labour data in this range.</p>;
  }

  const max = Math.max(1, ...data.map((d) => Math.max(d.planned, d.actual)));
  const w = 900;
  const padL = 40;
  const padR = 12;
  const padT = 16;
  const padB = 36;
  const innerW = w - padL - padR;
  const innerH = height - padT - padB;
  const groupW = innerW / data.length;
  const gap = Math.min(8, groupW * 0.12);
  const barW = Math.max(2, (groupW - gap * 2) / 2);

  const PLANNED = "#93c5fd";
  const ACTUAL = "#86efac";

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full h-auto" preserveAspectRatio="none">
        {/* Y-axis grid + labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padT + innerH * (1 - t);
          return (
            <g key={t}>
              <line
                x1={padL}
                x2={w - padR}
                y1={y}
                y2={y}
                stroke="#E2D5B8"
                strokeWidth={t === 0 ? 1 : 0.5}
                strokeDasharray={t === 0 ? "" : "2 2"}
              />
              <text
                x={padL - 4}
                y={y + 3}
                textAnchor="end"
                className="fill-stone-500 text-[10px]"
              >
                {Math.round(max * t)}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {data.map((d, i) => {
          const groupX = padL + i * groupW + gap;
          const plannedH = (d.planned / max) * innerH;
          const actualH = (d.actual / max) * innerH;
          const plannedY = padT + innerH - plannedH;
          const actualY = padT + innerH - actualH;
          return (
            <g key={i}>
              <rect
                x={groupX}
                y={plannedY}
                width={barW}
                height={plannedH}
                fill={PLANNED}
                rx={1}
              />
              <rect
                x={groupX + barW + gap / 2}
                y={actualY}
                width={barW}
                height={actualH}
                fill={ACTUAL}
                rx={1}
              />
              {/* Value labels on top of each bar (only if there's room) */}
              {d.planned > 0 && plannedH > 14 && (
                <text
                  x={groupX + barW / 2}
                  y={plannedY - 3}
                  textAnchor="middle"
                  className="fill-stone-700 text-[10px]"
                >
                  {d.planned}
                </text>
              )}
              {d.actual > 0 && actualH > 14 && (
                <text
                  x={groupX + barW + gap / 2 + barW / 2}
                  y={actualY - 3}
                  textAnchor="middle"
                  className="fill-stone-700 text-[10px]"
                >
                  {d.actual}
                </text>
              )}
            </g>
          );
        })}

        {/* X-axis labels */}
        {data.map((d, i) => {
          const x = padL + i * groupW + groupW / 2;
          return (
            <text
              key={i}
              x={x}
              y={height - 16}
              textAnchor="middle"
              className="fill-stone-500 text-[10px]"
            >
              {d.label}
            </text>
          );
        })}
      </svg>

      <div className="flex items-center justify-center gap-6 mt-2 text-xs text-stone-600">
        <span className="flex items-center gap-2">
          <span
            className="inline-block w-3 h-3 rounded-sm"
            style={{ background: PLANNED }}
          />
          Planned Labour Count
        </span>
        <span className="flex items-center gap-2">
          <span
            className="inline-block w-3 h-3 rounded-sm"
            style={{ background: ACTUAL }}
          />
          Actual Labour Count
        </span>
      </div>
    </div>
  );
}
