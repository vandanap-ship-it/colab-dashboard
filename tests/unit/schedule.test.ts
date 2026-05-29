import { describe, it, expect } from "vitest";
import { plannedPercentFor } from "@/lib/schedule";

const d = (iso: string) => new Date(iso);

describe("plannedPercentFor", () => {
  const start = d("2026-01-01T00:00:00Z");
  const finish = d("2026-01-11T00:00:00Z"); // 10-day window

  it("returns 0 before the baseline start", () => {
    expect(plannedPercentFor(start, finish, d("2025-12-20T00:00:00Z"))).toBe(0);
  });

  it("returns 0 exactly at the start", () => {
    expect(plannedPercentFor(start, finish, start)).toBe(0);
  });

  it("returns 100 exactly at the finish", () => {
    expect(plannedPercentFor(start, finish, finish)).toBe(100);
  });

  it("returns 100 after the finish", () => {
    expect(plannedPercentFor(start, finish, d("2026-02-01T00:00:00Z"))).toBe(100);
  });

  it("ramps linearly in between", () => {
    // 5 days into a 10-day window → 50%.
    expect(plannedPercentFor(start, finish, d("2026-01-06T00:00:00Z"))).toBeCloseTo(50, 6);
    // 1 day in → 10%.
    expect(plannedPercentFor(start, finish, d("2026-01-02T00:00:00Z"))).toBeCloseTo(10, 6);
    // 9 days in → 90%.
    expect(plannedPercentFor(start, finish, d("2026-01-10T00:00:00Z"))).toBeCloseTo(90, 6);
  });

  it("returns 0 when either baseline date is missing", () => {
    expect(plannedPercentFor(null, finish, d("2026-01-06T00:00:00Z"))).toBe(0);
    expect(plannedPercentFor(start, null, d("2026-01-06T00:00:00Z"))).toBe(0);
    expect(plannedPercentFor(null, null, d("2026-01-06T00:00:00Z"))).toBe(0);
  });

  it("handles a zero-duration activity without dividing by zero", () => {
    const milestone = d("2026-03-01T00:00:00Z");
    // Before/at the date → 0 (now <= start wins); strictly after → 100.
    expect(plannedPercentFor(milestone, milestone, d("2026-02-28T00:00:00Z"))).toBe(0);
    expect(plannedPercentFor(milestone, milestone, milestone)).toBe(0);
    expect(plannedPercentFor(milestone, milestone, d("2026-03-02T00:00:00Z"))).toBe(100);
  });
});
