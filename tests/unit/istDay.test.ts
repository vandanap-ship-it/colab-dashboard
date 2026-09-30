import { describe, it, expect } from "vitest";
import { istDayStart, istDayString } from "@/lib/istDay";

describe("istDayStart", () => {
  it("returns the same IST day for a mid-day IST timestamp", () => {
    // 2026-09-30 12:00 IST = 2026-09-30 06:30 UTC.
    const d = new Date("2026-09-30T06:30:00Z");
    expect(istDayStart(d).toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });

  it("returns TODAY's IST day when UTC is still on YESTERDAY (03:00 IST case)", () => {
    // The bug this lib exists to prevent: at 03:00 IST on Sep 30,
    // UTC clock says Sep 29 21:30. Naive toISOString().slice(0,10)
    // would return 2026-09-29, but the site team's calendar says
    // it's Sep 30 already.
    const d = new Date("2026-09-29T21:30:00Z"); // 03:00 IST on Sep 30
    expect(istDayStart(d).toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });

  it("returns TOMORROW's IST day when UTC clock has already ticked over (late-evening India case)", () => {
    // 20:00 IST on Sep 30 = 14:30 UTC on Sep 30. Straightforward.
    const d = new Date("2026-09-30T14:30:00Z");
    expect(istDayStart(d).toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });

  it("still holds around IST midnight boundary (23:59 IST)", () => {
    // 23:59 IST on Sep 30 = 18:29 UTC on Sep 30. Should still be Sep 30.
    const d = new Date("2026-09-30T18:29:00Z");
    expect(istDayStart(d).toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });

  it("crosses over correctly at 00:00 IST", () => {
    // 00:00 IST on Oct 1 = 18:30 UTC on Sep 30. Should be Oct 1.
    const d = new Date("2026-09-30T18:30:00Z");
    expect(istDayStart(d).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("handles year boundary", () => {
    // 00:30 IST on Jan 1 2027 = 19:00 UTC on Dec 31 2026.
    const d = new Date("2026-12-31T19:00:00Z");
    expect(istDayStart(d).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("handles month boundary", () => {
    // 04:00 IST on Oct 1 = 22:30 UTC on Sep 30.
    const d = new Date("2026-09-30T22:30:00Z");
    expect(istDayStart(d).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("defaults to now() when called without argument", () => {
    // Can't assert an exact value, but the result should be
    // within one IST calendar day of the current instant.
    const result = istDayStart();
    const now = Date.now();
    const diff = Math.abs(now - result.getTime());
    // Under 30 hours' distance (24h + IST offset padding).
    expect(diff).toBeLessThan(30 * 60 * 60 * 1000);
    // Result must be exactly UTC midnight.
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
    expect(result.getUTCMilliseconds()).toBe(0);
  });
});

describe("istDayString", () => {
  it("returns YYYY-MM-DD for an IST-mid-day instant", () => {
    const d = new Date("2026-09-30T06:30:00Z");
    expect(istDayString(d)).toBe("2026-09-30");
  });

  it("returns today's IST day for a 03:00-IST instant, not yesterday's UTC day", () => {
    // The core bug: naive UTC slice would return "2026-09-29".
    const d = new Date("2026-09-29T21:30:00Z");
    expect(istDayString(d)).toBe("2026-09-30");
  });

  it("crosses to next day at 00:00 IST", () => {
    const d = new Date("2026-09-30T18:30:00Z");
    expect(istDayString(d)).toBe("2026-10-01");
  });

  it("format is always exactly 10 chars", () => {
    // Old ISO-8601 shape is load-bearing everywhere it's used as
    // a Map key, HTML date input value, and CSV filename token.
    expect(istDayString(new Date("2026-01-05T12:00:00Z"))).toBe("2026-01-05");
    expect(istDayString(new Date("2026-12-31T23:59:59Z"))).toHaveLength(10);
  });
});
