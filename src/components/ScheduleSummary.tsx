import ProbabilityBadge from "./ProbabilityBadge";

function fmt(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

export default function ScheduleSummary({
  startDate,
  endDate,
  projectedEndDate,
  reraEndDate,
  totalDelayDays,
  hindranceCount,
}: {
  startDate: Date | null;
  endDate: Date | null;
  projectedEndDate: Date | null;
  reraEndDate: Date | null;
  totalDelayDays: number;
  hindranceCount: number;
}) {
  const plannedDuration = startDate && endDate ? diffDays(endDate, startDate) : null;
  const projectedDuration =
    startDate && projectedEndDate ? diffDays(projectedEndDate, startDate) : plannedDuration;

  return (
    <div className="grid grid-cols-2 gap-4 text-sm">
      <div className="space-y-2">
        <Row label="Project Start Date" value={fmt(startDate)} />
        <Row label="Project End Date" value={fmt(endDate)} />
        <Row label="RERA End Date" value={fmt(reraEndDate)} />
        <Row
          label="Planned Duration"
          value={plannedDuration != null ? `${plannedDuration} Days` : "—"}
        />
        <Row
          label="Projected Duration"
          value={projectedDuration != null ? `${projectedDuration} Days` : "—"}
        />
        <Row
          label="On-Time Probability"
          value={<ProbabilityBadge delayDays={totalDelayDays} />}
        />
      </div>
      <div className="space-y-3 text-right">
        <Stat
          label="Total Delay"
          value={`${totalDelayDays} Days`}
          color={totalDelayDays > 0 ? "text-red-600" : "text-emerald-600"}
        />
        <Stat label="RERA Delay" value="0 Days" color="text-emerald-600" />
        <Stat
          label="Hindrances"
          value={`${hindranceCount} open`}
          color={hindranceCount > 0 ? "text-red-600" : "text-stone-500"}
        />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-stone-600">{label}</span>
      <span className="text-stone-300">:</span>
      <span className="text-stone-900 font-medium">{value}</span>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-stone-500">{label}</div>
    </div>
  );
}
