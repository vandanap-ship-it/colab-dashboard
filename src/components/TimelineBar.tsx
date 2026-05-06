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
  // Width is purely visual — proportions based on dates if all 4 set, else half/half.
  let plannedWidth = 50;
  let projectedWidth = 50;
  if (plannedStart && plannedEnd && projectedEnd) {
    const planned = plannedEnd.getTime() - plannedStart.getTime();
    const projected = projectedEnd.getTime() - plannedStart.getTime();
    const max = Math.max(planned, projected, 1);
    plannedWidth = Math.max(15, Math.round((planned / max) * 100));
    projectedWidth = Math.max(15, Math.round((projected / max) * 100));
  }

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
            style={{ width: `${plannedWidth}%` }}
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
            style={{ width: `${projectedWidth}%` }}
          />
        </div>
      </div>
    </div>
  );
}
