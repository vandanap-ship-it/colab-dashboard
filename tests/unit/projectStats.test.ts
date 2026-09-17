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
    weightPct: null,
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

  it("averages across all leaves regardless of progressEntered flag", () => {
    const result = computeProjectStats(
      [
        parent("p"),
        leaf({ id: "x", parentId: "p", progressEntered: false, percentComplete: 50 }),
        leaf({ id: "y", parentId: "p", progressEntered: false, percentComplete: 75 }),
      ],
      NO_OVERRIDE,
      TODAY,
    );
    // Post-Python-parity fix (2026-08-29): compute uses ALL leaves as denom,
    // not just progressEntered ones. percentComplete carries the real state
    // even for leaves that weren't logged via the mobile path (e.g. MSP or
    // Colab import). Avg: (50 + 75) / 2 = 62.5.
    expect(result.totalActivities).toBe(2);
    expect(result.achievedPercent).toBe(62.5);
    expect(result.plannedPercent).toBe(0);
  });
});

describe("computeProjectStats — achievement math (Python-parity)", () => {
  it("averages percentComplete across ALL leaves (correct denom)", () => {
    // 4 tracked leaves with values 100/60/30/0; 6 untracked leaves (all 0%).
    // Correct project-wide %: (100+60+30+0+0+0+0+0+0+0) / 10 = 19
    // Old biased "tracked only" formula: 190/4 = 47.5 (rejected — biased HIGH
    // whenever a partial subset was logged).
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
    expect(result.achievedPercent).toBe(19);
  });

  it("rounds achieved% to 2 decimals", () => {
    // 3 tracked leaves at 33% each, no untracked → 99/3 = 33.
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

  it("uses weightPct-weighted math when Colab weights are available", () => {
    // Two leaves — one weighted 90%, one weighted 10%. Only the small one
    // is 100% complete. Correct: 0.10 × 100 / 100 = 0.10 (project %).
    const nodes = [
      parent("p"),
      leaf({ id: "big", parentId: "p", weightPct: 90, percentComplete: 0, progressEntered: false }),
      leaf({ id: "sml", parentId: "p", weightPct: 10, percentComplete: 100, progressEntered: true }),
    ];
    expect(computeProjectStats(nodes, NO_OVERRIDE, TODAY).achievedPercent).toBe(10);
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

  it("reports negative delay when the project is finishing ahead of its declared end", () => {
    // projectedEndDate BEFORE endDate → finishing early. Signed math: we
    // report -10 so "ahead of schedule" doesn't look identical to "on time
    // to the day". Semantics changed when Snapshot's TotalDelay was
    // reconciled with Overview's KPI (both now signed).
    const meta: ProjectMeta = {
      endDate: new Date("2026-08-31T00:00:00.000Z"),
      projectedEndDate: new Date("2026-08-21T00:00:00.000Z"),
    };
    expect(computeProjectStats([parent("p"), leaf({ id: "a", parentId: "p" })], meta, TODAY).totalDelayDays).toBe(-10);
  });

  it("measures delay of the latest leaf finish against the declared end date", () => {
    // Leaf B projected finish 22 Aug; declared end 10 Aug → 12 days late.
    // Previously this took `max(finish - baseline)` per leaf — that reads
    // 0 when every leaf is on its own baseline even though the schedule
    // as a whole sits past the declared end. The new math compares the
    // whole-schedule latest finish to project.endDate.
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
    const meta: ProjectMeta = { endDate: new Date("2026-08-10T00:00:00.000Z"), projectedEndDate: null };
    expect(computeProjectStats(nodes, meta, TODAY).totalDelayDays).toBe(12);
  });

  it("prefers actualFinish over projectedFinish when the activity is complete", () => {
    // actualFinish is the truth-of-record once set — projectedFinish is a
    // pre-completion estimate and becomes irrelevant. Signed math means a
    // leaf that finished 7 days LATE registers as +7, not clamped.
    const nodes = [
      parent("p"),
      leaf({
        id: "a",
        parentId: "p",
        baselineFinish: new Date("2026-08-01T00:00:00.000Z"),
        actualFinish: new Date("2026-08-08T00:00:00.000Z"),   // finished 7d late
        projectedFinish: new Date("2026-08-15T00:00:00.000Z"), // stale estimate — ignored
      }),
    ];
    const meta: ProjectMeta = { endDate: new Date("2026-08-01T00:00:00.000Z"), projectedEndDate: null };
    expect(computeProjectStats(nodes, meta, TODAY).totalDelayDays).toBe(7);
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
