import { describe, it, expect } from "vitest";
import { getProjectOverride, _registeredProjectsForTest } from "@/lib/projects";
import { AMANVANA_VILLA_NUMBER_TO_BLOCK } from "@/lib/projects/amanvana";

/**
 * Golden tests for the project-override registry. Guards the two things
 * that break silently if the registry is refactored badly: the shape of
 * the registered entries and the detect-from-block-shape fingerprinting
 * that dispatches to them.
 */

describe("project registry", () => {
  it("registers at least one project (guards accidental empty state)", () => {
    const all = _registeredProjectsForTest();
    expect(all.length).toBeGreaterThan(0);
    for (const p of all) {
      expect(p.name).toBeTruthy();
      expect(typeof p.detectFromBlockShape).toBe("function");
      expect(typeof p.abrahamScopeOverride).toBe("function");
      expect(typeof p.elegantScopeOverride).toBe("function");
    }
  });

  it("has unique project names — a rename mistake would break dispatch order", () => {
    const names = _registeredProjectsForTest().map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("getProjectOverride · Amanvana fingerprinting", () => {
  const amanvanaBlocks = [...new Set(Object.values(AMANVANA_VILLA_NUMBER_TO_BLOCK))];

  it("matches Amanvana when the block set contains its known blocks", () => {
    const override = getProjectOverride({ blockCodes: amanvanaBlocks });
    expect(override).not.toBeNull();
    expect(override!.name).toMatch(/amanvana/i);
  });

  it("matches Amanvana with just 3 of its blocks (partial-overlap floor)", () => {
    const override = getProjectOverride({ blockCodes: amanvanaBlocks.slice(0, 3) });
    expect(override).not.toBeNull();
  });

  it("does NOT match on an unrelated block set (no false-match into Amanvana)", () => {
    const override = getProjectOverride({
      blockCodes: ["ZZ1", "ZZ2", "ZZ3", "ZZ4"],
    });
    expect(override).toBeNull();
  });

  it("does NOT match on an empty block set (defends against 'always-Amanvana' bug)", () => {
    expect(getProjectOverride({ blockCodes: [] })).toBeNull();
  });
});

describe("Amanvana scope overrides", () => {
  const amanvanaBlocks = [...new Set(Object.values(AMANVANA_VILLA_NUMBER_TO_BLOCK))];
  const override = getProjectOverride({ blockCodes: amanvanaBlocks });

  it("Abraham override returns 41 villas / 12 blocks", () => {
    // The awarded contract: Abraham holds 41 villas across 12 blocks
    // (Blocks 2, 3A, 3B, 4-10, 12, 13). The registry groups Block 3A + 3B
    // under one "03" code — the override reflects the real 12 anyway.
    const abraham = override!.abrahamScopeOverride();
    expect(abraham).not.toBeNull();
    expect(abraham!.villaCount).toBe(41);
    expect(abraham!.blockCount).toBe(12);
  });

  it("Elegant override returns 52 villas / 12 blocks", () => {
    // Contracted scope: 52 villas across Blocks 11, 14-24.
    const elegant = override!.elegantScopeOverride();
    expect(elegant).not.toBeNull();
    expect(elegant!.villaCount).toBe(52);
    expect(elegant!.blockCount).toBe(12);
  });
});
