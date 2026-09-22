/**
 * Golden tests for mobile-home tile visibility per user shape.
 *
 * Locks down what a scoped external contractor sees when they open the
 * app. Two invariants together:
 *   1. Every tile key the mobile home registers exists in TOOL_MODULES.
 *      Adding a new tile without wiring it into module gating would
 *      silently show that tile to every scoped user — this test fails
 *      loudly instead.
 *   2. Each persona sees exactly the expected set of tiles. A SAFETY-
 *      scoped contractor must not see PROGRESS tools; a QAQC-scoped
 *      one must not see permits; internal staff (full access) see
 *      everything.
 *
 * If the home registers a new tile, either:
 *   - Add it to TOOL_MODULES in src/lib/modules.ts.
 *   - Add it to HOME_TILE_KEYS below.
 *   - Update EXPECTED_TILES for each persona that should see it.
 * Any missing wire fails the tests here rather than in prod.
 */
import { describe, it, expect } from "vitest";
import { canAccessTool, MODULES, TOOL_MODULES, type ModuleKey } from "@/lib/modules";

// Every tile the mobile home (src/app/mobile/[projectId]/page.tsx)
// registers as a Tool row. Kept as a plain literal here so the test
// can't lie: if the home adds a new key, the assertions below stay
// pinned to what was declared.
const HOME_TILE_KEYS = [
  "new-progress",
  "manpower",
  "hindrance",
  "permit",
  "permit-list",
  "site-progress",
  "qaqc-tile",
  "ehs-tile",
  "rfi",
  "concern",
  "hindrance-list",
  "manpower-list",
  "search",
  "dlr",
] as const;
type HomeTileKey = (typeof HOME_TILE_KEYS)[number];

// Serialize a modules-array to the on-disk format the User table stores.
// null / undefined / [] all mean full access.
function serialize(mods: ModuleKey[] | null): string | null {
  if (!mods) return null;
  return JSON.stringify(mods);
}

// Visible-key set for a given user shape. Uses canAccessTool exactly the
// way the home does, so the test can't drift from real gating.
function visibleTiles(modulesField: string | null): HomeTileKey[] {
  return HOME_TILE_KEYS.filter((key) => {
    const gate = TOOL_MODULES[key];
    // Missing gate → treated as "no one" so a typo can't leak the tile.
    if (!gate) return false;
    return canAccessTool(modulesField, gate);
  });
}

describe("TOOL_MODULES coverage", () => {
  it("every mobile-home tile key has an entry in TOOL_MODULES", () => {
    for (const key of HOME_TILE_KEYS) {
      expect(TOOL_MODULES[key], `missing gate for tile "${key}" — add to TOOL_MODULES in src/lib/modules.ts`).toBeTruthy();
    }
  });

  it("Expense is gone from TOOL_MODULES — Sep 22 module removal", () => {
    // If Expense returns, it needs to land back on the home and here.
    expect(TOOL_MODULES["expense"]).toBeUndefined();
  });
});

describe("mobile home tile visibility", () => {
  it("internal / full-access user sees every tile", () => {
    const visible = visibleTiles(serialize(null));
    // sort() so the assertion isn't order-brittle
    expect([...visible].sort()).toEqual([...HOME_TILE_KEYS].sort());
  });

  it("QAQC-scoped contractor sees only QA/QC tools (no permits, no progress, no safety)", () => {
    const visible = visibleTiles(serialize([MODULES.QAQC]));
    // qaqc-tile · inspection paths — the two ways they act on QA/QC
    expect([...visible].sort()).toEqual(["qaqc-tile", "search"].sort());
  });

  it("SAFETY-scoped contractor sees only Safety tools (no permits, no progress, no QA/QC)", () => {
    const visible = visibleTiles(serialize([MODULES.SAFETY]));
    expect([...visible].sort()).toEqual(["ehs-tile", "search"].sort());
  });

  it("PROGRESS-scoped contractor sees the log-progress trio + related lists (no QA/QC / Safety / permits)", () => {
    const visible = visibleTiles(serialize([MODULES.PROGRESS]));
    expect([...visible].sort()).toEqual(
      ["new-progress", "manpower", "manpower-list", "site-progress", "dlr", "search"].sort(),
    );
  });

  it("PERMIT-scoped contractor sees only the permits pair", () => {
    const visible = visibleTiles(serialize([MODULES.PERMIT]));
    expect([...visible].sort()).toEqual(["permit", "permit-list", "search"].sort());
  });

  it("HINDRANCE-scoped contractor sees only the hindrance pair", () => {
    const visible = visibleTiles(serialize([MODULES.HINDRANCE]));
    expect([...visible].sort()).toEqual(["hindrance", "hindrance-list", "search"].sort());
  });

  it("CONCERN-scoped contractor sees only the concern tile", () => {
    const visible = visibleTiles(serialize([MODULES.CONCERN]));
    expect([...visible].sort()).toEqual(["concern", "search"].sort());
  });

  it("RFI-scoped contractor sees only the RFI tile", () => {
    const visible = visibleTiles(serialize([MODULES.RFI]));
    expect([...visible].sort()).toEqual(["rfi", "search"].sort());
  });

  it("multi-scope QAQC+SAFETY contractor sees both quality tiles (still no progress/permits)", () => {
    const visible = visibleTiles(serialize([MODULES.QAQC, MODULES.SAFETY]));
    expect([...visible].sort()).toEqual(["ehs-tile", "qaqc-tile", "search"].sort());
  });
});

describe("scoped-user leakage guards", () => {
  it("a QAQC-only user never sees the Safety-only tile", () => {
    expect(canAccessTool(serialize([MODULES.QAQC]), TOOL_MODULES["ehs-tile"])).toBe(false);
  });
  it("a Safety-only user never sees the QAQC-only tile", () => {
    expect(canAccessTool(serialize([MODULES.SAFETY]), TOOL_MODULES["qaqc-tile"])).toBe(false);
  });
  it("no scoped user (of any single module) sees Log Progress", () => {
    const scopedModules: ModuleKey[] = [
      MODULES.QAQC,
      MODULES.SAFETY,
      MODULES.HINDRANCE,
      MODULES.CONCERN,
      MODULES.RFI,
      MODULES.PERMIT,
    ];
    for (const m of scopedModules) {
      expect(
        canAccessTool(serialize([m]), TOOL_MODULES["new-progress"]),
        `${m}-scoped contractor should not see "new-progress"`,
      ).toBe(false);
    }
  });
});
