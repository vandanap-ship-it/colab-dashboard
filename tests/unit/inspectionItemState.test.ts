/**
 * Golden tests for the Yes / No / NA state math. Locks down the two-flag
 * encoding used everywhere the app decides "is this row answered?" and
 * how the pass-rate math treats NA rows (they drop out of the
 * denominator).
 */
import { describe, it, expect } from "vitest";
import {
  itemState,
  isAnswered,
  countAnswered,
  passRate,
} from "@/lib/inspectionItemState";

describe("itemState", () => {
  it("resolves NA before Yes/No — even if passed happens to be set", () => {
    // notApplicable wins; the passed value is irrelevant when NA is on.
    expect(itemState({ notApplicable: true, passed: true })).toBe("na");
    expect(itemState({ notApplicable: true, passed: false })).toBe("na");
    expect(itemState({ notApplicable: true, passed: null })).toBe("na");
  });

  it("resolves Yes when passed=true and not NA", () => {
    expect(itemState({ notApplicable: false, passed: true })).toBe("yes");
  });

  it("resolves No when passed=false and not NA", () => {
    expect(itemState({ notApplicable: false, passed: false })).toBe("no");
  });

  it("resolves untouched when passed is null and not NA", () => {
    expect(itemState({ notApplicable: false, passed: null })).toBe("untouched");
    // Both fields undefined — legacy rows from before the migration.
    expect(itemState({ notApplicable: undefined, passed: undefined })).toBe("untouched");
    // Explicit null on notApplicable is treated the same as false — the
    // schema has it NOT NULL DEFAULT FALSE but the helper stays lenient.
    expect(itemState({ notApplicable: null, passed: null })).toBe("untouched");
  });
});

describe("isAnswered", () => {
  it("counts Yes, No and NA as answered; untouched isn't", () => {
    expect(isAnswered({ notApplicable: false, passed: true })).toBe(true);
    expect(isAnswered({ notApplicable: false, passed: false })).toBe(true);
    expect(isAnswered({ notApplicable: true, passed: null })).toBe(true);
    expect(isAnswered({ notApplicable: false, passed: null })).toBe(false);
  });
});

describe("countAnswered", () => {
  it("returns 0 on an empty list", () => {
    expect(countAnswered([])).toBe(0);
  });

  it("counts a mixed list correctly", () => {
    expect(
      countAnswered([
        { notApplicable: false, passed: true }, // yes
        { notApplicable: false, passed: false }, // no
        { notApplicable: true, passed: null }, // na
        { notApplicable: false, passed: null }, // untouched
      ]),
    ).toBe(3);
  });
});

describe("passRate", () => {
  it("returns null when there are no applicable items", () => {
    expect(passRate([])).toBeNull();
    expect(
      passRate([
        { notApplicable: true, passed: null },
        { notApplicable: false, passed: null },
      ]),
    ).toBeNull();
  });

  it("counts Yes over Yes+No — untouched and NA drop out of both sides", () => {
    // 2 yes, 2 no, 1 untouched, 1 NA → 2/4 = 0.5
    expect(
      passRate([
        { notApplicable: false, passed: true },
        { notApplicable: false, passed: true },
        { notApplicable: false, passed: false },
        { notApplicable: false, passed: false },
        { notApplicable: false, passed: null },
        { notApplicable: true, passed: null },
      ]),
    ).toBe(0.5);
  });

  it("is 100% when every applicable answer is Yes, even with NAs mixed in", () => {
    expect(
      passRate([
        { notApplicable: false, passed: true },
        { notApplicable: false, passed: true },
        { notApplicable: true, passed: null }, // NA doesn't dilute
      ]),
    ).toBe(1);
  });

  it("is 0% when every applicable answer is No, and NA doesn't rescue the number", () => {
    expect(
      passRate([
        { notApplicable: false, passed: false },
        { notApplicable: true, passed: null },
      ]),
    ).toBe(0);
  });
});
