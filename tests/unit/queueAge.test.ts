/**
 * Golden tests for the queue-aging math.
 *
 * Locks down three things prod relies on:
 *   1. The day math floors correctly — a row that's 6 days and 23 hours
 *      old is still "aging" (6d), not "stale" (7d), so the chip doesn't
 *      flip a full 60 minutes early.
 *   2. Per-domain tier boundaries hold: WIRs use the 2d/7d SLA,
 *      hindrances use the tighter 2d/3d SLA. If either constant moves,
 *      it's an intentional decision, not a drift.
 *   3. The generic tierFor + computeAge accept arbitrary SLAs so a
 *      future caller (permits, RFIs) can drop in without a new helper.
 */
import { describe, it, expect } from "vitest";
import {
  daysBetween,
  tierFor,
  computeAge,
  wirAgeFor,
  hindranceAgeFor,
  WIR_TIERS,
  HINDRANCE_TIERS,
} from "@/lib/queueAge";

const ISO = (s: string) => new Date(s);

describe("daysBetween", () => {
  it("returns 0 for same instant", () => {
    expect(daysBetween(ISO("2026-09-22T10:00:00Z"), ISO("2026-09-22T10:00:00Z"))).toBe(0);
  });
  it("floors sub-day differences", () => {
    // 23h 59m is still 0 days — a row filed yesterday morning shouldn't
    // read as 1d old until it clears a full 24 hours.
    expect(daysBetween(ISO("2026-09-22T10:00:00Z"), ISO("2026-09-23T09:59:00Z"))).toBe(0);
  });
  it("counts complete calendar days", () => {
    expect(daysBetween(ISO("2026-09-15T10:00:00Z"), ISO("2026-09-22T10:00:00Z"))).toBe(7);
  });
  it("clamps future-dated createdAt to 0 (server-clock skew)", () => {
    expect(daysBetween(ISO("2026-09-25T10:00:00Z"), ISO("2026-09-22T10:00:00Z"))).toBe(0);
  });
});

describe("tierFor (generic, WIR SLA)", () => {
  it("classifies 0d and 1d as fresh (no chip)", () => {
    expect(tierFor(0, WIR_TIERS)).toBe("fresh");
    expect(tierFor(1, WIR_TIERS)).toBe("fresh");
  });
  it("classifies 2d through 6d as aging", () => {
    expect(tierFor(2, WIR_TIERS)).toBe("aging");
    expect(tierFor(6, WIR_TIERS)).toBe("aging");
  });
  it("classifies 7d and beyond as stale — mirrors the internal review SLA", () => {
    expect(tierFor(7, WIR_TIERS)).toBe("stale");
    expect(tierFor(14, WIR_TIERS)).toBe("stale");
    expect(tierFor(60, WIR_TIERS)).toBe("stale");
  });
});

describe("tierFor (generic, hindrance SLA)", () => {
  it("stays fresh through 1d", () => {
    expect(tierFor(0, HINDRANCE_TIERS)).toBe("fresh");
    expect(tierFor(1, HINDRANCE_TIERS)).toBe("fresh");
  });
  it("flips to aging at 2d — same start as WIRs", () => {
    expect(tierFor(2, HINDRANCE_TIERS)).toBe("aging");
  });
  it("flips to stale at 3d — much tighter than WIRs", () => {
    expect(tierFor(3, HINDRANCE_TIERS)).toBe("stale");
    expect(tierFor(7, HINDRANCE_TIERS)).toBe("stale");
    expect(tierFor(30, HINDRANCE_TIERS)).toBe("stale");
  });
});

describe("computeAge (generic)", () => {
  it("bundles days + tier + label from custom tiers", () => {
    const permit = { agingAt: 1, staleAt: 2 };
    const age = computeAge(ISO("2026-09-19T10:00:00Z"), permit, ISO("2026-09-22T10:00:00Z"));
    expect(age).toEqual({ days: 3, tier: "stale", label: "waiting 3d" });
  });
});

describe("wirAgeFor", () => {
  it("bundles days + tier + label from the WIR SLA", () => {
    // 3 full days between filed and now → aging tier, "waiting 3d" label.
    const age = wirAgeFor(ISO("2026-09-19T10:00:00Z"), ISO("2026-09-22T10:00:00Z"));
    expect(age).toEqual({ days: 3, tier: "aging", label: "waiting 3d" });
  });
  it("stays fresh at exactly 1d 23h — no early chip flip", () => {
    const age = wirAgeFor(ISO("2026-09-20T10:00:00Z"), ISO("2026-09-22T09:59:00Z"));
    expect(age).toEqual({ days: 1, tier: "fresh", label: "waiting 1d" });
  });
  it("flips to stale exactly at 7d 00h — SLA boundary", () => {
    const age = wirAgeFor(ISO("2026-09-15T10:00:00Z"), ISO("2026-09-22T10:00:00Z"));
    expect(age.days).toBe(7);
    expect(age.tier).toBe("stale");
  });
});

describe("hindranceAgeFor", () => {
  it("stays fresh at 1d — blockers aren't cried wolf at 24h", () => {
    const age = hindranceAgeFor(ISO("2026-09-21T10:00:00Z"), ISO("2026-09-22T10:00:00Z"));
    expect(age).toEqual({ days: 1, tier: "fresh", label: "waiting 1d" });
  });
  it("flips to aging at 2d — same trigger as WIRs", () => {
    const age = hindranceAgeFor(ISO("2026-09-20T10:00:00Z"), ISO("2026-09-22T10:00:00Z"));
    expect(age).toEqual({ days: 2, tier: "aging", label: "waiting 2d" });
  });
  it("flips to stale at 3d — much tighter cliff than a WIR", () => {
    const age = hindranceAgeFor(ISO("2026-09-19T10:00:00Z"), ISO("2026-09-22T10:00:00Z"));
    expect(age).toEqual({ days: 3, tier: "stale", label: "waiting 3d" });
  });
  it("stays stale forever once past the cliff", () => {
    const age = hindranceAgeFor(ISO("2026-08-22T10:00:00Z"), ISO("2026-09-22T10:00:00Z"));
    expect(age.tier).toBe("stale");
    expect(age.days).toBe(31);
  });
});
