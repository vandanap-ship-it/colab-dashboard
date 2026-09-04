import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the prisma client BEFORE importing the module under test, so
// projectFkGuards binds to the mocked version. We only need the two
// wBSNode read methods; nothing else in the module is exercised here.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    wBSNode: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  assertWbsNodeInProject,
  assertWbsNodesInProject,
} from "@/lib/projectFkGuards";

const wbsFindFirst = prisma.wBSNode.findFirst as ReturnType<typeof vi.fn>;
const wbsFindMany = prisma.wBSNode.findMany as ReturnType<typeof vi.fn>;

describe("assertWbsNodeInProject", () => {
  beforeEach(() => {
    wbsFindFirst.mockReset();
  });

  it("returns null when wbsNodeId is null/undefined/empty (no FK to check)", async () => {
    expect(await assertWbsNodeInProject(null, "p1")).toBeNull();
    expect(await assertWbsNodeInProject(undefined, "p1")).toBeNull();
    expect(await assertWbsNodeInProject("", "p1")).toBeNull();
    expect(wbsFindFirst).not.toHaveBeenCalled();
  });

  it("returns null when the node exists in the given project", async () => {
    wbsFindFirst.mockResolvedValueOnce({ id: "node1" });
    expect(await assertWbsNodeInProject("node1", "p1")).toBeNull();
    expect(wbsFindFirst).toHaveBeenCalledWith({
      where: { id: "node1", projectId: "p1" },
      select: { id: true },
    });
  });

  it("returns an error string when the node isn't found in the given project", async () => {
    wbsFindFirst.mockResolvedValueOnce(null);
    const err = await assertWbsNodeInProject("node-in-project-B", "p1");
    expect(err).toBeTruthy();
    expect(err).toMatch(/does not belong to this project/i);
  });
});

describe("assertWbsNodesInProject", () => {
  beforeEach(() => {
    wbsFindMany.mockReset();
  });

  it("returns null when the list is empty or all nullish", async () => {
    expect(await assertWbsNodesInProject([], "p1")).toBeNull();
    expect(await assertWbsNodesInProject([null, undefined, ""], "p1")).toBeNull();
    expect(wbsFindMany).not.toHaveBeenCalled();
  });

  it("returns null when every non-null id belongs to the project", async () => {
    wbsFindMany.mockResolvedValueOnce([{ id: "a" }, { id: "b" }]);
    expect(await assertWbsNodesInProject(["a", "b", null], "p1")).toBeNull();
    expect(wbsFindMany).toHaveBeenCalledWith({
      where: { id: { in: ["a", "b"] }, projectId: "p1" },
      select: { id: true },
    });
  });

  it("returns an error string when any id is missing", async () => {
    // Two unique ids requested, only one comes back.
    wbsFindMany.mockResolvedValueOnce([{ id: "a" }]);
    const err = await assertWbsNodesInProject(["a", "cross-project-b"], "p1");
    expect(err).toBeTruthy();
    expect(err).toMatch(/different project/i);
  });

  it("deduplicates the input so a repeated id doesn't cause a false negative", async () => {
    // One unique id requested; the single row returned satisfies the count check.
    wbsFindMany.mockResolvedValueOnce([{ id: "a" }]);
    expect(await assertWbsNodesInProject(["a", "a", null, "a"], "p1")).toBeNull();
    // The query itself only asked for one unique id.
    expect(wbsFindMany).toHaveBeenCalledWith({
      where: { id: { in: ["a"] }, projectId: "p1" },
      select: { id: true },
    });
  });
});
