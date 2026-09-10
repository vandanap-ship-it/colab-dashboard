import ProbabilityBadge from "./ProbabilityBadge";
import { formatDayMonthYear as fmt } from "@/lib/dates";

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
  // RERA Delay: positive = late vs the RERA-committed date. Only computed when
  // both dates are present; falls back to "—" so we don't fake a green "0 Days"
  // for a project that hasn't set its RERA date. Previously hardcoded to "0 Days".
  const reraDelayDays: number | null =
    reraEndDate && projectedEndDate ? diffDays(projectedEndDate, reraEndDate) : null;

  return (
    <div className="grid grid-cols-2 gap-4 text-sm">
      <div className="space-y-2">
        <Row label="Project Start Date" value={fmt(startDate)} />
        <Row label="Project End Date" value={fmt(endDate)} />
        {/* RERA rows only render when the project actually tracks a RERA
            date. On Amanvana Phase 1 (and other projects that skip RERA
            entry) showing "RERA End Date: —" and "RERA Delay: —" just
            adds two empty rows to the card — hide instead. */}
        {reraEndDate && <Row label="RERA End Date" value={fmt(reraEndDate)} />}
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
        {reraDelayDays != null && (
          <Stat
            label="RERA Delay"
            value={`${reraDelayDays} Days`}
            color={reraDelayDays > 0 ? "text-red-600" : "text-emerald-600"}
          />
        )}
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
