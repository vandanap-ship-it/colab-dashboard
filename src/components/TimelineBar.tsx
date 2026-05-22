function fmt(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export default function TimelineBar({
  plannedStart,
  plannedEnd,
  actualStart,
  projectedEnd,
}: {
  plannedStart: Date | null;
  plannedEnd: Date | null;
  actualStart: Date | null;
  projectedEnd: Date | null;
}) {
  // Planned bar shows how much of the planned calendar has passed today.
  // Actual bar shows where we actually are between actualStart and projectedEnd.
  // Neither shows arbitrary 50% fill any more.

  const today = new Date();

  function pctElapsed(start: Date | null, end: Date | null): number {
    if (!start || !end) return 0;
    const total = end.getTime() - start.getTime();
    if (total <= 0) return 0;
    const elapsed = today.getTime() - start.getTime();
    return Math.max(0, Math.min(100, (elapsed / total) * 100));
  }

  const plannedPct = pctElapsed(plannedStart, plannedEnd);
  const actualPct = actualStart ? pctElapsed(actualStart, projectedEnd) : 0;

  return (
    <div className="space-y-2">
      <div>
        <div className="flex justify-between text-xs text-stone-500">
          <span>Planned Start: {fmt(plannedStart)}</span>
          <span>Planned End: {fmt(plannedEnd)}</span>
        </div>
        <div className="h-2 mt-1 rounded-full bg-stone-200 relative overflow-hidden">
          <div
            className="h-full bg-amber-300"
            style={{ width: `${plannedPct}%` }}
          />
        </div>
      </div>
      <div>
        <div className="flex justify-between text-xs text-stone-500">
          <span>Actual Start: {fmt(actualStart)}</span>
          <span>Projected End: {fmt(projectedEnd)}</span>
        </div>
        <div className="h-2 mt-1 rounded-full bg-stone-200 relative overflow-hidden">
          <div
            className="h-full bg-red-400"
            style={{ width: `${actualPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
