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
  permitAgeFor,
  concernAgeFor,
  issueAgeFor,
  rfiAgeFor,
  rfiDueSignal,
  rfiDueSignalAsAge,
  WIR_TIERS,
  HINDRANCE_TIERS,
  PERMIT_TIERS,
  CONCERN_TIERS,
  ISSUE_TIERS,
  RFI_TIERS,
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

describe("tierFor (generic, permit SLA)", () => {
  it("only stays fresh at 0d — permits are on the tightest SLA in the app", () => {
    expect(tierFor(0, PERMIT_TIERS)).toBe("fresh");
  });
  it("flips to aging at 1d — earlier than WIRs and hindrances", () => {
    expect(tierFor(1, PERMIT_TIERS)).toBe("aging");
  });
  it("flips to stale at 2d — a permit sitting two days blocks the work it authorizes", () => {
    expect(tierFor(2, PERMIT_TIERS)).toBe("stale");
    expect(tierFor(5, PERMIT_TIERS)).toBe("stale");
  });
});

describe("tierFor (generic, concern SLA)", () => {
  it("stays fresh through 1d", () => {
    expect(tierFor(0, CONCERN_TIERS)).toBe("fresh");
    expect(tierFor(1, CONCERN_TIERS)).toBe("fresh");
  });
  it("flips to aging at 2d — same trigger as WIRs and hindrances", () => {
    expect(tierFor(2, CONCERN_TIERS)).toBe("aging");
    expect(tierFor(4, CONCERN_TIERS)).toBe("aging");
  });
  it("flips to stale at 5d — looser than hindrance (3d) since concerns aren't blockers", () => {
    expect(tierFor(5, CONCERN_TIERS)).toBe("stale");
    expect(tierFor(30, CONCERN_TIERS)).toBe("stale");
  });
});

describe("concernAgeFor", () => {
  it("stays fresh at 1d — a concern raised yesterday", () => {
    const age = concernAgeFor(ISO("2026-09-21T10:00:00Z"), ISO("2026-09-22T10:00:00Z"));
    expect(age).toEqual({ days: 1, tier: "fresh", label: "waiting 1d" });
  });
  it("flips to aging at exactly 2d", () => {
    const age = concernAgeFor(ISO("2026-09-20T10:00:00Z"), ISO("2026-09-22T10:00:00Z"));
    expect(age).toEqual({ days: 2, tier: "aging", label: "waiting 2d" });
  });
  it("flips to stale at exactly 5d — a supervision gap by then", () => {
    const age = concernAgeFor(ISO("2026-09-17T10:00:00Z"), ISO("2026-09-22T10:00:00Z"));
    expect(age).toEqual({ days: 5, tier: "stale", label: "waiting 5d" });
  });
});

describe("tierFor (generic, issue SLA)", () => {
  it("stays fresh through 1d", () => {
    expect(tierFor(0, ISSUE_TIERS)).toBe("fresh");
    expect(tierFor(1, ISSUE_TIERS)).toBe("fresh");
  });
  it("flips to aging at 2d", () => {
    expect(tierFor(2, ISSUE_TIERS)).toBe("aging");
    expect(tierFor(3, ISSUE_TIERS)).toBe("aging");
  });
  it("flips to stale at 4d — tighter than concerns (5d), looser than hindrances (3d)", () => {
    expect(tierFor(4, ISSUE_TIERS)).toBe("stale");
    expect(tierFor(10, ISSUE_TIERS)).toBe("stale");
  });
});

describe("issueAgeFor", () => {
  it("stays fresh at 1d — a snag raised yesterday", () => {
    const age = issueAgeFor(ISO("2026-09-21T10:00:00Z"), ISO("2026-09-22T10:00:00Z"));
    expect(age).toEqual({ days: 1, tier: "fresh", label: "waiting 1d" });
  });
  it("flips to aging at exactly 2d", () => {
    const age = issueAgeFor(ISO("2026-09-20T10:00:00Z"), ISO("2026-09-22T10:00:00Z"));
    expect(age).toEqual({ days: 2, tier: "aging", label: "waiting 2d" });
  });
  it("flips to stale at exactly 4d — four days without a fix is a supervision gap", () => {
    const age = issueAgeFor(ISO("2026-09-18T10:00:00Z"), ISO("2026-09-22T10:00:00Z"));
    expect(age).toEqual({ days: 4, tier: "stale", label: "waiting 4d" });
  });
});

describe("tierFor (generic, RFI SLA)", () => {
  it("stays fresh through 1d", () => {
    expect(tierFor(0, RFI_TIERS)).toBe("fresh");
    expect(tierFor(1, RFI_TIERS)).toBe("fresh");
  });
  it("flips to aging at 2d", () => {
    expect(tierFor(2, RFI_TIERS)).toBe("aging");
  });
  it("flips to stale at 5d — same cliff as concerns; consultant SLA", () => {
    expect(tierFor(5, RFI_TIERS)).toBe("stale");
    expect(tierFor(10, RFI_TIERS)).toBe("stale");
  });
});

describe("rfiDueSignal", () => {
  // All checks use start-of-day snapping so a due date at 09:00 and a
  // "now" at 15:00 on the same day still read as "due today", not "due
  // in 1d" or "overdue by 1d".
  it("reads as due-today when the due date is today", () => {
    const s = rfiDueSignal(ISO("2026-09-22T09:00:00Z"), ISO("2026-09-22T15:00:00Z"));
    expect(s).toEqual({ kind: "due-today", days: 0, label: "due today" });
  });
  it("reads as upcoming with days-until when the due date is in the future", () => {
    const s = rfiDueSignal(ISO("2026-09-25T00:00:00Z"), ISO("2026-09-22T00:00:00Z"));
    expect(s).toEqual({ kind: "upcoming", days: 3, label: "due in 3d" });
  });
  it("reads as overdue with days-past when the due date has passed", () => {
    const s = rfiDueSignal(ISO("2026-09-19T00:00:00Z"), ISO("2026-09-22T00:00:00Z"));
    expect(s).toEqual({ kind: "overdue", days: 3, label: "overdue by 3d" });
  });
  it("counts overdue by full calendar days, not fractional minutes", () => {
    // Due yesterday morning, checked this evening → still 1d overdue,
    // not 1d + something.
    const s = rfiDueSignal(ISO("2026-09-21T09:00:00Z"), ISO("2026-09-22T20:00:00Z"));
    expect(s.kind).toBe("overdue");
    expect(s.days).toBe(1);
  });
});

describe("rfiDueSignalAsAge", () => {
  it("maps overdue → stale tier with 'overdue by Nd' label", () => {
    const age = rfiDueSignalAsAge({ kind: "overdue", days: 3, label: "overdue by 3d" });
    expect(age).toEqual({ days: 3, tier: "stale", label: "overdue by 3d" });
  });
  it("maps due-today → aging tier with 'due today' label", () => {
    const age = rfiDueSignalAsAge({ kind: "due-today", days: 0, label: "due today" });
    expect(age).toEqual({ days: 0, tier: "aging", label: "due today" });
  });
  it("maps upcoming within 5d → aging tier (visible chip)", () => {
    expect(rfiDueSignalAsAge({ kind: "upcoming", days: 1, label: "due in 1d" }).tier).toBe("aging");
    expect(rfiDueSignalAsAge({ kind: "upcoming", days: 5, label: "due in 5d" }).tier).toBe("aging");
  });
  it("maps upcoming > 5d → fresh tier (hidden by renderer)", () => {
    expect(rfiDueSignalAsAge({ kind: "upcoming", days: 6, label: "due in 6d" }).tier).toBe("fresh");
    expect(rfiDueSignalAsAge({ kind: "upcoming", days: 30, label: "due in 30d" }).tier).toBe("fresh");
  });
});

describe("rfiAgeFor", () => {
  it("stays fresh at 1d — an RFI raised yesterday", () => {
    const age = rfiAgeFor(ISO("2026-09-21T10:00:00Z"), ISO("2026-09-22T10:00:00Z"));
    expect(age).toEqual({ days: 1, tier: "fresh", label: "waiting 1d" });
  });
  it("flips to aging at exactly 2d", () => {
    const age = rfiAgeFor(ISO("2026-09-20T10:00:00Z"), ISO("2026-09-22T10:00:00Z"));
    expect(age).toEqual({ days: 2, tier: "aging", label: "waiting 2d" });
  });
  it("flips to stale at exactly 5d — the consultant SLA cliff", () => {
    const age = rfiAgeFor(ISO("2026-09-17T10:00:00Z"), ISO("2026-09-22T10:00:00Z"));
    expect(age).toEqual({ days: 5, tier: "stale", label: "waiting 5d" });
  });
});

describe("permitAgeFor", () => {
  it("stays fresh at 0d — a permit filed this morning", () => {
    const age = permitAgeFor(ISO("2026-09-22T08:00:00Z"), ISO("2026-09-22T18:00:00Z"));
    expect(age).toEqual({ days: 0, tier: "fresh", label: "waiting 0d" });
  });
  it("flips to aging at exactly 1d", () => {
    const age = permitAgeFor(ISO("2026-09-21T10:00:00Z"), ISO("2026-09-22T10:00:00Z"));
    expect(age).toEqual({ days: 1, tier: "aging", label: "waiting 1d" });
  });
  it("flips to stale at 2d — blocks the work it authorizes", () => {
    const age = permitAgeFor(ISO("2026-09-20T10:00:00Z"), ISO("2026-09-22T10:00:00Z"));
    expect(age).toEqual({ days: 2, tier: "stale", label: "waiting 2d" });
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
