import { describe, it, expect } from "vitest";
import {
  daysBetween,
  slipDaysFor,
  bestFinishFor,
  weightedProgress,
  bucketForSlip,
  rollupMilestone,
  rollupVilla,
  rollupBlock,
  rollupProject,
  probabilityOfTimelyCompletion,
  plannedProgressPct,
  achievedProgressPct,
  GRACE_DAYS,
  type Task,
} from "@/lib/rollup";

const d = (iso: string) => new Date(iso + "T00:00:00Z");

/** Builder for a task with sensible defaults. */
function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t",
    isSubMilestone: false,
    baselineStart: d("2026-01-01"),
    baselineFinish: d("2026-01-10"),
    actualStart: null,
    actualFinish: null,
    projectedFinish: null,
    percentComplete: 0,
    durationDays: 10,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

describe("daysBetween", () => {
  it("returns 0 for the same day", () => {
    expect(daysBetween(d("2026-01-01"), d("2026-01-01"))).toBe(0);
  });
  it("counts forward days as positive", () => {
    expect(daysBetween(d("2026-01-01"), d("2026-01-11"))).toBe(10);
  });
  it("counts backward days as negative", () => {
    expect(daysBetween(d("2026-01-11"), d("2026-01-01"))).toBe(-10);
  });
});

describe("slipDaysFor", () => {
  const baseline = d("2026-01-10");

  it("returns 0 when there is no baseline", () => {
    expect(slipDaysFor(null, d("2026-01-15"), null)).toBe(0);
  });
  it("returns 0 when nothing has finished (no actual, no projected)", () => {
    expect(slipDaysFor(baseline, null, null)).toBe(0);
  });
  it("uses actual finish over projected when both are set", () => {
    // actual = +5 days, projected = +30 days → slip should be 5, not 30
    expect(slipDaysFor(baseline, d("2026-01-15"), d("2026-02-09"))).toBe(5);
  });
  it("falls back to projected when actual is missing", () => {
    expect(slipDaysFor(baseline, null, d("2026-01-25"))).toBe(15);
  });
  it("clamps early finishes to 0 (no negative slip)", () => {
    expect(slipDaysFor(baseline, d("2026-01-05"), null)).toBe(0);
  });
});

describe("bestFinishFor", () => {
  it("prefers actual > projected > baseline", () => {
    expect(bestFinishFor(d("2026-01-01"), d("2026-01-05"), d("2026-01-10"))).toEqual(d("2026-01-05"));
    expect(bestFinishFor(d("2026-01-01"), null, d("2026-01-10"))).toEqual(d("2026-01-10"));
    expect(bestFinishFor(d("2026-01-01"), null, null)).toEqual(d("2026-01-01"));
    expect(bestFinishFor(null, null, null)).toBe(null);
  });
});

describe("weightedProgress", () => {
  it("returns 0 for empty input", () => {
    expect(weightedProgress([])).toBe(0);
  });
  it("returns the sole item's percent when only one", () => {
    expect(weightedProgress([{ percentComplete: 50, durationDays: 5 }])).toBe(50);
  });
  it("weights by duration", () => {
    // 1-day task at 100% + 9-day task at 0% → 10% (not 50%)
    const result = weightedProgress([
      { percentComplete: 100, durationDays: 1 },
      { percentComplete: 0, durationDays: 9 },
    ]);
    expect(result).toBe(10);
  });
  it("treats zero duration as duration=1 (avoids divide-by-zero)", () => {
    const result = weightedProgress([
      { percentComplete: 100, durationDays: 0 },
      { percentComplete: 0, durationDays: 0 },
    ]);
    expect(result).toBe(50);
  });
});

describe("bucketForSlip", () => {
  it("returns not-started when hasStarted is false", () => {
    expect(bucketForSlip(0, false)).toBe("not-started");
    expect(bucketForSlip(50, false)).toBe("not-started");
  });
  it("returns healthy at 0 slip", () => {
    expect(bucketForSlip(0, true)).toBe("healthy");
  });
  it("returns warning between 1 and 30 days", () => {
    expect(bucketForSlip(1, true)).toBe("warning");
    expect(bucketForSlip(15, true)).toBe("warning");
    expect(bucketForSlip(30, true)).toBe("warning");
  });
  it("returns critical above 30 days", () => {
    expect(bucketForSlip(31, true)).toBe("critical");
    expect(bucketForSlip(90, true)).toBe("critical");
  });
});

// ---------------------------------------------------------------------------
// Milestone-level rollup
// ---------------------------------------------------------------------------

describe("rollupMilestone", () => {
  it("returns not-started skeleton for an empty milestone", () => {
    const m = rollupMilestone("Foundation", 0, []);
    expect(m.percentComplete).toBe(0);
    expect(m.status).toBe("not-started");
    expect(m.delayDays).toBe(0);
    expect(m.actualFinish).toBe(null);
  });

  it("takes earliest baseline start and latest baseline finish across tasks", () => {
    const m = rollupMilestone("Foundation", 0, [
      task({ baselineStart: d("2026-01-05"), baselineFinish: d("2026-01-15") }),
      task({ baselineStart: d("2026-01-01"), baselineFinish: d("2026-01-20") }),
      task({ baselineStart: d("2026-01-10"), baselineFinish: d("2026-01-12") }),
    ]);
    expect(m.baselineStart).toEqual(d("2026-01-01"));
    expect(m.baselineFinish).toEqual(d("2026-01-20"));
  });

  it("only marks actualFinish when EVERY task is 100%", () => {
    const partial = rollupMilestone("F", 0, [
      task({ percentComplete: 100, actualFinish: d("2026-01-05") }),
      task({ percentComplete: 50 }),
    ]);
    expect(partial.actualFinish).toBe(null);

    const full = rollupMilestone("F", 0, [
      task({ percentComplete: 100, actualFinish: d("2026-01-05") }),
      task({ percentComplete: 100, actualFinish: d("2026-01-08") }),
    ]);
    expect(full.actualFinish).toEqual(d("2026-01-08")); // latest wins
  });

  it("marks 'healthy' when all tasks are done on time", () => {
    const m = rollupMilestone("F", 0, [
      task({ percentComplete: 100, actualStart: d("2025-12-25"), actualFinish: d("2026-01-05"), baselineFinish: d("2026-01-10") }),
    ]);
    expect(m.status).toBe("healthy");
    expect(m.delayDays).toBe(0);
  });

  it("computes delay from projected finish while tasks are still in flight", () => {
    const m = rollupMilestone("F", 0, [
      task({
        percentComplete: 50,
        actualStart: d("2026-01-01"),
        baselineFinish: d("2026-01-10"),
        projectedFinish: d("2026-01-25"), // 15 days late
      }),
    ]);
    expect(m.delayDays).toBe(15);
    expect(m.status).toBe("warning");
  });
});

// ---------------------------------------------------------------------------
// Villa-level rollup
// ---------------------------------------------------------------------------

describe("rollupVilla — current + handover slip", () => {
  const foundationDone = rollupMilestone("Foundation", 0, [
    task({ percentComplete: 100, actualStart: d("2026-01-01"), actualFinish: d("2026-01-08"), baselineFinish: d("2026-01-10") }),
  ]);
  const plinthInFlight = rollupMilestone("Plinth", 1, [
    task({ percentComplete: 40, actualStart: d("2026-01-15"), baselineFinish: d("2026-01-25"), projectedFinish: d("2026-02-10") }),  // 16d slip
  ]);
  const gfStructureNotStarted = rollupMilestone("Ground Floor Structure", 2, [
    task({ baselineFinish: d("2026-03-01") }),
  ]);
  const handoverNotStarted = rollupMilestone("Handover", 3, [
    task({ baselineFinish: d("2027-12-31"), projectedFinish: d("2028-01-30") }), // 30d slip
  ]);

  it("current slip = in-flight milestone's slip", () => {
    const v = rollupVilla(12, "4", [foundationDone, plinthInFlight, gfStructureNotStarted, handoverNotStarted]);
    expect(v.currentSection).toBe(1); // Plinth is in-flight
    expect(v.currentSlipDays).toBe(16);
  });

  it("handover slip = last milestone's slip (independent from current)", () => {
    const v = rollupVilla(12, "4", [foundationDone, plinthInFlight, gfStructureNotStarted, handoverNotStarted]);
    expect(v.handoverSlipDays).toBe(30);
    expect(v.handoverProjected).toEqual(d("2028-01-30"));
  });

  it("villa status bucket uses HANDOVER slip (matches product owner spec)", () => {
    const v = rollupVilla(12, "4", [foundationDone, plinthInFlight, gfStructureNotStarted, handoverNotStarted]);
    // handover slip = 30 → still 'warning' (≤ 30)
    expect(v.status).toBe("warning");
  });

  it("villa not-started when nothing has actualStart", () => {
    const notStarted = rollupMilestone("F", 0, [task({ baselineFinish: d("2027-01-01") })]);
    const handoverFuture = rollupMilestone("H", 1, [task({ baselineFinish: d("2029-01-01") })]);
    const v = rollupVilla(1, "1", [notStarted, handoverFuture]);
    expect(v.status).toBe("not-started");
    expect(v.currentSection).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// Block + Project rollup
// ---------------------------------------------------------------------------

describe("rollupBlock", () => {
  it("takes max villa slip (worst villa drives the block)", () => {
    const villaOK = rollupVilla(1, "4", [
      rollupMilestone("F", 0, [task({ percentComplete: 100, actualStart: d("2026-01-01"), actualFinish: d("2026-01-08"), baselineFinish: d("2026-01-10") })]),
      rollupMilestone("H", 1, [task({ baselineFinish: d("2027-01-01") })]),
    ]);
    const villaBad = rollupVilla(2, "4", [
      rollupMilestone("F", 0, [task({ percentComplete: 100, actualStart: d("2026-01-01"), actualFinish: d("2026-02-15"), baselineFinish: d("2026-01-10") })]),
      rollupMilestone("H", 1, [task({ baselineFinish: d("2027-01-01"), projectedFinish: d("2027-03-05") })]), // 63d
    ]);
    const b = rollupBlock("4", [villaOK, villaBad]);
    expect(b.handoverSlipDays).toBe(63);
    expect(b.status).toBe("critical"); // 63 > 30
  });

  it("returns not-started shell for empty block", () => {
    const b = rollupBlock("X", []);
    expect(b.status).toBe("not-started");
    expect(b.percentComplete).toBe(0);
  });
});

describe("rollupProject", () => {
  it("takes max block slip and counts critical blocks/villas", () => {
    const villa = (slip: number) =>
      rollupVilla(slip, "b", [
        rollupMilestone("F", 0, [task({ percentComplete: 100, actualStart: d("2026-01-01"), actualFinish: d("2026-01-10"), baselineFinish: d("2026-01-10") })]),
        rollupMilestone("H", 1, [task({ baselineFinish: d("2027-01-01"), projectedFinish: new Date(d("2027-01-01").getTime() + slip * 86_400_000) })]),
      ]);
    const b1 = rollupBlock("1", [villa(5), villa(50)]);   // block 1 has critical villa
    const b2 = rollupBlock("2", [villa(0), villa(0)]);    // block 2 healthy
    const p = rollupProject([b1, b2]);
    expect(p.handoverSlipDays).toBe(50);
    expect(p.criticalBlocks).toBe(1);
    expect(p.criticalVillas).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Probability of timely completion (RERA-based, 3-band)
// ---------------------------------------------------------------------------

describe("probabilityOfTimelyCompletion", () => {
  const rera = d("2028-03-01");

  it("HIGH when projected on or before RERA date", () => {
    expect(probabilityOfTimelyCompletion(d("2028-02-28"), rera)).toBe("HIGH");
    expect(probabilityOfTimelyCompletion(d("2028-03-01"), rera)).toBe("HIGH");
    expect(probabilityOfTimelyCompletion(d("2027-01-01"), rera)).toBe("HIGH");
  });

  it("MEDIUM within grace-days window past RERA", () => {
    const withinGrace = new Date(rera.getTime() + (GRACE_DAYS - 1) * 86_400_000);
    expect(probabilityOfTimelyCompletion(withinGrace, rera)).toBe("MEDIUM");
    const atGrace = new Date(rera.getTime() + GRACE_DAYS * 86_400_000);
    expect(probabilityOfTimelyCompletion(atGrace, rera)).toBe("MEDIUM");
  });

  it("LOW beyond grace window", () => {
    const past = new Date(rera.getTime() + (GRACE_DAYS + 1) * 86_400_000);
    expect(probabilityOfTimelyCompletion(past, rera)).toBe("LOW");
  });

  it("HIGH when no RERA date on file (no legal exposure to compute against)", () => {
    expect(probabilityOfTimelyCompletion(d("2030-01-01"), null)).toBe("HIGH");
  });

  it("HIGH when projected end unknown", () => {
    expect(probabilityOfTimelyCompletion(null, rera)).toBe("HIGH");
  });
});

// ---------------------------------------------------------------------------
// Progress percentages (physical progress cards)
// ---------------------------------------------------------------------------

describe("plannedProgressPct", () => {
  it("returns 0 with no tasks", () => {
    expect(plannedProgressPct([], d("2026-06-01"))).toBe(0);
  });

  it("returns 0 when nothing has been scheduled to start yet", () => {
    const tasks = [task({ baselineStart: d("2027-01-01"), baselineFinish: d("2027-02-01"), durationDays: 30 })];
    expect(plannedProgressPct(tasks, d("2026-06-01"))).toBe(0);
  });

  it("returns 100 when the schedule has fully elapsed", () => {
    const tasks = [task({ baselineStart: d("2026-01-01"), baselineFinish: d("2026-02-01"), durationDays: 30 })];
    expect(plannedProgressPct(tasks, d("2026-06-01"))).toBe(100);
  });

  it("linear-ramps between baseline start and finish", () => {
    const tasks = [task({ baselineStart: d("2026-01-01"), baselineFinish: d("2026-01-11"), durationDays: 10 })];
    // 5 days into 10-day window → 50%
    expect(plannedProgressPct(tasks, d("2026-01-06"))).toBeCloseTo(50, 0);
  });

  it("weights by duration across multiple tasks", () => {
    const tasks = [
      // 1-day task, fully elapsed
      task({ baselineStart: d("2026-01-01"), baselineFinish: d("2026-01-02"), durationDays: 1 }),
      // 99-day task, not started
      task({ baselineStart: d("2027-01-01"), baselineFinish: d("2027-04-10"), durationDays: 99 }),
    ];
    // Duration-weighted: 1 out of 100 units done → 1%
    expect(plannedProgressPct(tasks, d("2026-06-01"))).toBeCloseTo(1, 0);
  });
});

describe("achievedProgressPct", () => {
  it("returns 0 with no tasks", () => {
    expect(achievedProgressPct([])).toBe(0);
  });

  it("returns duration-weighted mean of percentComplete", () => {
    const tasks = [
      task({ percentComplete: 100, durationDays: 1 }),
      task({ percentComplete: 0, durationDays: 9 }),
    ];
    // 1-day at 100 + 9-day at 0 = (100*1 + 0*9)/10 = 10
    expect(achievedProgressPct(tasks)).toBe(10);
  });
});
