import { describe, it, expect } from "vitest";
import {
  normalizeDiscipline,
  normalizeDrawingNumber,
  normalizeRevisionLabel,
  summariseDrawings,
  drawingsToCsv,
} from "@/lib/drawings";

describe("normalizeDiscipline", () => {
  it("keeps a known discipline", () => {
    expect(normalizeDiscipline("STRUCTURAL")).toBe("STRUCTURAL");
    expect(normalizeDiscipline("MEP")).toBe("MEP");
  });
  it("falls back to OTHER for unknown / empty", () => {
    expect(normalizeDiscipline("VFX")).toBe("OTHER");
    expect(normalizeDiscipline(null)).toBe("OTHER");
    expect(normalizeDiscipline(undefined)).toBe("OTHER");
  });
});

describe("normalizeDrawingNumber", () => {
  it("trims and uppercases", () => {
    expect(normalizeDrawingNumber("  a-104 ")).toBe("A-104");
    expect(normalizeDrawingNumber("mep-12.3")).toBe("MEP-12.3");
  });
  it("rejects non-strings to empty", () => {
    expect(normalizeDrawingNumber(null)).toBe("");
    expect(normalizeDrawingNumber(42)).toBe("");
  });
});

describe("normalizeRevisionLabel", () => {
  it("trims, uppercases, caps at 16 chars", () => {
    expect(normalizeRevisionLabel(" r1 ")).toBe("R1");
    expect(normalizeRevisionLabel("a-very-long-revision-string"))
      .toBe("A-VERY-LONG-REVI"); // 16 chars
  });
});

describe("summariseDrawings", () => {
  it("groups by discipline + counts revisions present", () => {
    const s = summariseDrawings([
      { discipline: "ARCHITECTURAL", currentRevisionId: "r1" },
      { discipline: "ARCHITECTURAL", currentRevisionId: null },
      { discipline: "STRUCTURAL", currentRevisionId: "r2" },
      { discipline: "MEP", currentRevisionId: "r3" },
    ]);
    expect(s.total).toBe(4);
    expect(s.withRevision).toBe(3); // one has null
    expect(s.byDiscipline.ARCHITECTURAL).toBe(2);
    expect(s.byDiscipline.STRUCTURAL).toBe(1);
    expect(s.byDiscipline.MEP).toBe(1);
  });
});

describe("drawingsToCsv", () => {
  const row = {
    drawingNumber: "A-104",
    title: "Earth Bedroom Ground Floor",
    discipline: "ARCHITECTURAL",
    currentRevisionLabel: "R2",
    issuedDate: "2026-06-01",
    uploadedBy: "Vandana",
  };

  it("emits a header + one row", () => {
    const lines = drawingsToCsv([row]).split("\n");
    expect(lines[0]).toBe("Drawing #,Title,Discipline,Current Revision,Issued Date,Uploaded By");
    expect(lines[1]).toBe("A-104,Earth Bedroom Ground Floor,ARCHITECTURAL,R2,2026-06-01,Vandana");
  });

  it("escapes commas + quotes in cells", () => {
    const csv = drawingsToCsv([{ ...row, title: 'Slab plan, "final"' }]);
    const data = csv.split("\n")[1];
    expect(data).toContain('"Slab plan, ""final"""');
  });

  it("renders missing revision/date/user as blank cells", () => {
    const csv = drawingsToCsv([{ ...row, currentRevisionLabel: null, issuedDate: null, uploadedBy: null }]);
    expect(csv.split("\n")[1]).toBe("A-104,Earth Bedroom Ground Floor,ARCHITECTURAL,,,");
  });
});
