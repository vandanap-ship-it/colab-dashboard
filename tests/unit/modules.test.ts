import { describe, it, expect } from "vitest";
import {
  MODULES,
  parseUserModules,
  canAccessModule,
  canAccessScopedRow,
  hasFullAccess,
  isScopedUser,
  canAccessTool,
  primaryModuleFor,
  serializeModules,
} from "@/lib/modules";

describe("module access — parseUserModules", () => {
  it("treats null/empty as full access", () => {
    expect(parseUserModules(null)).toBeNull();
    expect(parseUserModules(undefined)).toBeNull();
    expect(parseUserModules("")).toBeNull();
    expect(parseUserModules("[]")).toBeNull();
  });

  it("parses a valid scoped list", () => {
    const set = parseUserModules('["QAQC"]');
    expect(set).not.toBeNull();
    expect(set!.has("QAQC")).toBe(true);
    expect(set!.has("SAFETY")).toBe(false);
  });

  it("drops unknown module keys", () => {
    const set = parseUserModules('["QAQC","BOGUS"]');
    expect(set!.has("QAQC")).toBe(true);
    expect([...set!]).toEqual(["QAQC"]);
  });

  it("returns null (full access) when all keys are invalid", () => {
    expect(parseUserModules('["NONSENSE"]')).toBeNull();
  });

  it("returns null on malformed JSON (fails open to full access is acceptable for internal default)", () => {
    expect(parseUserModules("not json")).toBeNull();
  });
});

describe("module access — canAccessModule", () => {
  it("full-access users can access every module", () => {
    for (const m of Object.values(MODULES)) {
      expect(canAccessModule(null, m)).toBe(true);
    }
  });

  it("scoped QAQC user can access QAQC but not PROGRESS/SAFETY", () => {
    const scope = '["QAQC"]';
    expect(canAccessModule(scope, MODULES.QAQC)).toBe(true);
    expect(canAccessModule(scope, MODULES.PROGRESS)).toBe(false);
    expect(canAccessModule(scope, MODULES.SAFETY)).toBe(false);
    expect(canAccessModule(scope, MODULES.HINDRANCE)).toBe(false);
    expect(canAccessModule(scope, MODULES.CONCERN)).toBe(false);
  });

  it("scoped SAFETY user can access SAFETY only", () => {
    const scope = '["SAFETY"]';
    expect(canAccessModule(scope, MODULES.SAFETY)).toBe(true);
    expect(canAccessModule(scope, MODULES.QAQC)).toBe(false);
    expect(canAccessModule(scope, MODULES.PROGRESS)).toBe(false);
  });
});

describe("module access — flags", () => {
  it("hasFullAccess / isScopedUser are inverses", () => {
    expect(hasFullAccess(null)).toBe(true);
    expect(isScopedUser(null)).toBe(false);
    expect(hasFullAccess('["QAQC"]')).toBe(false);
    expect(isScopedUser('["QAQC"]')).toBe(true);
  });
});

describe("module access — canAccessTool", () => {
  it("full-access users can access any tool", () => {
    expect(canAccessTool(null, [MODULES.PROGRESS])).toBe(true);
    expect(canAccessTool(null, [MODULES.QAQC, MODULES.SAFETY])).toBe(true);
  });

  it("QAQC user can access tools owned by QAQC (incl. shared inspection/snag)", () => {
    const scope = '["QAQC"]';
    expect(canAccessTool(scope, [MODULES.QAQC, MODULES.SAFETY])).toBe(true); // snag / inspection
    expect(canAccessTool(scope, [MODULES.PROGRESS])).toBe(false); // progress
    expect(canAccessTool(scope, [MODULES.HINDRANCE])).toBe(false);
  });

  it("SAFETY user can access shared inspection/snag tools too", () => {
    const scope = '["SAFETY"]';
    expect(canAccessTool(scope, [MODULES.QAQC, MODULES.SAFETY])).toBe(true);
    expect(canAccessTool(scope, [MODULES.PROGRESS])).toBe(false);
  });
});

describe("module access — primaryModuleFor (record tagging)", () => {
  it("returns null for full-access users (records stay general)", () => {
    expect(primaryModuleFor(null)).toBeNull();
  });

  it("returns the scoped module for contractors", () => {
    expect(primaryModuleFor('["QAQC"]')).toBe(MODULES.QAQC);
    expect(primaryModuleFor('["SAFETY"]')).toBe(MODULES.SAFETY);
  });

  it("prefers SAFETY then QAQC when both present", () => {
    expect(primaryModuleFor('["QAQC","SAFETY"]')).toBe(MODULES.SAFETY);
  });
});

describe("module access — canAccessScopedRow", () => {
  it("full-access user passes for every row module (including null)", () => {
    expect(canAccessScopedRow(null, "QAQC")).toBe(true);
    expect(canAccessScopedRow(null, "SAFETY")).toBe(true);
    expect(canAccessScopedRow(null, null)).toBe(true);
    expect(canAccessScopedRow(null, undefined)).toBe(true);
  });

  it("scoped QAQC user passes for a QAQC row, blocked on SAFETY", () => {
    const scope = serializeModules(["QAQC"]);
    expect(canAccessScopedRow(scope, "QAQC")).toBe(true);
    expect(canAccessScopedRow(scope, "SAFETY")).toBe(false);
  });

  it("scoped user is always blocked on a general (null-module) row", () => {
    const qaqc = serializeModules(["QAQC"]);
    const safety = serializeModules(["SAFETY"]);
    expect(canAccessScopedRow(qaqc, null)).toBe(false);
    expect(canAccessScopedRow(safety, null)).toBe(false);
    expect(canAccessScopedRow(qaqc, undefined)).toBe(false);
  });

  it("multi-module scoped user passes only for their modules", () => {
    const scope = serializeModules(["QAQC", "HINDRANCE"]);
    expect(canAccessScopedRow(scope, "QAQC")).toBe(true);
    expect(canAccessScopedRow(scope, "HINDRANCE")).toBe(true);
    expect(canAccessScopedRow(scope, "SAFETY")).toBe(false);
    expect(canAccessScopedRow(scope, null)).toBe(false);
  });
});

describe("module access — serializeModules", () => {
  it("returns null for empty / nullish", () => {
    expect(serializeModules(null)).toBeNull();
    expect(serializeModules([])).toBeNull();
  });

  it("serialises valid modules to JSON", () => {
    expect(serializeModules(["QAQC"])).toBe('["QAQC"]');
  });

  it("drops invalid module keys", () => {
    expect(serializeModules(["QAQC", "BOGUS"])).toBe('["QAQC"]');
  });

  it("round-trips through parseUserModules", () => {
    const serialized = serializeModules(["SAFETY"]);
    const parsed = parseUserModules(serialized);
    expect(parsed!.has("SAFETY")).toBe(true);
  });
});
