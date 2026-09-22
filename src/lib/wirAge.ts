/**
 * WIR queue aging — a reviewer's cue that an inspection has been waiting a
 * while. Only meaningful for IN_REVIEW rows; every other status either had
 * a decision (PASSED / REJECTED) or is deliberately parked (RESCHEDULED),
 * so aging says nothing there.
 *
 * Tiers (calendar days between submission and now):
 *   0-1d  → "fresh"  — no chip, don't cry wolf on new submissions
 *   2-6d  → "aging"  — sandstone chip, gentle nudge
 *   7d+   → "stale"  — ferrous chip, "this needed attention days ago"
 *
 * The 7-day cliff mirrors White Lotus's own review SLA: everything raised
 * on Monday should be reviewed by the following Monday, so anything older
 * has definitionally missed the internal SLA.
 */

export type WirAgeTier = "fresh" | "aging" | "stale";

export interface WirAge {
  days: number;
  tier: WirAgeTier;
  label: string; // "waiting 3d"
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Days between two dates as calendar-day floor. Uses UTC-ms diff and
 * Math.floor so tiny minute-level drift doesn't push a 6d-23h WIR into
 * the 7d bucket a hour early. Sub-day negatives clamp to 0 so a WIR
 * created "in the future" (server-clock skew) reads as fresh rather
 * than as a garbage age.
 */
export function daysBetween(from: Date, to: Date): number {
  const raw = (to.getTime() - from.getTime()) / MS_PER_DAY;
  if (raw < 0) return 0;
  return Math.floor(raw);
}

export function tierFor(days: number): WirAgeTier {
  if (days >= 7) return "stale";
  if (days >= 2) return "aging";
  return "fresh";
}

/**
 * Full WIR age summary. Used by both the list card and the detail hero
 * so the two surfaces always show the same tier + label from the same
 * date.
 */
export function wirAgeFor(createdAt: Date, now: Date = new Date()): WirAge {
  const days = daysBetween(createdAt, now);
  return { days, tier: tierFor(days), label: `waiting ${days}d` };
}
