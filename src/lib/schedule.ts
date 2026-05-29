/**
 * Pure schedule math shared by the dashboard (projectStats) and the reports
 * (reports.ts). Kept dependency-free (no Prisma) so it can be unit-tested in
 * isolation — this is the trust-critical "planned %" calculation behind every
 * planned-vs-achieved number in the app.
 */

/**
 * Linear "planned %" for an activity as of a given date:
 *   - 0   before baselineStart
 *   - 100 on/after baselineFinish
 *   - a straight-line ramp in between
 *
 * Returns 0 when either baseline date is missing (the activity can't be placed
 * on the schedule). A zero-duration activity (start === finish) reads 0 until
 * its date, then 100 — never divides by zero.
 */
export function plannedPercentFor(
  baselineStart: Date | null,
  baselineFinish: Date | null,
  asOf: Date,
): number {
  if (!baselineStart || !baselineFinish) return 0;
  const start = baselineStart.getTime();
  const end = baselineFinish.getTime();
  const now = asOf.getTime();
  if (now <= start) return 0;
  if (now >= end) return 100;
  return ((now - start) / (end - start)) * 100;
}
