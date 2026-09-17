/**
 * Pure master-report math. Extracted from reports.ts so it can be unit-tested
 * in isolation. Nothing here touches Prisma or the database — callers pass in
 * plain leaf rows and get plain numbers back.
 *
 * Two formulas live here:
 *   1. `weightedOverallProgress` — overall Planned % and Achieved % across
 *      all leaves, weighted by `weightPct` when the Colab CSV supplied it,
 *      falling back to equal-weight when no weights are present.
 *   2. `contractorZoneRollup` — given a contractor's slice of leaves, roll up
 *      the earliest planned start, latest planned finish, earliest actual
 *      start, latest projected/actual finish, average % complete, signed
 *      delay days (positive = late, negative = ahead).
 *
 * The two also underpin the demo-critical §01 topline on the Master Report
 * and the §02 Project Health by Zone rollup for Amanvana (single-phase +
 * multi-contractor projects).
 */

import { plannedPercentFor } from "@/lib/schedule";

// Minimal shape — a leaf row needs these fields for both formulas. Real
// callers pass Prisma WBSNode rows, which are supersets of this.
export interface LeafRow {
  baselineStart: Date | null;
  baselineFinish: Date | null;
  actualStart: Date | null;
  actualFinish: Date | null;
  projectedFinish: Date | null;
  percentComplete: number | null;
  weightPct: number | null;
}

/** Signed calendar-day difference: `a - b`. Returns null when either bound is missing. */
export function diffDays(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

/**
 * Overall planned / achieved percent across a project's leaves.
 *
 * Weighted path: when at least one leaf has `weightPct` set, use ONLY the
 * weighted leaves (matches Colab's Physical_Progress column semantics — a
 * subset of leaves carry the weight of the whole project, unweighted rows
 * are aggregation-only structural nodes we don't want to count twice).
 *
 * Equal-weighted fallback: when no leaf has a weight, average across every
 * leaf. This is what fires for MSP-imported schedules where per-activity
 * weight hasn't been assigned yet.
 *
 * Zero leaves → zero for both.
 */
export function weightedOverallProgress(
  leaves: LeafRow[],
  today: Date,
): { planned: number; achieved: number } {
  const weighted = leaves.filter((l) => l.weightPct != null);
  if (weighted.length > 0) {
    let planned = 0;
    let achieved = 0;
    for (const l of weighted) {
      const w = l.weightPct ?? 0;
      achieved += (w * (l.percentComplete ?? 0)) / 100;
      planned += (w * plannedPercentFor(l.baselineStart, l.baselineFinish, today)) / 100;
    }
    return { planned, achieved };
  }
  if (leaves.length === 0) return { planned: 0, achieved: 0 };
  let plannedSum = 0;
  let achievedSum = 0;
  for (const l of leaves) {
    plannedSum += plannedPercentFor(l.baselineStart, l.baselineFinish, today);
    achievedSum += l.percentComplete ?? 0;
  }
  return {
    planned: plannedSum / leaves.length,
    achieved: achievedSum / leaves.length,
  };
}

export interface ZoneRollup {
  plannedStart: Date | null;
  plannedFinish: Date | null;
  actualStart: Date | null;
  projectedFinish: Date | null;
  plannedDurationDays: number | null;
  actualDurationDays: number | null;
  actualPercent: number;
  totalDelayDays: number;
}

/**
 * Contractor-zone rollup — takes a contractor's slice of leaves and returns
 * the shape §02 renders per zone row.
 *
 * plannedStart  = earliest baselineStart across leaves
 * plannedFinish = latest baselineFinish across leaves
 * actualStart   = earliest actualStart (null if nothing has started)
 * projectedFinish = latest of (actualFinish || projectedFinish || baselineFinish)
 *                   across leaves — falling back through the priority chain
 *                   ensures we always land on the right "when will this
 *                   contractor finish" date, whether the leaf is complete,
 *                   in-progress with a projection, or still baseline-only.
 * actualPercent = arithmetic mean of leaf percentComplete
 * totalDelayDays = projectedFinish minus plannedFinish (positive = late)
 */
export function contractorZoneRollup(leaves: LeafRow[]): ZoneRollup {
  const plannedStart = leaves.reduce<Date | null>(
    (min, l) => (l.baselineStart && (!min || l.baselineStart < min) ? l.baselineStart : min),
    null,
  );
  const plannedFinish = leaves.reduce<Date | null>(
    (max, l) => (l.baselineFinish && (!max || l.baselineFinish > max) ? l.baselineFinish : max),
    null,
  );
  const actualStart = leaves.reduce<Date | null>(
    (min, l) => (l.actualStart && (!min || l.actualStart < min) ? l.actualStart : min),
    null,
  );
  const projectedFinish = leaves.reduce<Date | null>((max, l) => {
    const cand = l.actualFinish ?? l.projectedFinish ?? l.baselineFinish;
    if (!cand) return max;
    return !max || cand > max ? cand : max;
  }, null);
  const actualPercent =
    leaves.length === 0
      ? 0
      : leaves.reduce((s, l) => s + (l.percentComplete ?? 0), 0) / leaves.length;
  const totalDelayDays =
    plannedFinish && projectedFinish ? (diffDays(projectedFinish, plannedFinish) ?? 0) : 0;
  return {
    plannedStart,
    plannedFinish,
    actualStart,
    projectedFinish,
    plannedDurationDays: diffDays(plannedFinish, plannedStart),
    actualDurationDays: diffDays(projectedFinish, actualStart ?? plannedStart),
    actualPercent: Math.round(actualPercent * 100) / 100,
    totalDelayDays,
  };
}
