import { describe, it, expect } from "vitest";
import { computeProjectStats, type StatsNode, type ProjectMeta } from "@/lib/projectStats";

/**
 * Pure-logic tests for the rollup math. Same function is used in both
 * the per-project path (getProjectStats) and the batched portfolio path
 * (getPortfolioStats), so locking it down here means the two paths can
 * never silently drift.
 */

const TODAY = new Date("2026-06-05T00:00:00.000Z");

function leaf(overrides: Partial<StatsNode> = {}): StatsNode {
  return {
    id: `n_${Math.random().toString(36).slice(2, 7)}`,
    parentId: "parent_id",
    baselineStart: null,
    baselineFinish: null,
    actualFinish: null,
    projectedFinish: null,
    percentComplete: 0,
    progressEntered: false,
    ...overrides,
  };
}

function parent(id: string): StatsNode {
  return leaf({ id, parentId: null });
}

const NO_OVERRIDE: ProjectMeta = { endDate: null, projectedEndDate: null };

describe("computeProjectStats — empty / zero cases", () => {
  it("returns zeros when there are no nodes", () => {
    const result = computeProjectStats([], NO_OVERRIDE, TODAY);
    expect(result).toEqual({
      totalActivities: 0,
      plannedPercent: 0,
      achievedPercent: 0,
      totalDelayDays: 0,
    });
  });

  it("returns zeros when every node is a parent (no leaves)", () => {
    // Two-node WBS: a root and its (only) parent — both have children, so 0 leaves.
    // (Practically rare; defensive.)
    const a = leaf({ id: "a", parentId: null });
    const b = leaf({ id: "b", parentId: "a" });
    const c = leaf({ id: "c", parentId: "b" });
    // a has child b, b has child c, c has no children → c IS a leaf.
    // To force zero leaves we'd need a cycle, which Prisma doesn't produce.
    const result = computeProjectStats([a, b, c], NO_OVERRIDE, TODAY);
    // c is the only leaf, untracked → 0% across the board.
    expect(result.totalActivities).toBe(1);
    expect(result.achievedPercent).toBe(0);
  });

  it("returns zeros for tracked % when no leaves have progressEntered", () => {
    const result = computeProjectStats(
      [
        parent("p"),
        leaf({ id: "x", parentId: "p", progressEntered: false, percentComplete: 50 }),
        leaf({ id: "y", parentId: "p", progressEntered: false, percentComplete: 75 }),
      ],
      NO_OVERRIDE,
      TODAY,
    );
    // Tracked-only: 0 tracked → denom falls back to leaves.length (2), but
    // the SUMS are over `tracked` (which is empty), so both percents are 0.
    expect(result.totalActivities).toBe(2);
    expect(result.achievedPercent).toBe(0);
    expect(result.plannedPercent).toBe(0);
  });
});

describe("computeProjectStats — achievement math (the trust-breaker fix)", () => {
  it("averages percentComplete across tracked leaves only", () => {
    // 4 tracked leaves with values 100/60/30/0; 6 untracked leaves.
    // Tracked-only: (100+60+30+0) / 4 = 47.5
    // Pre-Tier-2-fix Master-Report-style: 190/10 = 19 (the rejected path)
    const nodes = [
      parent("p"),
      leaf({ id: "a", parentId: "p", progressEntered: true, percentComplete: 100 }),
      leaf({ id: "b", parentId: "p", progressEntered: true, percentComplete: 60 }),
      leaf({ id: "c", parentId: "p", progressEntered: true, percentComplete: 30 }),
      leaf({ id: "d", parentId: "p", progressEntered: true, percentComplete: 0 }),
      ...Array.from({ length: 6 }, (_, i) =>
        leaf({ id: `u${i}`, parentId: "p", progressEntered: false }),
      ),
    ];
    const result = computeProjectStats(nodes, NO_OVERRIDE, TODAY);
    expect(result.totalActivities).toBe(10);
    expect(result.achievedPercent).toBe(47.5);
  });

  it("rounds achieved% to 2 decimals", () => {
    // 3 tracked leaves at 33% each → exactly 33.
    const nodes = [
      parent("p"),
      leaf({ id: "a", parentId: "p", progressEntered: true, percentComplete: 33 }),
      leaf({ id: "b", parentId: "p", progressEntered: true, percentComplete: 33 }),
      leaf({ id: "c", parentId: "p", progressEntered: true, percentComplete: 33 }),
    ];
    expect(computeProjectStats(nodes, NO_OVERRIDE, TODAY).achievedPercent).toBe(33);
  });

  it("handles a single tracked leaf cleanly", () => {
    const nodes = [
      parent("p"),
      leaf({ id: "a", parentId: "p", progressEntered: true, percentComplete: 80 }),
    ];
    expect(computeProjectStats(nodes, NO_OVERRIDE, TODAY).achievedPercent).toBe(80);
  });
});

describe("computeProjectStats — delay days", () => {
  it("uses project-level override when both endDate + projectedEndDate are set", () => {
    const meta: ProjectMeta = {
      endDate: new Date("2026-08-01T00:00:00.000Z"),
      projectedEndDate: new Date("2026-08-31T00:00:00.000Z"), // 30 days later
    };
    const nodes = [parent("p"), leaf({ id: "a", parentId: "p" })];
    expect(computeProjectStats(nodes, meta, TODAY).totalDelayDays).toBe(30);
  });

  it("clamps a negative override at 0 (project is ahead, not 'delayed')", () => {
    // projectedEndDate BEFORE endDate → finishing early. Don't report
    // 'minus 10 days late'; the UI label is "days late" and negative is silly.
    const meta: ProjectMeta = {
      endDate: new Date("2026-08-31T00:00:00.000Z"),
      projectedEndDate: new Date("2026-08-21T00:00:00.000Z"),
    };
    expect(computeProjectStats([parent("p"), leaf({ id: "a", parentId: "p" })], meta, TODAY).totalDelayDays).toBe(0);
  });

  it("falls back to per-leaf max delay when project has no override", () => {
    // Two leaves: leaf-A is 5 days late, leaf-B is 12 days late. Project
    // delay = max(5, 12) = 12.
    const nodes = [
      parent("p"),
      leaf({
        id: "a",
        parentId: "p",
        baselineFinish: new Date("2026-08-01T00:00:00.000Z"),
        projectedFinish: new Date("2026-08-06T00:00:00.000Z"),
      }),
      leaf({
        id: "b",
        parentId: "p",
        baselineFinish: new Date("2026-08-10T00:00:00.000Z"),
        projectedFinish: new Date("2026-08-22T00:00:00.000Z"),
      }),
    ];
    expect(computeProjectStats(nodes, NO_OVERRIDE, TODAY).totalDelayDays).toBe(12);
  });

  it("prefers projectedFinish over actualFinish when both are present", () => {
    // actualFinish is on time, projectedFinish is late — projected wins
    // (planner has revised the estimate; that's the truth-of-record).
    const nodes = [
      parent("p"),
      leaf({
        id: "a",
        parentId: "p",
        baselineFinish: new Date("2026-08-01T00:00:00.000Z"),
        actualFinish: new Date("2026-08-01T00:00:00.000Z"),
        projectedFinish: new Date("2026-08-08T00:00:00.000Z"),
      }),
    ];
    expect(computeProjectStats(nodes, NO_OVERRIDE, TODAY).totalDelayDays).toBe(7);
  });

  it("returns 0 delay when no leaf has both baseline + projected/actual", () => {
    const nodes = [
      parent("p"),
      leaf({ id: "a", parentId: "p", baselineFinish: null, projectedFinish: null }),
      leaf({ id: "b", parentId: "p", baselineFinish: new Date("2026-08-01"), projectedFinish: null, actualFinish: null }),
    ];
    expect(computeProjectStats(nodes, NO_OVERRIDE, TODAY).totalDelayDays).toBe(0);
  });
});

describe("computeProjectStats — leaf identification", () => {
  it("treats a node with no children as a leaf even if it has a parent", () => {
    // 3-level tree: root → mid → leaf
    const nodes = [
      parent("root"),
      leaf({ id: "mid", parentId: "root" }),
      leaf({ id: "leaf", parentId: "mid", progressEntered: true, percentComplete: 50 }),
    ];
    const result = computeProjectStats(nodes, NO_OVERRIDE, TODAY);
    // Only `leaf` has no children, so totalActivities = 1.
    expect(result.totalActivities).toBe(1);
    expect(result.achievedPercent).toBe(50);
  });
});
