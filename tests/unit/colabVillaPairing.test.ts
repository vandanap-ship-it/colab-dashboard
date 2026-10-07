import { describe, it, expect } from "vitest";
import { resolvePairedVillaNumber } from "@/lib/colabSyncMapping";

// Mirrors Amanvana: MSP pairs 3&4, 10&11, 15&16, 23&24 as one Siddhi villa
// each (unitCount 2); everything else is a single villa.
const villas = new Map<number, { unitCount: number }>([
  [3, { unitCount: 2 }],
  [5, { unitCount: 1 }],
  [10, { unitCount: 2 }],
  [12, { unitCount: 1 }],
  [15, { unitCount: 2 }],
  [17, { unitCount: 1 }],
]);

describe("resolvePairedVillaNumber", () => {
  it("returns the villa itself when Siddhi has it", () => {
    expect(resolvePairedVillaNumber(5, villas)).toBe(5);
    expect(resolvePairedVillaNumber(15, villas)).toBe(15);
  });

  it("maps the second half of an MSP pair onto the pair record", () => {
    expect(resolvePairedVillaNumber(16, villas)).toBe(15);
    expect(resolvePairedVillaNumber(4, villas)).toBe(3);
    expect(resolvePairedVillaNumber(11, villas)).toBe(10);
  });

  it("does not borrow a single villa's number", () => {
    // 13 is missing and 12 is a single villa → genuinely missing.
    expect(resolvePairedVillaNumber(13, villas)).toBeNull();
    expect(resolvePairedVillaNumber(6, villas)).toBeNull();
  });

  it("only reaches one number back", () => {
    // 17 exists, so 18 would need 17 to be a pair; 19 never maps to 17.
    expect(resolvePairedVillaNumber(18, villas)).toBeNull();
    expect(resolvePairedVillaNumber(19, villas)).toBeNull();
  });

  it("prefers an existing separate record over the pair (pre-fold Villa 4)", () => {
    const withVilla4 = new Map(villas).set(4, { unitCount: 1 });
    expect(resolvePairedVillaNumber(4, withVilla4)).toBe(4);
  });
});
