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

/**
 * Issue (snag/defect) SLA · 2d aging, 4d stale.
 *
 * Issues are the formal snag record — someone's called out a defect
 * that needs fixing. Sits between a concern (informal heads-up, 2d/5d)
 * and a hindrance (active blocker, 2d/3d) — an unfixed defect over
 * four days without an assignee reads as a supervision gap, but it
 * isn't stopping work. Applied to OPEN and IN_REINSPECTION rows
 * (both are "the issue is still live"); silent on RESOLVED.
 */
export const ISSUE_TIERS: AgeTiers = { agingAt: 2, staleAt: 4 };

export function issueAgeFor(createdAt: Date, now: Date = new Date()): QueueAge {
  return computeAge(createdAt, ISSUE_TIERS, now);
}

/**
 * RFI SLA · 2d aging, 5d stale.
 *
 * An RFI is a question waiting for an answer from the consultant or
 * designer — not a blocker per se, but a real drag on the work it's
 * asking about. Site engineers watch the RFI queue to make sure their
 * questions haven't fallen through the cracks; a five-day-old OPEN
 * RFI reads as a supervision gap.
 *
 * Same tier as concerns because both are "waiting on someone else"
 * signals (concern → leadership, RFI → consultant); tighter than WIRs
 * because that's the SLA the White Lotus team runs consultants to.
 * Applied to OPEN rows only; ANSWERED / CLOSED have their outcome
 * captured elsewhere.
 */
export const RFI_TIERS: AgeTiers = { agingAt: 2, staleAt: 5 };

export function rfiAgeFor(createdAt: Date, now: Date = new Date()): QueueAge {
  return computeAge(createdAt, RFI_TIERS, now);
}

/**
 * Explicit-due-date signal on an RFI. Complementary to rfiAgeFor: the
 * age helper measures how long the RFI has been waiting since it was
 * raised; this one measures the promise the raiser made with the
 * dueDate field. When both are meaningful, the due-date signal takes
 * priority — an explicit promise beats a wall-clock tier.
 *
 *   past-due    "overdue by Nd"    ferrous, days > 0
 *   due today   "due today"        sandstone, days == 0
 *   upcoming    "due in Nd"        neutral, days > 0, only when N is small
 *
 * Callers decide the "small N" upcoming window; the raw days-until-due
 * value is returned so a card can render "due in 3d" while a detail
 * hero renders "due Fri 25 Sep 2026". No signal when dueDate is null.
 */
export interface RfiDueSignal {
  kind: "overdue" | "due-today" | "upcoming";
  /** For overdue: how many days past due. For upcoming: how many days until due. Zero on due-today. */
  days: number;
  /** Short display label suitable for a chip. */
  label: string;
}

/**
 * Adapter that returns a QueueAge-shaped chip from an RFI due signal.
 * Useful for surfaces (like My Actions) that render one chip per row
 * via the shared QueueAge tier→color mapping — this way the row can
 * feed either an age or a due signal into the same slot without
 * plumbing two prop shapes.
 *
 * Mapping:
 *   overdue  → stale   ("overdue by Nd")
 *   due-today→ aging   ("due today")
 *   upcoming ≤ 5d → aging  ("due in Nd")
 *   upcoming > 5d → fresh  (chip is hidden by the renderer)
 */
export function rfiDueSignalAsAge(signal: RfiDueSignal): QueueAge {
  if (signal.kind === "overdue") return { days: signal.days, tier: "stale", label: signal.label };
  if (signal.kind === "due-today") return { days: 0, tier: "aging", label: signal.label };
  // upcoming
  const tier: QueueAgeTier = signal.days <= 5 ? "aging" : "fresh";
  return { days: signal.days, tier, label: signal.label };
}

export function rfiDueSignal(dueDate: Date, now: Date = new Date()): RfiDueSignal {
  // Snap both to UTC midnight so the answer doesn't shift by hour-of-day
  // and stays consistent regardless of where the reader's machine sits.
  // Prisma stores date-only fields at 00:00Z anyway, so this preserves
  // the raiser's intent.
  const startOfDayUtc = (d: Date) =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const due = startOfDayUtc(dueDate);
  const today = startOfDayUtc(now);
  const diffDays = Math.round((due - today) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) {
    const n = -diffDays;
    return { kind: "overdue", days: n, label: `overdue by ${n}d` };
  }
  if (diffDays === 0) {
    return { kind: "due-today", days: 0, label: "due today" };
  }
  return { kind: "upcoming", days: diffDays, label: `due in ${diffDays}d` };
}
