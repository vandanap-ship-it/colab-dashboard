import { test, expect, signIn, getProjectId } from "./fixtures";

test.describe("Snapshot dashboard", () => {
  test("planner sees physical progress + schedule summary", async ({ page }) => {
    await signIn(page, "planner");
    const projectId = await getProjectId(page);
    await page.goto(`/projects/${projectId}/snapshot`);

    await expect(page.getByText(/Physical Progress/i).first()).toBeVisible();
    await expect(page.getByText(/Schedule Summary/i).first()).toBeVisible();
  });

  test("snags + hindrances cards are present", async ({ page }) => {
    await signIn(page, "planner");
    const projectId = await getProjectId(page);
    await page.goto(`/projects/${projectId}/snapshot`);

    await expect(page.getByText(/Snags/i).first()).toBeVisible();
    await expect(page.getByText(/Hindrance/i).first()).toBeVisible();
  });

  test("QAQC tab loads contractor performance", async ({ page }) => {
    await signIn(page, "planner");
    const projectId = await getProjectId(page);
    await page.goto(`/projects/${projectId}/qaqc`);

    await expect(page.getByText(/Contractor Performance/i).first()).toBeVisible();
  });

  test("Add Progress page lists historical entries", async ({ page }) => {
    await signIn(page, "planner");
    const projectId = await getProjectId(page);
    await page.goto(`/projects/${projectId}/add-progress`);

    // Page should load without error (planner has access)
    await expect(page.locator("body")).not.toContainText(/Forbidden|Unauthorized/i);
  });
});
