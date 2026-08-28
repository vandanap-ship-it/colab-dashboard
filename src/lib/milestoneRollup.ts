// Runtime rollup: sync a VillaMilestone from its child WBSNodes.
//
// Called after any progress POST/PATCH that stamps a WBSNode's
// percentComplete / actualStart / actualFinish. Without this, VillaMilestone
// rows only get updated by the MSP import — so the Dashboard's
// Milestone Progress table, Block-wise Progress and Weekly report
// Milestone Plan all read stale data at runtime.
//
// Rule (per Amanvana RUNBOOK section 3, point 3 — the Colab convention):
//   Stage dates are built from **all activities up to the stage's END-marker
//   (★)**, NEVER from the END-marker row's own date — the END-marker's date
//   is unreliable in MSP schedules because it's often a nominal same-day
//   marker rather than a real workday. So we ALWAYS aggregate across all
//   children (the ★ is included in the aggregate like any other child):
//     * pctComplete = duration-weighted avg of children
//     * actualStart = earliest of children with an actualStart
//     * actualFinish = latest of children ONLY IF every baselined child also
//       has an actualFinish (otherwise null)
//   The ★ flag on children stays useful for UI badges + other reports; it
//   just doesn't drive the milestone's date calc anymore.
//
// Idempotent — safe to call repeatedly; skips update when nothing changed.

// Minimal client shape the sync needs — decouples us from Prisma.TransactionClient
// which doesn't match the extended-with-adapter client type. Works with both the
// base client and any transaction handle.
export interface RollupTx {
  wBSNode: {
    findMany: (args: {
      where: { villaMilestoneId: string };
      select: {
        id: true;
        isSubMilestone: true;
        percentComplete: true;
        actualStart: true;
        actualFinish: true;
        baselineStart: true;
        baselineFinish: true;
      };
    }) => Promise<WbsChild[]>;
  };
  villaMilestone: {
    findUnique: (args: {
      where: { id: string };
      select: {
        pctComplete: true;
        actualStart: true;
        actualFinish: true;
        projectedFinish: true;
        baselineFinish: true;
      };
    }) => Promise<{
      pctComplete: number | null;
      actualStart: Date | null;
      actualFinish: Date | null;
      projectedFinish: Date | null;
      baselineFinish: Date | null;
    } | null>;
    update: (args: {
      where: { id: string };
      data: {
        pctComplete: number;
        actualStart: Date | null;
        actualFinish: Date | null;
        projectedFinish: Date | null;
      };
    }) => Promise<unknown>;
  };
}

type Tx = RollupTx;

export interface WbsChild {
  id: string;
  isSubMilestone: boolean;
  percentComplete: number | null;
  actualStart: Date | null;
  actualFinish: Date | null;
  baselineStart: Date | null;
  baselineFinish: Date | null;
}

/**
 * Recompute a single VillaMilestone from its WBS children. Pass a Prisma tx
 * to run inside a transaction; pass the base client to run standalone.
 * Returns the new state (or null when the milestone was not found).
 */
export async function syncVillaMilestoneFromChildren(
  tx: Tx,
  villaMilestoneId: string,
): Promise<{ pctComplete: number; actualStart: Date | null; actualFinish: Date | null } | null> {
  const children = await tx.wBSNode.findMany({
    where: { villaMilestoneId },
    select: {
      id: true,
      isSubMilestone: true,
      percentComplete: true,
      actualStart: true,
      actualFinish: true,
      baselineStart: true,
      baselineFinish: true,
    },
  });
  if (children.length === 0) return null;

  const rolled = aggregateChildren(children);

  // Only write when something actually changed — avoids audit noise and
  // needless index writes.
  const current = await tx.villaMilestone.findUnique({
    where: { id: villaMilestoneId },
    select: { pctComplete: true, actualStart: true, actualFinish: true, projectedFinish: true, baselineFinish: true },
  });
  if (!current) return null;

  const currentPct = Math.round((current.pctComplete ?? 0) * 100) / 100;
  const nextPct = Math.round(rolled.pctComplete * 100) / 100;
  const startChanged = dateEquals(current.actualStart, rolled.actualStart) === false;
  const finishChanged = dateEquals(current.actualFinish, rolled.actualFinish) === false;
  const pctChanged = currentPct !== nextPct;
  if (!startChanged && !finishChanged && !pctChanged) {
    return { pctComplete: currentPct, actualStart: current.actualStart, actualFinish: current.actualFinish };
  }

  // If actualFinish just got set, also pin projectedFinish to it (we now know
  // exactly when the milestone closed — no more projection).
  const projectedFinish = rolled.actualFinish ?? current.projectedFinish ?? current.baselineFinish;

  await tx.villaMilestone.update({
    where: { id: villaMilestoneId },
    data: {
      pctComplete: rolled.pctComplete,
      actualStart: rolled.actualStart,
      actualFinish: rolled.actualFinish,
      projectedFinish,
    },
  });

  return { pctComplete: rolled.pctComplete, actualStart: rolled.actualStart, actualFinish: rolled.actualFinish };
}

/** Duration-weighted aggregate across all children (including the ★ END-marker).
 *  Kept exported for its unit tests + for other callers that need the pure math.
 *
 *  Closure rule (RUNBOOK + Colab behaviour):
 *    - pctComplete = duration-weighted avg of all children (RUNBOOK point 3)
 *    - actualStart = earliest actualStart across children
 *    - actualFinish = the ★ END-marker's actualFinish IF the ★ has one;
 *      otherwise NULL — a milestone doesn't close until the END-marker
 *      concreting step is done, even if surrounding activities are done.
 *      This matches how Colab keeps "Foundation" as a villa's current
 *      stage until the "Footing RCC — Concreting ★" row is signed off.
 *      Fall back to "all baselined children done" only when no ★ exists
 *      under the milestone (some sections lack a star gate). */
export function aggregateChildren(children: WbsChild[]): { pctComplete: number; actualStart: Date | null; actualFinish: Date | null } {
  // pctComplete: duration-weighted avg. Missing durations default to 1 day
  // so unset baselines don't crash the ratio.
  let weightedPctSum = 0;
  let totalWeight = 0;
  for (const c of children) {
    const durMs = c.baselineStart && c.baselineFinish
      ? Math.max(1, c.baselineFinish.getTime() - c.baselineStart.getTime())
      : 86400000; // 1 day fallback
    const days = durMs / 86400000;
    const pct = Math.max(0, Math.min(100, c.percentComplete ?? (c.actualFinish ? 100 : 0)));
    weightedPctSum += pct * days;
    totalWeight += days;
  }
  const pctComplete = totalWeight > 0 ? weightedPctSum / totalWeight : 0;

  // actualStart: earliest of any child that started.
  let earliestStart: Date | null = null;
  for (const c of children) {
    if (c.actualStart && (!earliestStart || c.actualStart < earliestStart)) {
      earliestStart = c.actualStart;
    }
  }

  // actualFinish: driven by the ★ END-marker's own closure. If a star
  // exists, the milestone closes exactly when the star closes. If no
  // star exists (some sections don't have a gate), fall back to
  // "all baselined children done".
  const stars = children.filter((c) => c.isSubMilestone);
  let latestFinish: Date | null = null;
  if (stars.length > 0) {
    // If any star is still open, milestone stays open; otherwise take
    // the latest star finish as the milestone's finish.
    const allStarsClosed = stars.every((s) => s.actualFinish !== null);
    if (allStarsClosed) {
      for (const s of stars) {
        if (s.actualFinish && (!latestFinish || s.actualFinish > latestFinish)) {
          latestFinish = s.actualFinish;
        }
      }
    }
  } else {
    const baselined = children.filter((c) => c.baselineFinish !== null);
    const allDone = baselined.length > 0 && baselined.every((c) => c.actualFinish !== null);
    if (allDone) {
      for (const c of baselined) {
        if (c.actualFinish && (!latestFinish || c.actualFinish > latestFinish)) {
          latestFinish = c.actualFinish;
        }
      }
    }
  }

  return { pctComplete, actualStart: earliestStart, actualFinish: latestFinish };
}

function dateEquals(a: Date | null, b: Date | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.getTime() === b.getTime();
}
