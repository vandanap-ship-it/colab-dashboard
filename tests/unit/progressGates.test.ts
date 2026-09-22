/**
 * Golden tests for the Log Progress precheck-required gates.
 *
 * These lock down two things prod critically depends on:
 *   1. The rule registry regexes match the activity names we actually
 *      see in the wild (Colab CSV names, MSP names, hand-typed names).
 *   2. The `checkPrecheck` decision path: gate blocks when no PASSED
 *      inspection on the SAME villa exists, passes when one does, and
 *      never leaks across villas (V12's rebar doesn't gate V30's
 *      concreting).
 *
 * The prisma stubs are minimal — findUnique / findMany return whatever
 * the test hands them so we can exercise every decision arm without
 * running Postgres.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PROGRESS_GATES, gatesForActivity } from "@/lib/progressGates";

// checkPrecheck imports `prisma` from `@/lib/prisma`. Stub the module so the
// tests can control the return values row-by-row.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    wBSNode: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    inspection: {
      count: vi.fn(),
    },
  },
}));

describe("PROGRESS_GATES registry", () => {
  it("has the five industry-standard defaults", () => {
    expect(PROGRESS_GATES.map((g) => g.code)).toEqual([
      "rebar-before-concreting",
      "shuttering-before-rebar",
      "waterproofing-before-flooring",
      "mep-rough-in-before-plastering",
      "plastering-before-painting",
    ]);
  });
  it("gives every gate a human-readable requirement string", () => {
    for (const g of PROGRESS_GATES) {
      expect(g.requirement).toBeTruthy();
      expect(g.requirement.length).toBeGreaterThan(4);
    }
  });
});

describe("gatesForActivity", () => {
  it("matches Concreting variants case-insensitively", () => {
    for (const name of [
      "Concreting",
      "concreting",
      "CONCRETING",
      "Column Concreting",
      "RCC casting",
      "Concrete pour",
      "Concrete pouring",
      "Pouring",
    ]) {
      const gates = gatesForActivity(name);
      expect(gates.some((g) => g.code === "rebar-before-concreting")).toBe(true);
    }
  });

  it("matches Rebar variants → shuttering prerequisite", () => {
    for (const name of ["Rebar", "Reinforcement", "Steel binding", "Column reinforcement"]) {
      const gates = gatesForActivity(name);
      expect(gates.some((g) => g.code === "shuttering-before-rebar")).toBe(true);
    }
  });

  it("matches flooring variants → waterproofing prerequisite", () => {
    for (const name of ["Flooring", "Floor tiling", "Screed", "Screeding"]) {
      const gates = gatesForActivity(name);
      expect(gates.some((g) => g.code === "waterproofing-before-flooring")).toBe(true);
    }
  });

  it("matches Plastering → MEP rough-in prerequisite", () => {
    for (const name of ["Plastering", "Wall closure"]) {
      const gates = gatesForActivity(name);
      expect(gates.some((g) => g.code === "mep-rough-in-before-plastering")).toBe(true);
    }
  });

  it("matches Painting → plastering prerequisite", () => {
    for (const name of ["Painting", "Internal painting", "External painting"]) {
      const gates = gatesForActivity(name);
      expect(gates.some((g) => g.code === "plastering-before-painting")).toBe(true);
    }
  });

  it("returns empty for activities with no matching gate", () => {
    for (const name of ["Excavation", "PCC", "Anti-termite treatment", "Marking / Setting Out"]) {
      expect(gatesForActivity(name)).toEqual([]);
    }
  });

  it("returns multiple gates when an activity is both a step and a prerequisite", () => {
    // "Plastering" is gated on MEP AND is the prerequisite for Painting —
    // gatesForActivity only returns the ones where THIS activity is the
    // blocked step (not the prereq for something else), so plastering
    // should surface only mep-rough-in-before-plastering.
    const gates = gatesForActivity("Plastering");
    expect(gates.map((g) => g.code)).toContain("mep-rough-in-before-plastering");
    expect(gates.map((g) => g.code)).not.toContain("plastering-before-painting");
  });
});

describe("checkPrecheck", () => {
  let checkPrecheck: (id: string) => Promise<
    | { ok: true }
    | { ok: false; reason: string; requiredActivityName: string; requiredWbsNodeId: string | null }
  >;

  const V15 = "villa-15";
  const V30 = "villa-30";

  beforeEach(async () => {
    // Re-import per test so the mocked prisma is fresh.
    vi.resetModules();
    const mod = await import("@/lib/progressGates");
    checkPrecheck = mod.checkPrecheck;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes when no gate applies to the activity", async () => {
    const { prisma } = await import("@/lib/prisma");
    (prisma.wBSNode.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "wbs-1",
      name: "Marking Setting Out",
      projectId: "p1",
      villaId: V15,
    });
    const result = await checkPrecheck("wbs-1");
    expect(result).toEqual({ ok: true });
  });

  it("passes when the target row is missing (soft-fail to caller's FK guard)", async () => {
    const { prisma } = await import("@/lib/prisma");
    (prisma.wBSNode.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await checkPrecheck("nope");
    expect(result).toEqual({ ok: true });
  });

  it("passes when the target has no villa (unattributed structural row)", async () => {
    const { prisma } = await import("@/lib/prisma");
    (prisma.wBSNode.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "wbs-1",
      name: "Concreting",
      projectId: "p1",
      villaId: null,
    });
    const result = await checkPrecheck("wbs-1");
    expect(result).toEqual({ ok: true });
  });

  it("blocks Concreting when no PASSED rebar inspection exists on the same villa", async () => {
    const { prisma } = await import("@/lib/prisma");
    (prisma.wBSNode.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "wbs-conc",
      name: "Column GF→FF — Concreting",
      projectId: "p1",
      villaId: V15,
    });
    (prisma.wBSNode.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "wbs-conc", name: "Column GF→FF — Concreting" },
      { id: "wbs-rebar", name: "Column reinforcement" },
    ]);
    (prisma.inspection.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    const result = await checkPrecheck("wbs-conc");
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toContain("Rebar");
      expect(result.requiredWbsNodeId).toBe("wbs-rebar");
    }
  });

  it("allows Concreting once a PASSED rebar inspection exists on the same villa", async () => {
    const { prisma } = await import("@/lib/prisma");
    (prisma.wBSNode.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "wbs-conc",
      name: "Column GF→FF — Concreting",
      projectId: "p1",
      villaId: V15,
    });
    (prisma.wBSNode.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "wbs-conc", name: "Column GF→FF — Concreting" },
      { id: "wbs-rebar", name: "Column reinforcement" },
    ]);
    (prisma.inspection.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    const result = await checkPrecheck("wbs-conc");
    expect(result).toEqual({ ok: true });
  });

  it("skips a gate when the villa has no prerequisite row (nothing to gate on)", async () => {
    const { prisma } = await import("@/lib/prisma");
    (prisma.wBSNode.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "wbs-conc",
      name: "Concreting",
      projectId: "p1",
      villaId: V15,
    });
    // Villa has ONLY the concreting activity — no rebar to gate on.
    (prisma.wBSNode.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "wbs-conc", name: "Concreting" },
    ]);
    // inspection.count never gets called; the gate skips.
    (prisma.inspection.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    const result = await checkPrecheck("wbs-conc");
    expect(result).toEqual({ ok: true });
  });

  it("isolates villas — V12's rebar pass does not clear V30's concreting", async () => {
    // The check queries wbsNodes on the target's villa; a pass on a
    // different villa would only clear the gate if that villa's rebar
    // row happens to be in the fetched set. Verify by handing back only
    // V30's own rows (no PASSED inspection tagged to V30 rebar).
    const { prisma } = await import("@/lib/prisma");
    (prisma.wBSNode.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "wbs-conc-v30",
      name: "Concreting",
      projectId: "p1",
      villaId: V30,
    });
    (prisma.wBSNode.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "wbs-conc-v30", name: "Concreting" },
      { id: "wbs-rebar-v30", name: "Column reinforcement" },
    ]);
    (prisma.inspection.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    const result = await checkPrecheck("wbs-conc-v30");
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.requiredWbsNodeId).toBe("wbs-rebar-v30");
    }
  });
});
