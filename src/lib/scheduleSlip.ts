// Single source of truth for "how late is this milestone" across the whole
// dashboard. Both the Dashboard tab (executiveDataAdapter) and the Progress
// tab (progressTabServer) call these so their delay numbers can never drift.
//
// Why "credited" slip exists (Vandana, 2026-11-16 management-review deep dive):
// The naive measure — calendar days from baseline to today for anything not
// closed — treats a foundation that's 80% built the same as one that's 0%
// started. On Amanvana 53 of 54 overdue milestones have started and average
// ~40% complete, so the naive measure materially overstates the delay. The
// credited measure discounts the slip by the share of work already done, so
// the headline reflects physical reality. The raw calendar number is kept
// alongside (shown as a secondary figure) so nothing is hidden.

const DAY_MS = 86_400_000;

export interface SlipInput {
  baselineFinish: Date | null;
  actualFinish: Date | null;
  /** 0–100. Maintained per-milestone by the site team; same source as the
   *  "% complete" column already on the Progress tab. */
  pctComplete: number;
}

/**
 * Days this milestone is behind baseline. Only ever returns the BEHIND side
 * (0 for not-due, ahead-of-plan, closed-on-time, or missing data); callers
 * credit the ahead side separately from closed milestones.
 *
 *   open past-due → (today − baselineFinish) × remaining-work-fraction
 *   closed late   → actualFinish − baselineFinish   (final; 100% done, no credit)
 *
 * Pass creditProgress = false for the raw calendar slip (the secondary
 * "raw calendar slippage" figure under the headline).
 */
export function milestoneSlipDays(m: SlipInput, now: Date, creditProgress = true): number {
  if (!m.baselineFinish) return 0;
  if (!m.actualFinish) {
    if (m.baselineFinish > now) return 0; // not due yet
    const calendar = Math.max(0, Math.round((now.getTime() - m.baselineFinish.getTime()) / DAY_MS));
    if (!creditProgress) return calendar;
    const remaining = 1 - Math.min(100, Math.max(0, m.pctComplete)) / 100;
    return calendar * remaining;
  }
  const diff = Math.round((m.actualFinish.getTime() - m.baselineFinish.getTime()) / DAY_MS);
  return diff > 0 ? diff : 0;
}

/** Days this milestone finished AHEAD of baseline (0 unless closed early). */
export function milestoneAheadDays(m: SlipInput): number {
  if (!m.baselineFinish || !m.actualFinish) return 0;
  const diff = Math.round((m.actualFinish.getTime() - m.baselineFinish.getTime()) / DAY_MS);
  return diff < 0 ? -diff : 0;
}
