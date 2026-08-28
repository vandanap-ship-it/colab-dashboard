import { describe, it, expect } from "vitest";
import { aggregateChildren, type WbsChild } from "@/lib/milestoneRollup";

const d = (iso: string) => new Date(iso + "T00:00:00Z");

function child(overrides: Partial<WbsChild> = {}): WbsChild {
  return {
    id: overrides.id ?? "n1",
    isSubMilestone: false,
    percentComplete: null,
    actualStart: null,
    actualFinish: null,
    baselineStart: null,
    baselineFinish: null,
    ...overrides,
  };
}

// Colab convention: pctComplete + actualStart aggregate across all children,
// but actualFinish is driven by the ★ END-marker's own closure. This
// matches how Colab keeps Foundation as a villa's current stage until the
// Footing RCC — Concreting ★ row is signed off.
describe("aggregate closure driven by ★ END-marker", () => {
  it("aggregates pctComplete across every child (star doesn't dominate the %)", () => {
    const star = child({ id: "star", isSubMilestone: true, percentComplete: 100, actualFinish: d("2026-08-20"), baselineStart: d("2026-08-01"), baselineFinish: d("2026-08-20") });
    const sib  = child({ id: "sib",  isSubMilestone: false, percentComplete: 50,  actualFinish: null,          baselineStart: d("2026-08-01"), baselineFinish: d("2026-08-20") });
    const r = aggregateChildren([star, sib]);
    expect(r.pctComplete).toBe(75); // weighted avg 75, not the star's 100
  });

  it("closes the milestone when the ★ closes, even if a sibling is still open", () => {
    const star = child({ id: "star", isSubMilestone: true, percentComplete: 100, actualFinish: d("2026-08-20"), baselineStart: d("2026-08-01"), baselineFinish: d("2026-08-20") });
    const sib  = child({ id: "sib",  isSubMilestone: false, percentComplete: 50,  actualFinish: null,          baselineStart: d("2026-08-01"), baselineFinish: d("2026-08-20") });
    const r = aggregateChildren([star, sib]);
    expect(r.actualFinish?.toISOString()).toBe("2026-08-20T00:00:00.000Z");
  });

  it("keeps the milestone open if the ★ isn't done — sibling completeness doesn't matter", () => {
    const star = child({ id: "star", isSubMilestone: true, percentComplete: 50, actualFinish: null,           baselineStart: d("2026-08-01"), baselineFinish: d("2026-08-20") });
    const sib  = child({ id: "sib",  isSubMilestone: false, percentComplete: 100, actualFinish: d("2026-08-05"), baselineStart: d("2026-08-01"), baselineFinish: d("2026-08-05") });
    const r = aggregateChildren([star, sib]);
    expect(r.actualFinish).toBeNull();
  });

  it("falls back to 'all baselined children done' when no ★ exists", () => {
    const a = child({ id: "a", percentComplete: 100, actualFinish: d("2026-08-15"), baselineStart: d("2026-08-01"), baselineFinish: d("2026-08-15") });
    const b = child({ id: "b", percentComplete: 100, actualFinish: d("2026-08-20"), baselineStart: d("2026-08-01"), baselineFinish: d("2026-08-20") });
    const r = aggregateChildren([a, b]);
    expect(r.actualFinish?.toISOString()).toBe("2026-08-20T00:00:00.000Z");
  });
});

describe("aggregateChildren", () => {
  it("returns 0% + null dates for empty child list", () => {
    const r = aggregateChildren([]);
    expect(r.pctComplete).toBe(0);
    expect(r.actualStart).toBeNull();
    expect(r.actualFinish).toBeNull();
  });

  it("duration-weights pctComplete correctly (60d @ 50% + 10d @ 100% → ~57%)", () => {
    const a = child({ baselineStart: d("2026-01-01"), baselineFinish: d("2026-03-02"), percentComplete: 50 }); // 60d
    const b = child({ baselineStart: d("2026-01-01"), baselineFinish: d("2026-01-11"), percentComplete: 100 }); // 10d
    const r = aggregateChildren([a, b]);
    // (50*60 + 100*10) / 70 = 3000 + 1000 / 70 = 4000/70 = 57.14
    expect(Math.round(r.pctComplete)).toBe(57);
  });

  it("earliest actualStart across started children", () => {
    const a = child({ actualStart: d("2026-06-01") });
    const b = child({ actualStart: d("2026-05-15") });
    const c = child({ actualStart: null });
    expect(aggregateChildren([a, b, c]).actualStart?.toISOString()).toBe("2026-05-15T00:00:00.000Z");
  });

  it("actualFinish stays null while ANY baselined child isn't done", () => {
    const done = child({ baselineFinish: d("2026-08-01"), actualFinish: d("2026-08-05") });
    const notDone = child({ baselineFinish: d("2026-08-10"), actualFinish: null });
    const r = aggregateChildren([done, notDone]);
    expect(r.actualFinish).toBeNull();
  });

  it("actualFinish = latest of children only when every baselined child is done", () => {
    const a = child({ baselineFinish: d("2026-08-01"), actualFinish: d("2026-08-05") });
    const b = child({ baselineFinish: d("2026-08-10"), actualFinish: d("2026-08-15") });
    const r = aggregateChildren([a, b]);
    expect(r.actualFinish?.toISOString()).toBe("2026-08-15T00:00:00.000Z");
  });

  it("children without a baselineFinish don't gate closure", () => {
    // A "decorative" WBS node with no baseline doesn't need to be finished
    // for the milestone to close.
    const baselined = child({ baselineFinish: d("2026-08-01"), actualFinish: d("2026-08-05") });
    const decorative = child({ baselineFinish: null, actualFinish: null });
    const r = aggregateChildren([baselined, decorative]);
    expect(r.actualFinish?.toISOString()).toBe("2026-08-05T00:00:00.000Z");
  });

  it("clamps pctComplete inputs to [0, 100]", () => {
    const bad = child({ baselineStart: d("2026-01-01"), baselineFinish: d("2026-01-11"), percentComplete: 200 });
    expect(aggregateChildren([bad]).pctComplete).toBe(100);
  });

  it("uses 1-day fallback when a child has no baseline dates", () => {
    // Two children, both 100%, no baselines — should be exactly 100%.
    const a = child({ percentComplete: 100, baselineStart: null, baselineFinish: null });
    const b = child({ percentComplete: 100, baselineStart: null, baselineFinish: null });
    expect(aggregateChildren([a, b]).pctComplete).toBe(100);
  });
});
