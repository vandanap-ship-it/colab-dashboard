import { test, expect, signIn, getProjectId, uniqueId } from "./fixtures";

test.describe("Progress entry workflow", () => {
  test("API: manager can create a progress entry", async ({ page }) => {
    await signIn(page, "manager");
    const projectId = await getProjectId(page);

    // Find an activity
    const wbsRes = await page.request.get(`/api/projects/${projectId}/wbs?leaves=true`);
    const wbsData = await wbsRes.json();
    const activity = wbsData.nodes?.[0];
    expect(activity).toBeTruthy();

    // Create the entry
    const note = `[E2E test] Progress note ${uniqueId()}`;
    const createRes = await page.request.post("/api/progress", {
      data: {
        wbsNodeId: activity.id,
        date: new Date().toISOString(),
        type: "LABOUR_SUPPLY",
        achievedQuantity: 5,
        cumulativeQuantity: 5,
        notes: note,
        labour: [{ category: "Skilled", count: 3 }],
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const { entry } = await createRes.json();
    expect(entry.id).toBeTruthy();
    expect(entry.notes).toBe(note);
  });

  test("Soft delete: progress entry goes to trash, admin can restore", async ({ page }) => {
    await signIn(page, "manager");
    const projectId = await getProjectId(page);

    // Create an entry to delete
    const wbsRes = await page.request.get(`/api/projects/${projectId}/wbs?leaves=true`);
    const activity = (await wbsRes.json()).nodes?.[0];
    const note = `[E2E delete test] ${uniqueId()}`;
    const createRes = await page.request.post("/api/progress", {
      data: {
        wbsNodeId: activity.id,
        date: new Date().toISOString(),
        type: "LABOUR_SUPPLY",
        achievedQuantity: 1,
        cumulativeQuantity: 1,
        notes: note,
      },
    });
    const { entry } = await createRes.json();

    // Delete it
    const delRes = await page.request.delete(`/api/progress/${entry.id}`);
    expect(delRes.ok()).toBeTruthy();

    // Confirm it's not in normal listing
    const listRes = await page.request.get(`/api/progress?projectId=${projectId}`);
    const listData = await listRes.json();
    const stillVisible = listData.entries.find((e: { id: string }) => e.id === entry.id);
    expect(stillVisible).toBeUndefined();

    // Sign in as admin and restore
    await page.context().clearCookies();
    await signIn(page, "admin");
    const restoreRes = await page.request.post("/api/admin/restore", {
      data: { entityType: "ProgressEntry", id: entry.id },
    });
    expect(restoreRes.ok()).toBeTruthy();

    // Confirm it's back
    const listAfterRes = await page.request.get(`/api/progress?projectId=${projectId}`);
    const listAfter = await listAfterRes.json();
    const restored = listAfter.entries.find((e: { id: string }) => e.id === entry.id);
    expect(restored).toBeTruthy();
  });
});
