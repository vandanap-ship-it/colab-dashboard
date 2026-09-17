import { describe, it, expect } from "vitest";
import {
  contractorZoneRollup,
  diffDays,
  weightedOverallProgress,
  type LeafRow,
} from "@/lib/masterReportMath";

/**
 * Golden tests for the two master-report formulas that drive the Weekly
 * Progress Report the team ships to management.
 *
 * These are the numbers that broke on Amanvana this morning: overall progress
 * read 89.5% instead of 1.5% (weighted vs tracked-only denominator), and §02
 * Project Health by Zone collapsed onto a single "Villa Set (V32, V33)" row
 * instead of Abraham + Elegant. The fixes shipped today; the tests here lock
 * those fixes in place.
 */

const d = (iso: string) => new Date(iso + "T00:00:00Z");

/** Shorthand builder with sensible defaults so tests read as data, not setup. */
function leaf(overrides: Partial<LeafRow> = {}): LeafRow {
  return {
    baselineStart: d("2026-01-01"),
    baselineFinish: d("2026-01-11"), // 10 days
    actualStart: null,
    actualFinish: null,
    projectedFinish: null,
    percentComplete: 0,
    weightPct: null,
    ...overrides,
  };
}

describe("diffDays", () => {
  it("returns positive when a is after b", () => {
    expect(diffDays(d("2026-01-10"), d("2026-01-03"))).toBe(7);
  });
  it("returns negative when a is before b", () => {
    expect(diffDays(d("2026-01-03"), d("2026-01-10"))).toBe(-7);
  });
  it("returns 0 when a === b", () => {
    expect(diffDays(d("2026-01-10"), d("2026-01-10"))).toBe(0);
  });
  it("returns null when either bound is missing", () => {
    expect(diffDays(null, d("2026-01-10"))).toBeNull();
    expect(diffDays(d("2026-01-10"), null)).toBeNull();
    expect(diffDays(null, null)).toBeNull();
  });
});

describe("weightedOverallProgress", () => {
  const today = d("2026-01-06"); // midpoint of a leaf running Jan 1 → Jan 11

  it("returns zeros when there are no leaves", () => {
    expect(weightedOverallProgress([], today)).toEqual({ planned: 0, achieved: 0 });
  });

  it("weighted path — planned% is time-weighted, achieved% is weight-weighted", () => {
    // Two weighted leaves. Same 10-day window; today halfway through.
    // Leaf A weight 60, at 40% complete.
    // Leaf B weight 40, at 10% complete.
    const leaves = [
      leaf({ weightPct: 60, percentComplete: 40 }),
      leaf({ weightPct: 40, percentComplete: 10 }),
    ];
    const { planned, achieved } = weightedOverallProgress(leaves, today);
    // planned = (60 * 50 + 40 * 50) / 100 = 50 — both leaves are at half
    // their window, weighted by weightPct.
    expect(planned).toBeCloseTo(50, 6);
    // achieved = (60 * 40 + 40 * 10) / 100 = 24 + 4 = 28
    expect(achieved).toBeCloseTo(28, 6);
  });

  it("weighted path — unweighted leaves are IGNORED (Colab semantics)", () => {
    // Colab's Physical_Progress column tags only the leaves that carry the
    // physical weight of the project. Structural rollup nodes have no
    // weight — including them in the average would deflate the topline.
    const leaves = [
      leaf({ weightPct: 100, percentComplete: 50 }),
      leaf({ weightPct: null, percentComplete: 99 }), // structural rollup
      leaf({ weightPct: null, percentComplete: 99 }),
    ];
    const { planned, achieved } = weightedOverallProgress(leaves, today);
    expect(achieved).toBeCloseTo(50, 6); // only the weighted leaf counts
    expect(planned).toBeCloseTo(50, 6);
  });

  it("equal-weighted fallback fires when NO leaf has a weight", () => {
    // MSP-imported schedules land here — per-activity weight not yet
    // assigned. Fall back to arithmetic mean across every leaf.
    const leaves = [
      leaf({ percentComplete: 40 }),
      leaf({ percentComplete: 10 }),
      leaf({ percentComplete: 0 }),
    ];
    const { planned, achieved } = weightedOverallProgress(leaves, today);
    expect(achieved).toBeCloseTo((40 + 10 + 0) / 3, 6);
    // Each leaf is at 50% of its window at today = midpoint.
    expect(planned).toBeCloseTo(50, 6);
  });

  it("regression · doesn't reproduce the pre-fix 89.5% bug on a schedule with 200 tracked / 15,000 total", () => {
    // The pre-fix code averaged over "tracked leaves only" (~230 out of
    // ~15,000 for Amanvana), so a handful of near-complete tracked
    // activities dominated the topline. Reproduce that shape: 15 leaves
    // total, only 3 are meaningfully "tracked" at 90%. Correct overall
    // planned/achieved must NOT be dominated by the tracked subset.
    const leaves = [
      leaf({ percentComplete: 90 }),
      leaf({ percentComplete: 90 }),
      leaf({ percentComplete: 90 }),
      ...Array.from({ length: 12 }, () => leaf({ percentComplete: 0 })),
    ];
    const { achieved } = weightedOverallProgress(leaves, today);
    // Correct achieved% ≈ (90 * 3) / 15 = 18. Pre-fix would have been
    // 90% (only counting the tracked 3). Test asserts we're in the low
    // teens, not the 80s.
    expect(achieved).toBeLessThan(25);
    expect(achieved).toBeGreaterThan(15);
  });
});

describe("contractorZoneRollup", () => {
  it("empty input returns zeroed-out shape", () => {
    const r = contractorZoneRollup([]);
    expect(r.plannedStart).toBeNull();
    expect(r.plannedFinish).toBeNull();
    expect(r.actualStart).toBeNull();
    expect(r.projectedFinish).toBeNull();
    expect(r.actualPercent).toBe(0);
    expect(r.totalDelayDays).toBe(0);
  });

  it("plannedStart = earliest baselineStart, plannedFinish = latest baselineFinish", () => {
    const leaves = [
      leaf({ baselineStart: d("2026-01-01"), baselineFinish: d("2026-02-01") }),
      leaf({ baselineStart: d("2025-12-15"), baselineFinish: d("2026-01-20") }), // earliest start
      leaf({ baselineStart: d("2026-01-05"), baselineFinish: d("2026-02-15") }), // latest finish
    ];
    const r = contractorZoneRollup(leaves);
    expect(r.plannedStart?.toISOString().slice(0, 10)).toBe("2025-12-15");
    expect(r.plannedFinish?.toISOString().slice(0, 10)).toBe("2026-02-15");
  });

  it("projectedFinish falls through the priority chain: actualFinish → projectedFinish → baselineFinish", () => {
    const leaves = [
      // Complete leaf — use actualFinish
      leaf({
        baselineFinish: d("2026-01-11"),
        actualFinish: d("2026-01-15"),
        projectedFinish: d("2026-01-20"), // ignored because actualFinish set
      }),
      // In-progress leaf — use projectedFinish
      leaf({
        baselineFinish: d("2026-02-01"),
        projectedFinish: d("2026-02-10"),
      }),
      // Not-started leaf — use baselineFinish
      leaf({
        baselineFinish: d("2026-03-01"),
      }),
    ];
    const r = contractorZoneRollup(leaves);
    // Latest across the three: baselineFinish 2026-03-01 wins.
    expect(r.projectedFinish?.toISOString().slice(0, 10)).toBe("2026-03-01");
  });

  it("totalDelayDays is signed: positive = late, negative = ahead", () => {
    // Planned finish 2026-02-01; projected finish 2026-02-08 (7 days late).
    const late = [
      leaf({ baselineFinish: d("2026-02-01"), projectedFinish: d("2026-02-08") }),
    ];
    expect(contractorZoneRollup(late).totalDelayDays).toBe(7);

    // Planned finish 2026-02-01; actualFinish 2026-01-25 (7 days ahead).
    const ahead = [
      leaf({
        baselineFinish: d("2026-02-01"),
        actualFinish: d("2026-01-25"),
      }),
    ];
    expect(contractorZoneRollup(ahead).totalDelayDays).toBe(-7);
  });

  it("actualPercent is the arithmetic mean and rounds to 2 decimals", () => {
    const leaves = [
      leaf({ percentComplete: 33.333 }),
      leaf({ percentComplete: 66.667 }),
    ];
    expect(contractorZoneRollup(leaves).actualPercent).toBe(50);
  });

  it("regression · Amanvana's Abraham + Elegant zones surface distinct dates", () => {
    // Sanity-check against the shape today's fix produces on prod. Abraham
    // and Elegant have different planned windows; the rollup must keep them
    // distinguished when called with each contractor's slice.
    const abrahamLeaves = [
      leaf({ baselineStart: d("2026-04-02"), baselineFinish: d("2028-12-07"), percentComplete: 4.5 }),
    ];
    const elegantLeaves = [
      leaf({ baselineStart: d("2026-08-17"), baselineFinish: d("2029-03-20"), percentComplete: 1.1 }),
    ];
    const abraham = contractorZoneRollup(abrahamLeaves);
    const elegant = contractorZoneRollup(elegantLeaves);
    expect(abraham.plannedStart?.toISOString().slice(0, 10)).toBe("2026-04-02");
    expect(abraham.plannedFinish?.toISOString().slice(0, 10)).toBe("2028-12-07");
    expect(elegant.plannedStart?.toISOString().slice(0, 10)).toBe("2026-08-17");
    expect(elegant.plannedFinish?.toISOString().slice(0, 10)).toBe("2029-03-20");
    expect(abraham.actualPercent).toBeCloseTo(4.5, 2);
    expect(elegant.actualPercent).toBeCloseTo(1.1, 2);
  });
});
