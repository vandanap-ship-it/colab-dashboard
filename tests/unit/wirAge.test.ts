/**
 * Golden tests for the WIR aging tiers.
 *
 * These lock down two things the queue relies on:
 *   1. The tier boundaries (fresh <2d, aging 2-6d, stale 7d+). If the
 *      SLA moves the boundaries move, but only intentionally.
 *   2. The day math floors correctly — a WIR that's 6 days and 23 hours
 *      old is still "aging" (6d), not "stale" (7d), so the chip doesn't
 *      flip a full 60 minutes early.
 */
import { describe, it, expect } from "vitest";
import { daysBetween, tierFor, wirAgeFor } from "@/lib/wirAge";

const ISO = (s: string) => new Date(s);

describe("daysBetween", () => {
  it("returns 0 for same instant", () => {
    expect(daysBetween(ISO("2026-09-22T10:00:00Z"), ISO("2026-09-22T10:00:00Z"))).toBe(0);
  });
  it("floors sub-day differences", () => {
    // 23h 59m is still 0 days — a WIR filed yesterday morning shouldn't
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

describe("tierFor", () => {
  it("classifies 0d and 1d as fresh (no chip)", () => {
    expect(tierFor(0)).toBe("fresh");
    expect(tierFor(1)).toBe("fresh");
  });
  it("classifies 2d through 6d as aging", () => {
    expect(tierFor(2)).toBe("aging");
    expect(tierFor(6)).toBe("aging");
  });
  it("classifies 7d and beyond as stale — mirrors the internal review SLA", () => {
    expect(tierFor(7)).toBe("stale");
    expect(tierFor(14)).toBe("stale");
    expect(tierFor(60)).toBe("stale");
  });
});

describe("wirAgeFor", () => {
  it("bundles days + tier + label from the same source of truth", () => {
    // 3 full days between filed and now → aging tier, "waiting 3d" label.
    const age = wirAgeFor(ISO("2026-09-19T10:00:00Z"), ISO("2026-09-22T10:00:00Z"));
    expect(age).toEqual({ days: 3, tier: "aging", label: "waiting 3d" });
  });
  it("stays fresh at exactly 1d 23h — no early chip flip", () => {
    // 1 day 23 hours 59 minutes floors to 1d, tier stays fresh.
    const age = wirAgeFor(ISO("2026-09-20T10:00:00Z"), ISO("2026-09-22T09:59:00Z"));
    expect(age).toEqual({ days: 1, tier: "fresh", label: "waiting 1d" });
  });
  it("flips to stale exactly at 7d 00h — SLA boundary", () => {
    const age = wirAgeFor(ISO("2026-09-15T10:00:00Z"), ISO("2026-09-22T10:00:00Z"));
    expect(age.days).toBe(7);
    expect(age.tier).toBe("stale");
  });
});
