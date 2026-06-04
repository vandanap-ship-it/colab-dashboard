export default function PhysicalProgressGauge({
  achieved,
  planned,
}: {
  achieved: number;
  planned: number;
}) {
  // Half-circle gauge using SVG
  const r = 70;
  const c = Math.PI * r; // half-circle circumference
  const achievedDash = (Math.min(100, achieved) / 100) * c;
  const plannedDash = (Math.min(100, planned) / 100) * c;

  return (
    <div className="flex flex-col items-center">
      <svg width="180" height="100" viewBox="0 0 180 100" className="overflow-visible">
        {/* background arc */}
        <path
          d="M 20 90 A 70 70 0 0 1 160 90"
          stroke="currentColor"
          strokeWidth="14"
          fill="none"
          className="text-stone-200"
          strokeLinecap="round"
        />
        {/* planned arc (blue) */}
        <path
          d="M 20 90 A 70 70 0 0 1 160 90"
          stroke="#3b82f6"
          strokeWidth="14"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${plannedDash} ${c}`}
        />
        {/* achieved arc (red, narrower) */}
        <path
          d="M 20 90 A 70 70 0 0 1 160 90"
          stroke="#ef4444"
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${achievedDash} ${c}`}
        />
        <text x="90" y="70" textAnchor="middle" className="fill-stone-900 text-2xl font-semibold">
          {achieved.toFixed(1)}%
        </text>
      </svg>
      <div className="flex gap-3 text-xs mt-1">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-blue-500" /> Planned: <span className="font-semibold">{planned.toFixed(1)}%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-red-500" /> Achieved: <span className="font-semibold">{achieved.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}
