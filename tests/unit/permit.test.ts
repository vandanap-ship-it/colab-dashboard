import { describe, it, expect } from "vitest";
import {
  canonicalPermitStatus,
  daysUntilExpiry,
  effectivePermitStatus,
  validateCreatePermit,
} from "@/lib/permit";

const d = (iso: string) => new Date(iso + "T00:00:00Z");

describe("canonicalPermitStatus", () => {
  const today = d("2026-08-06");

  it("is ACTIVE when no expiry date (permanent permit)", () => {
    expect(canonicalPermitStatus({ expiryDate: null, renewalReminderDays: 30, today })).toBe("ACTIVE");
  });

  it("is ACTIVE well before expiry", () => {
    expect(canonicalPermitStatus({ expiryDate: d("2027-01-01"), renewalReminderDays: 30, today })).toBe("ACTIVE");
  });

  it("flips to EXPIRING_SOON exactly at the reminder threshold", () => {
    // 30 days out: 2026-09-05
    expect(canonicalPermitStatus({ expiryDate: d("2026-09-05"), renewalReminderDays: 30, today })).toBe("EXPIRING_SOON");
  });

  it("stays EXPIRING_SOON up to and including the last day before expiry", () => {
    expect(canonicalPermitStatus({ expiryDate: d("2026-08-07"), renewalReminderDays: 30, today })).toBe("EXPIRING_SOON");
    expect(canonicalPermitStatus({ expiryDate: d("2026-08-06"), renewalReminderDays: 30, today })).toBe("EXPIRING_SOON");
  });

  it("flips to EXPIRED once past expiry", () => {
    expect(canonicalPermitStatus({ expiryDate: d("2026-08-05"), renewalReminderDays: 30, today })).toBe("EXPIRED");
  });

  it("respects a longer renewal reminder window", () => {
    expect(canonicalPermitStatus({ expiryDate: d("2026-10-04"), renewalReminderDays: 60, today })).toBe("EXPIRING_SOON");
    expect(canonicalPermitStatus({ expiryDate: d("2026-10-06"), renewalReminderDays: 60, today })).toBe("ACTIVE");
  });
});

describe("effectivePermitStatus", () => {
  const today = d("2026-08-06");

  it("preserves RENEWED even when the underlying expiry has lapsed", () => {
    expect(
      effectivePermitStatus({
        storedStatus: "RENEWED",
        expiryDate: d("2026-07-01"),  // past
        renewalReminderDays: 30,
        today,
      }),
    ).toBe("RENEWED");
  });

  it("otherwise returns the canonical status", () => {
    expect(
      effectivePermitStatus({
        storedStatus: "ACTIVE",
        expiryDate: d("2026-08-20"),
        renewalReminderDays: 30,
        today,
      }),
    ).toBe("EXPIRING_SOON");
  });
});

describe("daysUntilExpiry", () => {
  const today = d("2026-08-06");

  it("returns null when there is no expiry", () => {
    expect(daysUntilExpiry(null, today)).toBe(null);
  });

  it("returns positive for future expiry", () => {
    expect(daysUntilExpiry(d("2026-08-16"), today)).toBe(10);
  });

  it("returns 0 on the day of expiry", () => {
    expect(daysUntilExpiry(d("2026-08-06"), today)).toBe(0);
  });

  it("returns negative for past expiry", () => {
    expect(daysUntilExpiry(d("2026-07-06"), today)).toBe(-31);
  });
});

describe("validateCreatePermit", () => {
  const valid = {
    name: "BBMP Building Permit",
    issuingAuthority: "BBMP",
    category: "BUILDING" as const,
    issuedDate: "2026-01-01",
    expiryDate: "2028-12-31",
  };

  it("passes on a valid minimal input", () => {
    expect(validateCreatePermit(valid)).toEqual([]);
  });

  it("requires name", () => {
    expect(validateCreatePermit({ ...valid, name: "" })).toContainEqual({
      field: "name", message: "Permit name is required.",
    });
  });

  it("requires issuing authority", () => {
    expect(validateCreatePermit({ ...valid, issuingAuthority: "" })).toContainEqual({
      field: "issuingAuthority", message: "Issuing authority is required.",
    });
  });

  it("requires a valid category", () => {
    const errs = validateCreatePermit({ ...valid, category: undefined });
    expect(errs.some((e) => e.field === "category")).toBe(true);
  });

  it("requires issue date", () => {
    expect(validateCreatePermit({ ...valid, issuedDate: undefined })).toContainEqual({
      field: "issuedDate", message: "Issue date is required.",
    });
  });

  it("rejects expiry before issue", () => {
    const errs = validateCreatePermit({ ...valid, issuedDate: "2026-06-01", expiryDate: "2026-05-31" });
    expect(errs.some((e) => e.field === "expiryDate" && e.message.includes("before"))).toBe(true);
  });

  it("accepts null expiry (permanent permit)", () => {
    expect(validateCreatePermit({ ...valid, expiryDate: null })).toEqual([]);
  });

  it("rejects out-of-range renewal reminder", () => {
    expect(validateCreatePermit({ ...valid, renewalReminderDays: 0 })).toContainEqual({
      field: "renewalReminderDays", message: "Reminder must be 1–365 days.",
    });
    expect(validateCreatePermit({ ...valid, renewalReminderDays: 400 })).toContainEqual({
      field: "renewalReminderDays", message: "Reminder must be 1–365 days.",
    });
  });
});
