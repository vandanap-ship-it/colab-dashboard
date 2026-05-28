import { test, expect, signIn } from "./fixtures";

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
});
