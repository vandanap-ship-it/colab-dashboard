import { describe, it, expect } from "vitest";
import {
  canTransition,
  formatRfiNumber,
  nextRfiNumber,
  validateAnswer,
  validateCreateRfi,
} from "@/lib/rfi";

describe("formatRfiNumber", () => {
  it("pads to 4 digits", () => {
    expect(formatRfiNumber(1)).toBe("RFI-0001");
    expect(formatRfiNumber(42)).toBe("RFI-0042");
    expect(formatRfiNumber(9999)).toBe("RFI-9999");
  });
  it("does not truncate 5-digit numbers", () => {
    expect(formatRfiNumber(12345)).toBe("RFI-12345");
  });
});

describe("nextRfiNumber", () => {
  it("returns 1 when no RFIs exist", async () => {
    const prisma = { rfi: { findFirst: async () => null } };
    expect(await nextRfiNumber(prisma, "p1")).toBe(1);
  });
  it("returns latest + 1 for existing project", async () => {
    const prisma = { rfi: { findFirst: async () => ({ number: 42 }) } };
    expect(await nextRfiNumber(prisma, "p1")).toBe(43);
  });
});

describe("canTransition", () => {
  it("allows OPEN → ANSWERED", () => {
    expect(canTransition("OPEN", "ANSWERED")).toBe(true);
  });
  it("allows OPEN → CLOSED (close without answer)", () => {
    expect(canTransition("OPEN", "CLOSED")).toBe(true);
  });
  it("allows ANSWERED → CLOSED", () => {
    expect(canTransition("ANSWERED", "CLOSED")).toBe(true);
  });
  it("allows ANSWERED → OPEN (reopen for follow-up)", () => {
    expect(canTransition("ANSWERED", "OPEN")).toBe(true);
  });
  it("allows CLOSED → OPEN (reopen)", () => {
    expect(canTransition("CLOSED", "OPEN")).toBe(true);
  });
  it("rejects CLOSED → ANSWERED (must reopen first)", () => {
    expect(canTransition("CLOSED", "ANSWERED")).toBe(false);
  });
  it("rejects same-state transitions", () => {
    expect(canTransition("OPEN", "OPEN")).toBe(false);
    expect(canTransition("CLOSED", "CLOSED")).toBe(false);
  });
});

describe("validateCreateRfi", () => {
  const valid = {
    subject: "Foundation depth vs drawing",
    description: "Villa 28 hits rock at -1.4m; RCC drawing shows -2m. Please advise.",
    category: "STRUCTURAL" as const,
  };

  it("passes on a valid minimal input", () => {
    expect(validateCreateRfi(valid)).toEqual([]);
  });

  it("requires subject", () => {
    const errs = validateCreateRfi({ ...valid, subject: "" });
    expect(errs).toContainEqual({ field: "subject", message: "Subject is required." });
  });

  it("rejects overly long subject", () => {
    const errs = validateCreateRfi({ ...valid, subject: "x".repeat(201) });
    expect(errs.some((e) => e.field === "subject" && e.message.includes("200"))).toBe(true);
  });

  it("requires description", () => {
    const errs = validateCreateRfi({ ...valid, description: "   " });
    expect(errs).toContainEqual({ field: "description", message: "Description is required." });
  });

  it("rejects overly long description", () => {
    const errs = validateCreateRfi({ ...valid, description: "x".repeat(4001) });
    expect(errs.some((e) => e.field === "description" && e.message.includes("4000"))).toBe(true);
  });

  it("requires a valid category", () => {
    const errs = validateCreateRfi({ ...valid, category: undefined });
    expect(errs).toContainEqual({ field: "category", message: "Category is required." });
  });

  it("rejects invalid due date strings", () => {
    const errs = validateCreateRfi({ ...valid, dueDate: "not-a-date" });
    expect(errs.some((e) => e.field === "dueDate")).toBe(true);
  });

  it("accepts a valid due date", () => {
    expect(validateCreateRfi({ ...valid, dueDate: "2026-12-31" })).toEqual([]);
  });
});

describe("validateAnswer", () => {
  it("requires non-empty answer", () => {
    expect(validateAnswer("")).toContainEqual({ field: "answer", message: "Answer text is required." });
    expect(validateAnswer("   ")).toContainEqual({ field: "answer", message: "Answer text is required." });
  });

  it("caps at 4000 chars", () => {
    const errs = validateAnswer("x".repeat(4001));
    expect(errs.some((e) => e.field === "answer" && e.message.includes("4000"))).toBe(true);
  });

  it("passes a valid short answer", () => {
    expect(validateAnswer("Blast the rock; recompute cost per BOQ item 5.03.")).toEqual([]);
  });
});
