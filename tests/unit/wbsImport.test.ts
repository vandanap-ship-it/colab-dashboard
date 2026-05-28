import { describe, it, expect } from "vitest";
import { parseWBSCsv, buildTree } from "@/lib/wbsImport";

const CSV = `Outline Level,Task Name,Planned Start,Planned End,% Complete,Quantity,UOM,Tag,Contractor
1,Villa Set,2026-04-02,2027-09-25,,,,,
2,Foundation,2026-04-02,2026-05-26,,,,,
3,Footing PCC,2026-04-09,2026-04-10,100,50,Cum,Concrete,ABC Contractors
3,Footing Reinforcement,2026-04-18,2026-04-24,,,,Rebar,
`;

describe("parseWBSCsv", () => {
  it("parses rows and skips blanks", () => {
    const res = parseWBSCsv(CSV);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(4);
  });

  it("captures levels and names", () => {
    const res = parseWBSCsv(CSV);
    if (!res.ok) return;
    expect(res.rows[0].level).toBe(1);
    expect(res.rows[0].name).toBe("Villa Set");
    expect(res.rows[2].name).toBe("Footing PCC");
    expect(res.rows[2].level).toBe(3);
  });

  it("sets progressEntered true only when % Complete has a value", () => {
    const res = parseWBSCsv(CSV);
    if (!res.ok) return;
    // Footing PCC has 100
    expect(res.rows[2].percentComplete).toBe(100);
    expect(res.rows[2].progressEntered).toBe(true);
    // Footing Reinforcement has blank % Complete
    expect(res.rows[3].progressEntered).toBe(false);
  });

  it("parses quantity, contractor", () => {
    const res = parseWBSCsv(CSV);
    if (!res.ok) return;
    expect(res.rows[2].totalQuantity).toBe(50);
    expect(res.rows[2].contractorName).toBe("ABC Contractors");
    expect(res.rows[3].contractorName).toBeNull();
  });

  it("fails on a CSV with no usable rows", () => {
    const res = parseWBSCsv("Foo,Bar\n1,2\n");
    expect(res.ok).toBe(false);
  });
});

describe("buildTree", () => {
  it("links children to the nearest higher-level parent", () => {
    const res = parseWBSCsv(CSV);
    if (!res.ok) return;
    const tree = buildTree(res.rows);
    const byName = Object.fromEntries(tree.nodes.map((n) => [n.name, n]));

    // Villa Set is root
    expect(byName["Villa Set"].parentTaskCode).toBeNull();
    // Foundation's parent is Villa Set
    expect(byName["Foundation"].parentTaskCode).toBe(byName["Villa Set"].taskCode);
    // Footing PCC's parent is Foundation
    expect(byName["Footing PCC"].parentTaskCode).toBe(byName["Foundation"].taskCode);
  });

  it("assigns order indices per level", () => {
    const res = parseWBSCsv(CSV);
    if (!res.ok) return;
    const tree = buildTree(res.rows);
    const level3 = tree.nodes.filter((n) => n.level === 3);
    expect(level3.map((n) => n.orderIndex)).toEqual([0, 1]);
  });
});
