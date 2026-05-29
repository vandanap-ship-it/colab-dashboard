import { test, expect, signIn, getProjectId, uniqueId } from "./fixtures";

/**
 * Mobile experience (webkit / iPhone viewport).
 *
 * Note: the engineer post-login auto-redirect to /mobile is covered by
 * auth.spec on desktop. Here we navigate explicitly and verify the mobile
 * UI renders, which is more robust than racing the client→server redirect
 * chain on a slow CI runner.
 */
test.describe("Mobile experience", () => {
  test("engineer can reach the mobile home", async ({ page }) => {
    await signIn(page, "engineer");
    await page.goto("/mobile");
    // Should not be bounced to login — engineer has a valid session + mobile access
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator("body")).not.toContainText(/Forbidden|Unauthorized/i);
  });

  test("mobile home shows bottom nav", async ({ page }) => {
    await signIn(page, "engineer");
    await page.goto("/mobile");
    await expect(page.getByText(/Home/i).first()).toBeVisible();
    await expect(page.getByText(/Profile/i).first()).toBeVisible();
  });

  test("manager can reach the mobile area", async ({ page }) => {
    await signIn(page, "manager");
    await page.goto("/mobile");
    await expect(page.locator("body")).not.toContainText(/Forbidden|Unauthorized/i);
  });

  test("engineer logs an expense from the phone", async ({ page }) => {
    await signIn(page, "engineer");
    const projectId = await getProjectId(page);

    await page.goto(`/mobile/${projectId}/expense/new`);
    await expect(page.getByRole("heading", { name: /Log Expense/i })).toBeVisible();

    await page.locator('input[type="number"]').first().fill("1500");
    await page.getByPlaceholder(/Sand 2 loads/i).fill(`[E2E mobile] tea & snacks ${uniqueId()}`);
    await page.getByRole("button", { name: /^Log expense$/i }).click();

    // On success the form returns to the mobile project home.
    await expect(page).toHaveURL(new RegExp(`/mobile/${projectId}$`));
  });
});
