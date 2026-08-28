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
  actualStart: Date | null;
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
 *
 * Colab's caption on the coverage panel: "villa in its window, or overdue".
 * Empirically Colab counts a villa on the report date if ANY of these holds:
 *   1. Its current stage's baseline window covers today (in-window)
 *   2. Its current stage's baselineFinish < today (overdue-still-open)
 *   3. It has ANY started-and-open milestone (actualStart set, actualFinish
 *      null) — villa is actively under construction even if the current
 *      stage's baseline is in the future
 *   4. It has ANY overdue milestone anywhere (baselineFinish < today AND
 *      not closed) — spilled-over work still to catch up
 *
 * The looser (3) + (4) branches close the gap with Colab's Aug 25 numbers,
 * which count every villa Abraham has active work on regardless of whether
 * today falls exactly in the current stage's planned window.
 */
export function isVillaPlannedToday(
  milestones: VillaMilestoneForStage[],
  today: Date,
): boolean {
  const t = today.getTime();
  const currentId = currentStageMilestoneId(milestones);
  if (currentId) {
    const current = milestones.find((m) => m.id === currentId);
    if (current?.baselineStart && current?.baselineFinish) {
      const s = current.baselineStart.getTime();
      const f = current.baselineFinish.getTime();
      if (t >= s && t <= f) return true;   // (1) in-window
      if (t > f) return true;              // (2) overdue-still-open
    }
  }
  // (3) any actively-under-construction milestone
  for (const m of milestones) {
    if (m.actualStart && m.actualFinish == null) return true;
  }
  // (4) any overdue still-open milestone anywhere
  for (const m of milestones) {
    if (m.actualFinish == null && m.baselineFinish && m.baselineFinish.getTime() < t) return true;
  }
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
