import { describe, it, expect } from "vitest";
import { diffSummary } from "@/lib/audit";

describe("diffSummary", () => {
  it("reports only changed fields", () => {
    const { summary, changes } = diffSummary(
      { status: "OPEN", assignedToId: null },
      { status: "RESOLVED", assignedToId: null },
    );
    expect(summary).toContain("status: OPEN -> RESOLVED");
    expect(changes.status).toEqual(["OPEN", "RESOLVED"]);
    expect(changes.assignedToId).toBeUndefined();
  });

  it("ignores id/createdAt/updatedAt by default", () => {
    const { changes } = diffSummary(
      { id: "a", createdAt: new Date(), status: "OPEN" },
      { id: "a", createdAt: new Date(Date.now() + 1000), status: "OPEN" },
    );
    expect(Object.keys(changes)).toHaveLength(0);
  });

  it("handles null → value transitions", () => {
    const { summary } = diffSummary(
      { assignedToId: null },
      { assignedToId: "user_123" },
    );
    expect(summary).toContain("assignedToId:");
    expect(summary).toContain("user_123");
  });

  it("compares dates by ISO value", () => {
    const d1 = new Date("2026-01-01");
    const d2 = new Date("2026-01-01");
    const { changes } = diffSummary({ date: d1 }, { date: d2 });
    expect(Object.keys(changes)).toHaveLength(0);
  });

  it("detects a real date change", () => {
    const { changes } = diffSummary(
      { date: new Date("2026-01-01") },
      { date: new Date("2026-02-01") },
    );
    expect(changes.date).toBeDefined();
  });

  it("truncates the summary to a handful of fields", () => {
    const before = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 };
    const after = { a: 9, b: 9, c: 9, d: 9, e: 9, f: 9 };
    const { summary } = diffSummary(before, after);
    // Summary caps at 4 fields joined by comma
    expect(summary.split(", ").length).toBeLessThanOrEqual(4);
  });
});
