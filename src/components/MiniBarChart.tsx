"use client";

export default function MiniBarChart({
  data,
  color = "#0ea5e9",
  height = 140,
  yLabel,
}: {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
  yLabel?: string;
}) {
  if (data.length === 0) {
    return <p className="text-xs text-stone-500">No data.</p>;
  }
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 720;
  const padL = 36;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const innerW = w - padL - padR;
  const innerH = height - padT - padB;
  const barW = innerW / data.length;

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full h-auto" preserveAspectRatio="none">
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = padT + innerH * (1 - t);
        return (
          <g key={t}>
            <line x1={padL} x2={w - padR} y1={y} y2={y} stroke="#E2D5B8" strokeWidth={t === 0 ? 1 : 0.5} strokeDasharray={t === 0 ? "" : "2 2"} />
            <text x={padL - 4} y={y + 3} textAnchor="end" className="fill-stone-500 text-[10px]">
              {Math.round(max * t)}
            </text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const x = padL + i * barW + 1;
        const h = (d.value / max) * innerH;
        const y = padT + innerH - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={Math.max(0, barW - 2)} height={h} fill={color} rx={1} />
          </g>
        );
      })}
      {data.length <= 30 && data.filter((_, i) => i % Math.ceil(data.length / 10) === 0).map((d, i) => {
        const realI = i * Math.ceil(data.length / 10);
        const x = padL + realI * barW + barW / 2;
        return (
          <text key={i} x={x} y={height - 8} textAnchor="middle" className="fill-stone-500 text-[10px]">
            {d.label.slice(5)}
          </text>
        );
      })}
      {yLabel && (
        <text x={4} y={padT + 2} className="fill-stone-500 text-[10px]" textAnchor="start">{yLabel}</text>
      )}
    </svg>
  );
}
