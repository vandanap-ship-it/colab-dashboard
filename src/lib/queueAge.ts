/**
 * Queue-aging math — a shared cue that a row has been waiting a while.
 *
 * Two callers today:
 *   - WIRs        (review SLA is a week; tiers 2d aging, 7d stale)
 *   - Hindrances  (blockers age faster; tiers 2d aging, 3d stale)
 *
 * The tiers themselves are per-domain because "how long is too long"
 * changes with what the row is: a WIR waits until a reviewer picks it
 * up; a hindrance is actively blocking work every day it's open. Both
 * surfaces render the same three-tier chip (fresh silent, aging
 * sandstone, stale ferrous) with the same math driving it.
 */

export type QueueAgeTier = "fresh" | "aging" | "stale";

export interface AgeTiers {
  /** ≥ this many days old and the row moves out of "fresh" into "aging". */
  agingAt: number;
  /** ≥ this many days old and the row moves into "stale" — SLA missed. */
  staleAt: number;
}

export interface QueueAge {
  days: number;
  tier: QueueAgeTier;
  label: string; // "waiting 3d"
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Days between two dates as calendar-day floor. Uses UTC-ms diff and
 * Math.floor so tiny minute-level drift doesn't push a 6d-23h row into
 * the 7d bucket an hour early. Sub-day negatives clamp to 0 so a row
 * created "in the future" (server-clock skew) reads as fresh rather
 * than as a garbage age.
 */
export function daysBetween(from: Date, to: Date): number {
  const raw = (to.getTime() - from.getTime()) / MS_PER_DAY;
  if (raw < 0) return 0;
  return Math.floor(raw);
}

/**
 * Parameterized tier classifier. Kept exported so a new caller (permits,
 * RFIs) can plug in its own SLA without a new helper. The precondition
 * `agingAt <= staleAt` is a caller invariant — not enforced at runtime
 * because it's a typo-in-a-constant class of bug, not a runtime one.
 */
export function tierFor(days: number, tiers: AgeTiers): QueueAgeTier {
  if (days >= tiers.staleAt) return "stale";
  if (days >= tiers.agingAt) return "aging";
  return "fresh";
}

export function computeAge(from: Date, tiers: AgeTiers, now: Date = new Date()): QueueAge {
  const days = daysBetween(from, now);
  return { days, tier: tierFor(days, tiers), label: `waiting ${days}d` };
}

// ---------------------------------------------------------------------------
// Per-domain tiers + convenience wrappers
// ---------------------------------------------------------------------------

/**
 * WIR review SLA · 2d aging, 7d stale.
 *
 * The 7-day cliff mirrors White Lotus's own review SLA: everything raised
 * on Monday should be reviewed by the following Monday, so anything older
 * has definitionally missed the internal SLA.
 */
export const WIR_TIERS: AgeTiers = { agingAt: 2, staleAt: 7 };

export function wirAgeFor(createdAt: Date, now: Date = new Date()): QueueAge {
  return computeAge(createdAt, WIR_TIERS, now);
}

/**
 * Hindrance SLA · 2d aging, 3d stale.
 *
 * A hindrance is BLOCKING work — every day it stays OPEN, someone on
 * site is idle or reworking around it. The stale cliff is much tighter
 * than a WIR's because "waiting a week" on a blocker isn't a review-SLA
 * issue, it's a schedule-slip event. Aging still starts at 2d so a
 * blocker filed today doesn't wear a chip that says nothing new.
 */
export const HINDRANCE_TIERS: AgeTiers = { agingAt: 2, staleAt: 3 };

export function hindranceAgeFor(startDate: Date, now: Date = new Date()): QueueAge {
  return computeAge(startDate, HINDRANCE_TIERS, now);
}

/**
 * Work-permit SLA · 1d aging, 2d stale.
 *
 * A pending permit blocks the work it authorizes: hot work, night work,
 * deshuttering. If a supervisor lets one sit for two days, the crew
 * either starts unpermitted (a safety-culture failure) or loses two
 * days of scheduled work. Both are bad — so the chip fires at 1d and
 * flips ferrous at 2d, the tightest SLA in the app.
 */
export const PERMIT_TIERS: AgeTiers = { agingAt: 1, staleAt: 2 };

export function permitAgeFor(createdAt: Date, now: Date = new Date()): QueueAge {
  return computeAge(createdAt, PERMIT_TIERS, now);
}

/**
 * Concern SLA · 2d aging, 5d stale.
 *
 * Concerns are heads-up observations, not blockers — a supervisor
 * flagged something that needs a look (leak forming, wonky finish,
 * safety near-miss). They're less urgent than a hindrance because
 * they don't stop work, but a concern sitting five days without
 * anyone reading it is a real supervision gap. Applied only to
 * PENDING rows: once someone has READ or TASK_ASSIGNED, the aging
 * signal has already been acknowledged.
 */
export const CONCERN_TIERS: AgeTiers = { agingAt: 2, staleAt: 5 };

export function concernAgeFor(createdAt: Date, now: Date = new Date()): QueueAge {
  return computeAge(createdAt, CONCERN_TIERS, now);
}
