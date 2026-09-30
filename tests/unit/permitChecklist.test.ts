import { describe, it, expect } from "vitest";
import { narrowCheckpoints, applyReviewerReply } from "@/lib/permitChecklist";

describe("narrowCheckpoints", () => {
  it("returns [] for anything that isn't an array", () => {
    expect(narrowCheckpoints(null)).toEqual([]);
    expect(narrowCheckpoints(undefined)).toEqual([]);
    expect(narrowCheckpoints({})).toEqual([]);
    expect(narrowCheckpoints("[]")).toEqual([]);
    expect(narrowCheckpoints(42)).toEqual([]);
  });

  it("keeps well-formed rows verbatim, defaulting missing optionals to safe values", () => {
    const rows = narrowCheckpoints([
      { q: "Is the site clear?", passed: true, remark: "yes", photoUrl: "https://example.com/a.jpg" },
      { q: "Ladder anchored?", passed: false },
      { q: "PPE worn?", passed: null },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      q: "Is the site clear?",
      passed: true,
      remark: "yes",
      photoUrl: "https://example.com/a.jpg",
      reviewerNote: null,
      reviewerPhotoUrl: null,
    });
    expect(rows[1]).toMatchObject({ q: "Ladder anchored?", passed: false });
    expect(rows[1].remark).toBeUndefined();
    expect(rows[2].passed).toBeNull();
  });

  it("drops rows without a string `q` (defensive against corrupted JSONB)", () => {
    const rows = narrowCheckpoints([
      { q: "Good row", passed: true },
      null,
      "not an object",
      { passed: true }, // no q
      { q: 42, passed: true }, // q wrong type
      { q: "Also good", passed: null },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.q)).toEqual(["Good row", "Also good"]);
  });

  it("coerces non-boolean passed to null (never crashes on garbage state)", () => {
    const rows = narrowCheckpoints([
      { q: "Test", passed: "yes" },
      { q: "Test 2", passed: 1 },
      { q: "Test 3", passed: undefined },
    ]);
    expect(rows.every((r) => r.passed === null)).toBe(true);
  });

  it("carries reviewerNote and reviewerPhotoUrl through when present", () => {
    const rows = narrowCheckpoints([
      {
        q: "Q1",
        passed: true,
        reviewerNote: "Looks good",
        reviewerPhotoUrl: "https://example.com/reviewer.jpg",
      },
    ]);
    expect(rows[0].reviewerNote).toBe("Looks good");
    expect(rows[0].reviewerPhotoUrl).toBe("https://example.com/reviewer.jpg");
  });

  it("null reviewer fields on input come out as null (not undefined)", () => {
    const rows = narrowCheckpoints([{ q: "Q1", passed: true, reviewerNote: null, reviewerPhotoUrl: null }]);
    expect(rows[0].reviewerNote).toBeNull();
    expect(rows[0].reviewerPhotoUrl).toBeNull();
  });
});

describe("applyReviewerReply", () => {
  const baseline = [
    { q: "Q1", passed: true, remark: "raiser remark 1", photoUrl: "https://example.com/1.jpg" },
    { q: "Q2", passed: false, remark: "raiser remark 2" },
    { q: "Q3", passed: null },
  ];

  it("returns null for an out-of-range index (positive)", () => {
    expect(applyReviewerReply(baseline, 99, { reviewerNote: "hi" })).toBeNull();
  });

  it("returns null for a negative index", () => {
    expect(applyReviewerReply(baseline, -1, { reviewerNote: "hi" })).toBeNull();
  });

  it("returns null on an empty array", () => {
    expect(applyReviewerReply([], 0, { reviewerNote: "hi" })).toBeNull();
  });

  it("sets a reviewerNote without touching raiser fields", () => {
    const next = applyReviewerReply(baseline, 0, { reviewerNote: "Approver comment" });
    expect(next).not.toBeNull();
    expect(next![0]).toMatchObject({
      q: "Q1",
      passed: true,
      remark: "raiser remark 1",
      photoUrl: "https://example.com/1.jpg",
      reviewerNote: "Approver comment",
    });
    // Other rows untouched
    expect(next![1]).toEqual(baseline[1]);
    expect(next![2]).toEqual(baseline[2]);
  });

  it("trims whitespace on reviewerNote and clears when only whitespace", () => {
    const next = applyReviewerReply(baseline, 1, { reviewerNote: "   " });
    expect(next![1].reviewerNote).toBeNull();
    const next2 = applyReviewerReply(baseline, 1, { reviewerNote: "  hello  " });
    expect(next2![1].reviewerNote).toBe("hello");
  });

  it("clears reviewerNote when passed null", () => {
    const withNote = applyReviewerReply(baseline, 0, { reviewerNote: "temp" })!;
    const next = applyReviewerReply(withNote, 0, { reviewerNote: null });
    expect(next![0].reviewerNote).toBeNull();
  });

  it("preserves existing reviewerNote when the patch omits it (undefined)", () => {
    const withNote = applyReviewerReply(baseline, 0, { reviewerNote: "existing" })!;
    const next = applyReviewerReply(withNote, 0, { reviewerPhotoUrl: "https://example.com/photo.jpg" });
    expect(next![0].reviewerNote).toBe("existing");
    expect(next![0].reviewerPhotoUrl).toBe("https://example.com/photo.jpg");
  });

  it("does not mutate the input array", () => {
    const snapshot = JSON.parse(JSON.stringify(baseline));
    applyReviewerReply(baseline, 0, { reviewerNote: "x", reviewerPhotoUrl: "https://x.com/y.jpg" });
    expect(baseline).toEqual(snapshot);
  });

  it("clearing photo with null keeps the note untouched", () => {
    const withBoth = applyReviewerReply(baseline, 0, {
      reviewerNote: "kept",
      reviewerPhotoUrl: "https://x.com/y.jpg",
    })!;
    const next = applyReviewerReply(withBoth, 0, { reviewerPhotoUrl: null });
    expect(next![0].reviewerNote).toBe("kept");
    expect(next![0].reviewerPhotoUrl).toBeNull();
  });
});
