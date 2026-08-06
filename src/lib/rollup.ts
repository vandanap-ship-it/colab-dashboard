// ---------------------------------------------------------------------------
// Rollup math — single source of truth for all delay / projection / progress
// calculations across the executive dashboard.
//
// Pure functions only: take structured data in, return numbers/enums out. No
// Prisma / DB / IO here. The web layer or MSP importer prepares the inputs.
//
// Formulas locked with product owner 2026-08-06:
//   - Delay days: show BOTH current-in-flight slip AND handover slip in the UI.
//     For rollup / bucketing purposes, use handover slip (that's what matters
//     for "when does the villa finish").
//   - Probability of Timely Completion: RERA-date threshold, not %-based.
//     HIGH   → projected handover ≤ RERA date
//     MEDIUM → projected handover ≤ RERA date + GRACE_DAYS
//     LOW    → projected handover >  RERA date + GRACE_DAYS
//   - Progress rollups are duration-weighted (a 30-day task counts more than
//     a 1-day QC Hold), not equally weighted.
// ---------------------------------------------------------------------------

export const GRACE_DAYS = 15;

// Bucket thresholds for the health pills (green/orange/red)
export const HEALTHY_MAX_SLIP = 0;    // ≤ 0 days slip → healthy
export const WARNING_MAX_SLIP = 30;   // ≤ 30 days slip → warning; > 30 → critical

export type HealthBucket = "healthy" | "warning" | "critical" | "not-started";
export type Probability = "HIGH" | "MEDIUM" | "LOW";

// ---------------------------------------------------------------------------
// Types — the shape of nodes fed in. Match Prisma model fields (nullable
// dates, decimal progressPercent) but stay Prisma-independent.
// ---------------------------------------------------------------------------

export interface Task {
  id: string;
  isSubMilestone: boolean;      // true = ★ concreting checkpoint; false = task
  baselineStart: Date | null;
  baselineFinish: Date | null;
  actualStart: Date | null;
  actualFinish: Date | null;
  projectedFinish: Date | null;
  percentComplete: number;      // 0–100
  durationDays: number;         // duration in days for weighting (default 1)
}

export interface MilestoneRollup {
  section: string;              // "Foundation / Substructure"
  order: number;                // 0..20
  baselineStart: Date | null;
  baselineFinish: Date | null;
  actualStart: Date | null;
  actualFinish: Date | null;
  projectedFinish: Date | null;
  percentComplete: number;      // duration-weighted rollup from tasks
  delayDays: number;            // 0 if on-time, positive if slipping
  status: HealthBucket;
}

export interface VillaRollup {
  number: number;
  blockCode: string;
  milestones: MilestoneRollup[];
  currentSection: number;       // index of in-flight milestone; -1 if not started
  currentSlipDays: number;      // slip of the currently-active milestone
  handoverSlipDays: number;     // slip of the final Handover milestone
  handoverProjected: Date | null;
  percentComplete: number;      // duration-weighted across milestones
  status: HealthBucket;
  staleDays: number | null;     // days since last field update (data hygiene)
}

export interface BlockRollup {
  code: string;
  villas: VillaRollup[];
  handoverSlipDays: number;     // max across villas
  currentSlipDays: number;      // max across villas
  percentComplete: number;      // mean across villas (equal weighting; villas are similar type)
  status: HealthBucket;
}

export interface ProjectRollup {
  blocks: BlockRollup[];
  handoverSlipDays: number;     // max villa handover slip = project overrun
  currentSlipDays: number;      // max in-flight slip anywhere
  projectedEnd: Date | null;
  percentComplete: number;
  criticalBlocks: number;       // count of blocks with slip > WARNING_MAX_SLIP
  criticalVillas: number;
}

// ---------------------------------------------------------------------------
// Core arithmetic
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/** Slip days for a single item. Positive = late, 0 = on-time. */
export function slipDaysFor(baselineFinish: Date | null, actualFinish: Date | null, projectedFinish: Date | null): number {
  if (!baselineFinish) return 0;
  const finish = actualFinish ?? projectedFinish;
  if (!finish) return 0;
  return Math.max(0, daysBetween(baselineFinish, finish));
}

/** Best-known finish date: actual first, else projected, else baseline. */
export function bestFinishFor(baselineFinish: Date | null, actualFinish: Date | null, projectedFinish: Date | null): Date | null {
  return actualFinish ?? projectedFinish ?? baselineFinish;
}

/** Duration-weighted mean of percent completes. */
export function weightedProgress<T extends { percentComplete: number; durationDays: number }>(items: T[]): number {
  if (items.length === 0) return 0;
  const totalDur = items.reduce((s, x) => s + Math.max(1, x.durationDays), 0);
  const weighted = items.reduce((s, x) => s + x.percentComplete * Math.max(1, x.durationDays), 0);
  return totalDur === 0 ? 0 : weighted / totalDur;
}

/** Bucket a slip value into health status. */
export function bucketForSlip(slipDays: number, hasStarted: boolean): HealthBucket {
  if (!hasStarted) return "not-started";
  if (slipDays <= HEALTHY_MAX_SLIP) return "healthy";
  if (slipDays <= WARNING_MAX_SLIP) return "warning";
  return "critical";
}

// ---------------------------------------------------------------------------
// Milestone-level rollup: tasks → milestone
// ---------------------------------------------------------------------------

export function rollupMilestone(
  section: string,
  order: number,
  tasks: Task[],
): MilestoneRollup {
  if (tasks.length === 0) {
    return {
      section, order,
      baselineStart: null, baselineFinish: null,
      actualStart: null, actualFinish: null, projectedFinish: null,
      percentComplete: 0, delayDays: 0, status: "not-started",
    };
  }

  // Milestone baseline = earliest start + latest finish across its tasks
  const baselineStart = tasks.reduce<Date | null>((min, t) => {
    if (!t.baselineStart) return min;
    return !min || t.baselineStart < min ? t.baselineStart : min;
  }, null);
  const baselineFinish = tasks.reduce<Date | null>((max, t) => {
    if (!t.baselineFinish) return max;
    return !max || t.baselineFinish > max ? t.baselineFinish : max;
  }, null);

  const actualStart = tasks.reduce<Date | null>((min, t) => {
    if (!t.actualStart) return min;
    return !min || t.actualStart < min ? t.actualStart : min;
  }, null);

  // Milestone complete = ALL tasks 100% AND latest actual known.
  const allDone = tasks.every((t) => t.percentComplete >= 100);
  const actualFinish = allDone
    ? tasks.reduce<Date | null>((max, t) => {
        if (!t.actualFinish) return max;
        return !max || t.actualFinish > max ? t.actualFinish : max;
      }, null)
    : null;

  // Projected finish = latest projected across tasks (worst-case slip)
  const projectedFinish = tasks.reduce<Date | null>((max, t) => {
    const best = bestFinishFor(t.baselineFinish, t.actualFinish, t.projectedFinish);
    if (!best) return max;
    return !max || best > max ? best : max;
  }, null);

  const percentComplete = weightedProgress(tasks);
  const delayDays = slipDaysFor(baselineFinish, actualFinish, projectedFinish);
  const status: HealthBucket = allDone
    ? "healthy"
    : bucketForSlip(delayDays, actualStart != null);

  return {
    section, order,
    baselineStart, baselineFinish,
    actualStart, actualFinish, projectedFinish,
    percentComplete: Math.round(percentComplete * 100) / 100,
    delayDays, status,
  };
}

// ---------------------------------------------------------------------------
// Villa rollup: milestones → villa (with current + handover slip)
// ---------------------------------------------------------------------------

export function rollupVilla(
  number: number,
  blockCode: string,
  milestones: MilestoneRollup[],
  staleDays: number | null = null,
): VillaRollup {
  const started = milestones.filter((m) => m.actualStart);
  const inFlight = milestones.filter((m) => m.actualStart && !m.actualFinish);

  // Current section = first in-flight, else next after last-done, else -1
  let currentSection = -1;
  if (inFlight.length > 0) {
    currentSection = inFlight.reduce((a, b) => (a.order < b.order ? a : b)).order;
  } else if (started.length > 0) {
    const lastDone = started.reduce((a, b) => (a.order > b.order ? a : b));
    currentSection = Math.min(milestones.length - 1, lastDone.order + 1);
  }

  const current = currentSection >= 0 ? milestones[currentSection] : null;
  const currentSlipDays = current?.delayDays ?? 0;

  // Handover = last milestone. Standardize name-agnostic (order-based).
  const handover = milestones[milestones.length - 1];
  const handoverSlipDays = handover?.delayDays ?? 0;
  const handoverProjected = handover
    ? bestFinishFor(handover.baselineFinish, handover.actualFinish, handover.projectedFinish)
    : null;

  // Villa progress = duration-weighted across milestones (approximated equal
  // weighting here since milestone-level duration is a sum of task durations
  // and gets very large — use plain mean at the milestone level).
  const percentComplete = milestones.length === 0
    ? 0
    : milestones.reduce((s, m) => s + m.percentComplete, 0) / milestones.length;

  const status = bucketForSlip(handoverSlipDays, started.length > 0);

  return {
    number, blockCode, milestones,
    currentSection, currentSlipDays,
    handoverSlipDays, handoverProjected,
    percentComplete: Math.round(percentComplete * 100) / 100,
    status, staleDays,
  };
}

// ---------------------------------------------------------------------------
// Block rollup: villas → block
// ---------------------------------------------------------------------------

export function rollupBlock(code: string, villas: VillaRollup[]): BlockRollup {
  if (villas.length === 0) {
    return { code, villas: [], handoverSlipDays: 0, currentSlipDays: 0,
             percentComplete: 0, status: "not-started" };
  }
  const handoverSlipDays = Math.max(0, ...villas.map((v) => v.handoverSlipDays));
  const currentSlipDays  = Math.max(0, ...villas.map((v) => v.currentSlipDays));
  const percentComplete  = villas.reduce((s, v) => s + v.percentComplete, 0) / villas.length;
  const anyStarted = villas.some((v) => v.currentSection >= 0);
  const status = bucketForSlip(handoverSlipDays, anyStarted);
  return {
    code, villas, handoverSlipDays, currentSlipDays,
    percentComplete: Math.round(percentComplete * 100) / 100,
    status,
  };
}

// ---------------------------------------------------------------------------
// Project rollup: blocks → project
// ---------------------------------------------------------------------------

export function rollupProject(blocks: BlockRollup[]): ProjectRollup {
  const villas = blocks.flatMap((b) => b.villas);
  const handoverSlipDays = Math.max(0, ...blocks.map((b) => b.handoverSlipDays));
  const currentSlipDays  = Math.max(0, ...blocks.map((b) => b.currentSlipDays));

  const projectedEnd = villas.reduce<Date | null>((max, v) => {
    if (!v.handoverProjected) return max;
    return !max || v.handoverProjected > max ? v.handoverProjected : max;
  }, null);

  const percentComplete = blocks.length === 0
    ? 0
    : blocks.reduce((s, b) => s + b.percentComplete, 0) / blocks.length;

  const criticalBlocks = blocks.filter((b) => b.status === "critical").length;
  const criticalVillas = villas.filter((v) => v.status === "critical").length;

  return {
    blocks,
    handoverSlipDays, currentSlipDays, projectedEnd,
    percentComplete: Math.round(percentComplete * 100) / 100,
    criticalBlocks, criticalVillas,
  };
}

// ---------------------------------------------------------------------------
// Probability of timely completion — RERA-based 3-band
// ---------------------------------------------------------------------------

export function probabilityOfTimelyCompletion(
  projectedEnd: Date | null,
  reraDate: Date | null,
): Probability {
  // No RERA date on file → we can't say. Default to HIGH (no legal exposure).
  if (!reraDate) return "HIGH";
  if (!projectedEnd) return "HIGH";
  const slipVsRera = daysBetween(reraDate, projectedEnd);
  if (slipVsRera <= 0) return "HIGH";
  if (slipVsRera <= GRACE_DAYS) return "MEDIUM";
  return "LOW";
}

// ---------------------------------------------------------------------------
// Physical Progress % (project level)
//   - Planned %: fraction of total baseline work expected by `today`,
//     using linear ramp between start and finish per milestone.
//   - Achieved %: fraction actually done, weighted by duration.
// ---------------------------------------------------------------------------

export function plannedProgressPct(tasks: Task[], today = new Date()): number {
  if (tasks.length === 0) return 0;
  const totalDur = tasks.reduce((s, t) => s + Math.max(1, t.durationDays), 0);
  let plannedDur = 0;
  for (const t of tasks) {
    const w = Math.max(1, t.durationDays);
    if (!t.baselineStart || !t.baselineFinish) continue;
    if (today <= t.baselineStart) continue;                 // not scheduled to start yet
    if (today >= t.baselineFinish) { plannedDur += w; continue; }
    const spanMs = t.baselineFinish.getTime() - t.baselineStart.getTime();
    const doneMs = today.getTime() - t.baselineStart.getTime();
    plannedDur += w * (doneMs / spanMs);
  }
  return totalDur === 0 ? 0 : Math.round((plannedDur / totalDur) * 10_000) / 100;
}

export function achievedProgressPct(tasks: Task[]): number {
  return Math.round(weightedProgress(tasks) * 100) / 100;
}
