import { describe, it, expect } from "vitest";
import { generateProgressDisplayId, monotonicViolationMessage } from "@/lib/progress";

describe("generateProgressDisplayId", () => {
  it("returns a PROG-XXXXXXXX format id", () => {
    const id = generateProgressDisplayId();
    expect(id).toMatch(/^PROG-[A-Z0-9]{8}$/);
  });

  it("uses an unambiguous alphabet (no I, O, 0, 1 in the suffix)", () => {
    // Sample 500 times — the forbidden chars would show up in the first
    // few iterations if a well-meaning refactor accidentally reintroduced
    // them. Matches the same rule the permit generator carries.
    for (let i = 0; i < 500; i++) {
      const suffix = generateProgressDisplayId().slice(5);
      expect(suffix).not.toMatch(/[IO01]/);
    }
  });

  it("yields high entropy over many draws (no obvious collision cluster)", () => {
    // 32-char alphabet at 8 chars = 32^8 space; 500 draws without
    // collision is the smoke test the generator is actually random.
    const set = new Set<string>();
    for (let i = 0; i < 500; i++) set.add(generateProgressDisplayId());
    expect(set.size).toBe(500);
  });
});

describe("monotonicViolationMessage", () => {
  it("names the offending prior value with one decimal place", () => {
    const msg = monotonicViolationMessage(42.567, "new");
    expect(msg).toContain("42.6");
    expect(msg).not.toContain("42.567");
  });

  it("adapts noun for fresh POST (new entry)", () => {
    const msg = monotonicViolationMessage(10, "new");
    expect(msg).toContain("new entry must be");
    expect(msg).not.toContain("this draft");
  });

  it("adapts noun for publish-a-draft (this draft)", () => {
    const msg = monotonicViolationMessage(10, "draft");
    expect(msg).toContain("this draft must be");
    expect(msg).not.toContain("new entry");
  });

  it("names the admin-void escape hatch", () => {
    const msg = monotonicViolationMessage(10, "new");
    expect(msg.toLowerCase()).toContain("admin");
    expect(msg.toLowerCase()).toContain("void");
  });

  it("handles 0 prior gracefully (silly edge case but shouldn't crash)", () => {
    const msg = monotonicViolationMessage(0, "new");
    expect(msg).toContain("0.0");
  });
});
