import { test, expect, signIn, getProjectId, uniqueId } from "./fixtures";

/**
 * Cross-project FK guard: POST bodies that pair a real projectId with a
 * wbsNodeId belonging to a different project (or to no project at all)
 * must return 400 rather than silently linking the row cross-project.
 *
 * Uses a bogus wbsNodeId that doesn't exist anywhere — the guard's
 * `findFirst({ where: { id, projectId } })` returns null, which is the
 * same failure mode as a real cross-project pointer.
 *
 * The 5 endpoints covered here take a top-level wbsNodeId. Bills use a
 * nested lines[].wbsNodeId array; that path is covered by the unit test
 * for assertWbsNodesInProject.
 */
test.describe("Cross-project FK guards on wbsNodeId", () => {
  test("POST endpoints reject a wbsNodeId that doesn't belong to the project", async ({ page }) => {
    await signIn(page, "planner");
    const projectId = await getProjectId(page);
    const bogusWbsNodeId = `bogus-node-${uniqueId()}`;

    // POST /api/rfi
    const rfi = await page.request.post("/api/rfi", {
      data: {
        projectId,
        subject: "cross-project fk test",
        description: "should be rejected",
        category: "DRAWING",
        priority: "MEDIUM",
        wbsNodeId: bogusWbsNodeId,
      },
    });
    expect(rfi.status()).toBe(400);
    expect((await rfi.json()).error).toMatch(/does not belong to this project/i);

    // POST /api/hindrances
    const hind = await page.request.post("/api/hindrances", {
      data: {
        projectId,
        description: "cross-project fk test",
        startDate: new Date().toISOString(),
        wbsNodeId: bogusWbsNodeId,
      },
    });
    expect(hind.status()).toBe(400);
    expect((await hind.json()).error).toMatch(/does not belong to this project/i);

    // POST /api/inspections
    const insp = await page.request.post("/api/inspections", {
      data: {
        projectId,
        title: "cross-project fk test",
        items: [{ label: "Check 1", passed: true }],
        wbsNodeId: bogusWbsNodeId,
      },
    });
    expect(insp.status()).toBe(400);
    expect((await insp.json()).error).toMatch(/does not belong to this project/i);

    // POST /api/issues
    const snag = await page.request.post("/api/issues", {
      data: {
        projectId,
        description: "cross-project fk test",
        wbsNodeId: bogusWbsNodeId,
      },
    });
    expect(snag.status()).toBe(400);
    expect((await snag.json()).error).toMatch(/does not belong to this project/i);

    // POST /api/concerns
    const conc = await page.request.post("/api/concerns", {
      data: {
        projectId,
        description: "cross-project fk test",
        wbsNodeId: bogusWbsNodeId,
      },
    });
    expect(conc.status()).toBe(400);
    expect((await conc.json()).error).toMatch(/does not belong to this project/i);
  });

  test("POST endpoints accept a missing/null wbsNodeId (guard is opt-in)", async ({ page }) => {
    // Regression check: the guard runs only when wbsNodeId is set. Omitting
    // it entirely (or sending null) should be a normal create, not a 400.
    await signIn(page, "planner");
    const projectId = await getProjectId(page);
    const label = `[cross-project fk test] ${uniqueId()}`;

    const snag = await page.request.post("/api/issues", {
      data: { projectId, description: label },
    });
    // 201 on happy path; the row was created without an activity tag.
    expect(snag.status()).toBe(201);
    const { issue } = await snag.json();
    expect(issue.wbsNodeId).toBeNull();

    // Cleanup — delete the row we just made.
    await page.request.delete(`/api/issues/${issue.id}`);
  });
});
