// "Current stage per villa" logic — Colab's core convention for what
// counts as "planned today" and what a villa's active milestone is.
//
// The RUNBOOK convention (matches Colab's PDF output):
//   Each villa has ONE current construction stage at any moment. That
//   stage is the FIRST (by orderIndex) VillaMilestone that isn't closed
//   (actualFinish is null). A villa is "planned today" if today is
//   inside its current stage's baseline window, OR if the current stage
//   is overdue and still open.
//
// This differs from a per-milestone "any milestone straddles today"
// query, which over-counts (every villa with any in-window milestone
// counts) or under-counts (villas whose current stage is between
// scheduled windows drop off).
//
// Pure functions here so scorecardServer.ts can compose them into
// its planned-today queries without additional round-trips.

/** Minimal shape needed to determine a villa's current stage. */
export interface VillaMilestoneForStage {
  id: string;
  villaId: string;
  sectionOrderIndex: number;
  baselineStart: Date | null;
  baselineFinish: Date | null;
  actualFinish: Date | null;
}

/**
 * Given a villa's full milestone list, return the ID of the current
 * stage's milestone — first (by orderIndex) with actualFinish == null.
 * Returns null when every milestone is closed (villa is done).
 */
export function currentStageMilestoneId(
  milestones: VillaMilestoneForStage[],
): string | null {
  const sorted = [...milestones].sort(
    (a, b) => a.sectionOrderIndex - b.sectionOrderIndex,
  );
  for (const m of sorted) {
    if (m.actualFinish == null) return m.id;
  }
  return null;
}

/**
 * Is this villa "planned today" per Colab's rule?
 *   - Villa's current stage exists
 *   - Today falls inside current stage's baseline window, OR
 *   - Current stage is overdue-still-open (baselineFinish < today,
 *     actualFinish null — implicit from currentStageMilestoneId).
 */
export function isVillaPlannedToday(
  milestones: VillaMilestoneForStage[],
  today: Date,
): boolean {
  const currentId = currentStageMilestoneId(milestones);
  if (!currentId) return false;
  const current = milestones.find((m) => m.id === currentId);
  if (!current) return false;
  if (!current.baselineStart || !current.baselineFinish) return false;
  const t = today.getTime();
  const s = current.baselineStart.getTime();
  const f = current.baselineFinish.getTime();
  if (t >= s && t <= f) return true;   // in-window
  if (t > f) return true;              // overdue-still-open (currentStage already implies not-closed)
  return false;
}

/**
 * Group villa milestones by villaId → give each villa its current-stage
 * milestone (or null if villa is fully closed).
 */
export function currentStageByVilla(
  milestones: VillaMilestoneForStage[],
): Map<string, VillaMilestoneForStage | null> {
  const byVilla = new Map<string, VillaMilestoneForStage[]>();
  for (const m of milestones) {
    const arr = byVilla.get(m.villaId) ?? [];
    arr.push(m);
    byVilla.set(m.villaId, arr);
  }
  const out = new Map<string, VillaMilestoneForStage | null>();
  for (const [villaId, arr] of byVilla) {
    const currentId = currentStageMilestoneId(arr);
    out.set(villaId, currentId ? arr.find((m) => m.id === currentId) ?? null : null);
  }
  return out;
}
