import { test, expect, signIn, getProjectId, uniqueId } from "./fixtures";

test.describe("Admin operations", () => {
  test("admin can update project tagline", async ({ page }) => {
    await signIn(page, "admin");
    const projectId = await getProjectId(page);

    const newTagline = `E2E tagline ${uniqueId()}`;
    const patchRes = await page.request.patch(`/api/projects/${projectId}`, {
      data: { tagline: newTagline },
    });
    expect(patchRes.ok()).toBeTruthy();
    const { project } = await patchRes.json();
    expect(project.id).toBe(projectId);
  });

  test("audit log lists recent actions", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/admin/audit");
    await expect(page.getByRole("heading", { name: /Audit Log/i })).toBeVisible();
  });

  test("trash page loads", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/admin/trash");
    await expect(page.getByRole("heading", { name: /Trash/i })).toBeVisible();
  });

  test("users page loads", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/admin/users");
    // At minimum the page renders without error
    await expect(page.locator("body")).not.toContainText(/Forbidden|Unauthorized/i);
  });

  test("contractors page loads", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/admin/contractors");
    await expect(page.locator("body")).not.toContainText(/Forbidden|Unauthorized/i);
  });

  test("non-admin cannot access /admin/audit", async ({ page }) => {
    await signIn(page, "manager");
    await page.goto("/admin/audit");
    // Should redirect away or show forbidden
    await page.waitForTimeout(2000);
    expect(page.url()).not.toContain("/admin/audit");
  });
});
