import type { DauPoint } from "@/lib/adoption";

/**
 * Daily active users — inline SVG bar chart. Server-rendered, no
 * JS. Peak bar is reported in the top-right as "Peak N on <day>".
 * Mon/Tue/Wed labels under every ~5th bar so a long window stays
 * readable without crowding.
 */
export default function AdoptionDauChart({ points }: { points: DauPoint[] }) {
  const peak = points.reduce((n, p) => Math.max(n, p.users), 0);
  const peakDay = points.find((p) => p.users === peak)?.day ?? "—";

  // Fixed SVG geometry; the browser scales via CSS width:100%.
  const barGap = 4;
  const barWidth = 14;
  const chartHeight = 160;
  const paddingLeft = 36;
  const paddingBottom = 28;
  const paddingTop = 12;
  const paddingRight = 8;
  const svgWidth = paddingLeft + paddingRight + points.length * (barWidth + barGap);
  const svgHeight = chartHeight + paddingTop + paddingBottom;
  const maxForScale = Math.max(peak, 1);

  // Y-axis ticks at 0, mid, peak so a glance maps a bar to a number.
  const yTicks = [0, Math.ceil(maxForScale / 2), maxForScale];

  return (
    <div className="rounded-xl border border-sandstone-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-ink-3">
          Daily active users
        </h3>
        <p className="text-[11px] text-ink-3">
          Peak <span className="font-semibold text-ink">{peak}</span>
          {peak > 0 && (
            <>
              {" "}on <span className="font-semibold text-ink">{formatDay(peakDay)}</span>
            </>
          )}
        </p>
      </div>

      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          width={svgWidth}
          height={svgHeight}
          role="img"
          aria-label="Daily active users bar chart"
          style={{ maxWidth: "100%" }}
        >
          {/* Y-axis guide lines + labels */}
          {yTicks.map((tick) => {
            const y = paddingTop + chartHeight - (tick / maxForScale) * chartHeight;
            return (
              <g key={tick}>
                <line
                  x1={paddingLeft}
                  x2={svgWidth - paddingRight}
                  y1={y}
                  y2={y}
                  stroke="#E9D8C2"
                  strokeWidth={1}
                  strokeDasharray={tick === 0 ? undefined : "2 3"}
                />
                <text
                  x={paddingLeft - 6}
                  y={y + 3}
                  textAnchor="end"
                  fontSize={10}
                  fill="#6B6D78"
                >
                  {tick}
                </text>
              </g>
            );
          })}

          {/* Bars + x-axis day labels every 5th bar */}
          {points.map((p, i) => {
            const barHeight = (p.users / maxForScale) * chartHeight;
            const x = paddingLeft + i * (barWidth + barGap);
            const y = paddingTop + chartHeight - barHeight;
            const showLabel = i % 5 === 0 || i === points.length - 1;
            return (
              <g key={p.day}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  rx={2}
                  fill={p.users === peak && peak > 0 ? "#965532" : "#C98A68"}
                >
                  <title>{`${formatDay(p.day)} · ${p.users} user${p.users === 1 ? "" : "s"}`}</title>
                </rect>
                {showLabel && (
                  <text
                    x={x + barWidth / 2}
                    y={paddingTop + chartHeight + 14}
                    textAnchor="middle"
                    fontSize={9}
                    fill="#6B6D78"
                  >
                    {formatDayShort(p.day)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function formatDay(iso: string): string {
  const [, mm, dd] = iso.split("-");
  const month = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(mm) - 1];
  return `${dd} ${month}`;
}
function formatDayShort(iso: string): string {
  const [, mm, dd] = iso.split("-");
  return `${dd}/${mm}`;
}
