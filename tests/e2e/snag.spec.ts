import { test, expect, signIn, getProjectId, uniqueId } from "./fixtures";

test.describe("Snag workflow", () => {
  test("API: engineer can create a snag, planner sees it", async ({ page }) => {
    await signIn(page, "manager");
    const projectId = await getProjectId(page);

    // First find an activity to attach the snag to
    const wbsRes = await page.request.get(`/api/projects/${projectId}/wbs?leaves=true`);
    const wbsData = await wbsRes.json();
    const activity = wbsData.nodes?.[0];
    expect(activity).toBeTruthy();

    // Raise a snag via API
    const description = `[E2E test] Crack in plaster ${uniqueId()}`;
    const createRes = await page.request.post("/api/issues", {
      data: {
        projectId,
        wbsNodeId: activity.id,
        description,
        severity: "MEDIUM",
        category: "Test",
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const { issue } = await createRes.json();
    expect(issue.id).toBeTruthy();
    expect(issue.description).toBe(description);

    // Verify it appears in the list
    const listRes = await page.request.get(`/api/issues?projectId=${projectId}`);
    const listData = await listRes.json();
    const found = listData.issues.find((i: { id: string }) => i.id === issue.id);
    expect(found).toBeTruthy();
    expect(found.status).toBe("OPEN");

    // Planner closes it
    await page.context().clearCookies();
    await signIn(page, "planner");
    const closeRes = await page.request.patch(`/api/issues/${issue.id}`, {
      data: { status: "RESOLVED" },
    });
    expect(closeRes.ok()).toBeTruthy();
    const closed = (await closeRes.json()).issue;
    expect(closed.status).toBe("RESOLVED");
  });

  test("UI: Snag Master loads with filters", async ({ page }) => {
    await signIn(page, "planner");
    const projectId = await getProjectId(page);
    await page.goto(`/projects/${projectId}/snag-master`);

    // Page should load (don't assert on specific snag count — it varies)
    await expect(page.locator("body")).not.toContainText(/Forbidden|Unauthorized/i);
  });
});
