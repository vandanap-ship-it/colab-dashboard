import { describe, it, expect } from "vitest";
import {
  normalizeCategory,
  parseAmount,
  summariseExpenses,
  expensesToCsv,
  allowedExpenseTransition,
} from "@/lib/expenses";

describe("normalizeCategory", () => {
  it("keeps a known category", () => {
    expect(normalizeCategory("Transport")).toBe("Transport");
  });
  it("falls back to Miscellaneous for unknown/empty", () => {
    expect(normalizeCategory("Bribes")).toBe("Miscellaneous");
    expect(normalizeCategory(null)).toBe("Miscellaneous");
  });
});

describe("parseAmount", () => {
  it("accepts positive numbers, rounded to 2dp", () => {
    expect(parseAmount("1250.5")).toBe(1250.5);
    expect(parseAmount(99.999)).toBe(100);
  });
  it("rejects zero, negatives, and junk", () => {
    expect(parseAmount(0)).toBeNull();
    expect(parseAmount(-5)).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount(null)).toBeNull();
  });
});

describe("summariseExpenses", () => {
  it("totals by status and category, with grand + approved totals", () => {
    const s = summariseExpenses([
      { status: "SUBMITTED", category: "Materials", amount: 100 },
      { status: "APPROVED", category: "Materials", amount: 200 },
      { status: "APPROVED", category: "Transport", amount: 50 },
      { status: "REJECTED", category: "Misc", amount: 30 },
    ]);
    expect(s.byStatus.APPROVED).toEqual({ count: 2, total: 250 });
    expect(s.byCategory.Materials).toEqual({ count: 2, total: 300 });
    expect(s.grandTotal).toBe(380);
    expect(s.approvedTotal).toBe(250); // 200 + 50, only APPROVED
  });
});

describe("expensesToCsv", () => {
  it("emits a header + escaped rows", () => {
    const csv = expensesToCsv([
      { date: "2026-05-30", category: "Materials", description: 'Cement, "ACC"', paidTo: "Vendor A", amount: 5000, status: "APPROVED" },
    ]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Date,Category,Description,Paid To,Amount,Status");
    expect(lines[1]).toContain('"Cement, ""ACC"""');
    expect(lines[1]).toContain("Vendor A,5000,APPROVED");
  });
});

describe("allowedExpenseTransition", () => {
  it("lets an approver approve or reject a submitted expense", () => {
    expect(allowedExpenseTransition("SUBMITTED", "APPROVED")).toBe("approve");
    expect(allowedExpenseTransition("SUBMITTED", "REJECTED")).toBe("approve");
  });
  it("lets a logger resubmit a rejected expense", () => {
    expect(allowedExpenseTransition("REJECTED", "SUBMITTED")).toBe("resubmit");
  });
  it("rejects illegal transitions", () => {
    expect(allowedExpenseTransition("APPROVED", "SUBMITTED")).toBeNull();
    expect(allowedExpenseTransition("SUBMITTED", "SUBMITTED")).toBeNull();
    expect(allowedExpenseTransition("APPROVED", "REJECTED")).toBeNull();
  });
});
