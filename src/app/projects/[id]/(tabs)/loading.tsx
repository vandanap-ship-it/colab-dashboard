/**
 * Skeleton for the project tab pages (Dashboard / Progress / QA/QC / EHS /
 * My Actions). Shows immediately on tab switch so the app feels responsive
 * even while the server rolls up 14k WBS nodes + weeks of ProgressEntry
 * rows behind the scenes.
 *
 * A proper perf fix would cache the aggregators with unstable_cache (keyed
 * by projectId), but that's a per-page refactor. This is the launch-week
 * fix — perceived performance for free.
 */
export default function TabsLoading() {
  return (
    <div className="animate-pulse space-y-4">
      {/* Top KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-stone-100" />
        ))}
      </div>
      {/* Wide section — timeline / progress bars */}
      <div className="h-56 rounded-xl bg-stone-100" />
      {/* Two-column mid sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="h-40 rounded-xl bg-stone-100" />
        <div className="h-40 rounded-xl bg-stone-100" />
      </div>
      {/* Wide bottom section */}
      <div className="h-72 rounded-xl bg-stone-100" />
    </div>
  );
}
