import { describe, it, expect } from "vitest";
import {
  normalizeLine,
  cleanLines,
  computeBillTotals,
  allowedBillTransition,
} from "@/lib/billing";

describe("normalizeLine", () => {
  it("computes ITEM_RATE amount from quantity × rate (ignores client amount)", () => {
    const l = normalizeLine(
      { type: "ITEM_RATE", description: "Concrete", quantity: 10, rate: 5500, unit: "m3", amount: 999999 },
      0,
    );
    expect(l.amount).toBe(55000); // 10 × 5500, NOT the client-sent 999999
    expect(l.quantity).toBe(10);
    expect(l.rate).toBe(5500);
  });

  it("computes LABOUR amount from headcount × rate", () => {
    const l = normalizeLine({ type: "LABOUR", description: "Masons", quantity: 4, rate: 850 }, 0);
    expect(l.amount).toBe(3400);
  });

  it("takes the given amount for LUMP_SUM and nulls qty/rate", () => {
    const l = normalizeLine({ type: "LUMP_SUM", description: "Milestone 1", amount: 200000 }, 0);
    expect(l.amount).toBe(200000);
    expect(l.quantity).toBeNull();
    expect(l.rate).toBeNull();
  });

  it("defaults an unknown type to LUMP_SUM and clamps negatives to 0/null", () => {
    const l = normalizeLine({ type: "BOGUS", description: "x", amount: -5 }, 0);
    expect(l.type).toBe("LUMP_SUM");
    expect(l.amount).toBe(0);
  });
});

describe("cleanLines", () => {
  it("drops blank rows and re-indexes", () => {
    const lines = cleanLines([
      { type: "LUMP_SUM", description: "Real", amount: 100 },
      { type: "LUMP_SUM", description: "", amount: 0 }, // blank → dropped
      { type: "ITEM_RATE", description: "Steel", quantity: 2, rate: 50 },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.orderIndex)).toEqual([0, 1]);
    expect(lines[1].amount).toBe(100);
  });
});

describe("computeBillTotals", () => {
  it("sums line amounts with no tax", () => {
    expect(computeBillTotals([100, 250.5, 49.5], null)).toEqual({ subtotal: 400, tax: 0, total: 400 });
  });

  it("applies a tax percentage", () => {
    expect(computeBillTotals([1000], 18)).toEqual({ subtotal: 1000, tax: 180, total: 1180 });
  });

  it("ignores non-finite amounts and treats 0% tax as none", () => {
    expect(computeBillTotals([100, NaN, 50], 0)).toEqual({ subtotal: 150, tax: 0, total: 150 });
  });
});

describe("allowedBillTransition", () => {
  it("allows the prepare-side transitions", () => {
    expect(allowedBillTransition("DRAFT", "SUBMITTED")).toBe("prepare");
    expect(allowedBillTransition("SUBMITTED", "DRAFT")).toBe("prepare");
    expect(allowedBillTransition("REJECTED", "DRAFT")).toBe("prepare");
  });

  it("allows the approve-side transitions", () => {
    expect(allowedBillTransition("SUBMITTED", "APPROVED")).toBe("approve");
    expect(allowedBillTransition("SUBMITTED", "REJECTED")).toBe("approve");
    expect(allowedBillTransition("APPROVED", "PAID")).toBe("approve");
  });

  it("rejects illegal jumps", () => {
    expect(allowedBillTransition("DRAFT", "APPROVED")).toBeNull(); // can't skip submit
    expect(allowedBillTransition("DRAFT", "PAID")).toBeNull();
    expect(allowedBillTransition("APPROVED", "DRAFT")).toBeNull();
    expect(allowedBillTransition("PAID", "DRAFT")).toBeNull();
  });
});
