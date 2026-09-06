import { describe, it, expect } from "vitest";
import { formatDayMonthYear, formatDayMonthYearTime } from "@/lib/dates";

/**
 * Lock the IST-pinned behaviour of the shared date formatter. If someone
 * ever removes the timeZone: "Asia/Kolkata" option — either "to fix the
 * tests" or from a locale-refactor — these tests fail and force them to
 * reckon with the server-vs-client render mismatch that IST pinning
 * exists to prevent.
 *
 * All assertions use "en-GB" formatting: two-digit day, three-letter
 * month, four-digit year, separated by spaces (matches the current UI).
 */
describe("formatDayMonthYear — IST-pinned", () => {
  it("renders a UTC-midnight ISO string as the same IST calendar day", () => {
    // 2026-06-02T00:00:00Z is 05:30 IST on the same date.
    expect(formatDayMonthYear("2026-06-02T00:00:00Z")).toBe("02 Jun 2026");
  });

  it("shifts a late-night-UTC timestamp forward one calendar day in IST", () => {
    // 2026-06-01T21:30:00Z is 03:00 IST on 2026-06-02 — the exact case
    // that caused server/client hydration mismatches before this pinning.
    expect(formatDayMonthYear("2026-06-01T21:30:00Z")).toBe("02 Jun 2026");
  });

  it("keeps an early-UTC timestamp on the same calendar day in IST", () => {
    // 2026-06-02T04:00:00Z is 09:30 IST on 2026-06-02.
    expect(formatDayMonthYear("2026-06-02T04:00:00Z")).toBe("02 Jun 2026");
  });

  it("handles a Date object as well as an ISO string", () => {
    expect(formatDayMonthYear(new Date("2026-01-15T12:00:00Z"))).toBe("15 Jan 2026");
  });

  it("returns em-dash for null / undefined / empty string", () => {
    expect(formatDayMonthYear(null)).toBe("—");
    expect(formatDayMonthYear(undefined)).toBe("—");
    expect(formatDayMonthYear("")).toBe("—");
  });

  it("renders identically regardless of caller's timezone assumption", () => {
    // Two ISO strings that happen to represent the same moment when
    // interpreted as UTC. Both should format identically because the
    // output is pinned to Asia/Kolkata.
    const a = formatDayMonthYear("2026-06-02T00:00:00.000Z");
    const b = formatDayMonthYear(new Date("2026-06-02T00:00:00.000Z"));
    expect(a).toBe(b);
  });
});

describe("formatDayMonthYearTime — IST-pinned", () => {
  it("renders IST wall-clock time for a UTC timestamp", () => {
    // 14:32 UTC = 20:02 IST on 2026-06-02. Comma between date and time is
    // how en-GB formats it via toLocaleString with the two shape options.
    expect(formatDayMonthYearTime("2026-06-02T14:32:00Z")).toBe("02 Jun 26, 20:02");
  });

  it("bumps the date when UTC time crosses into next IST day", () => {
    // 19:00 UTC = 00:30 IST next day.
    expect(formatDayMonthYearTime("2026-06-01T19:00:00Z")).toBe("02 Jun 26, 00:30");
  });

  it("keeps midnight UTC on the same IST calendar day", () => {
    // 00:00 UTC = 05:30 IST same day.
    expect(formatDayMonthYearTime("2026-06-02T00:00:00Z")).toBe("02 Jun 26, 05:30");
  });

  it("returns em-dash for nullish input", () => {
    expect(formatDayMonthYearTime(null)).toBe("—");
    expect(formatDayMonthYearTime(undefined)).toBe("—");
  });

  it("uses 24-hour time — no am/pm suffix", () => {
    // 21:00 IST = 15:30 UTC. Format must be "21:00", never "9:00 pm".
    const out = formatDayMonthYearTime("2026-06-02T15:30:00Z");
    expect(out).toBe("02 Jun 26, 21:00");
    expect(out).not.toMatch(/am|pm/i);
  });
});
